//! Audio path diagnosis and Gate 0 measurement.
//!
//! Gate 0: Determine whether the WASAPI loopback tap is pre-EQ or post-EQ
//! relative to Equalizer APO.
//!
//! If the tap sees audio BEFORE APO processing (pre-EQ), we can measure the
//! actual track and apply adaptive EQ.
//!
//! If the tap sees audio AFTER APO processing (post-EQ), the analysis would
//! measure its own output, causing potential oscillation. In this case, we
//! must fall back to metadata-only EQ.

use serde::Serialize;
use crate::services::eq_controller::EqController;
use std::time::Duration;
use tokio::time::timeout;

#[derive(Clone, Serialize)]
pub struct MeasurementResult {
    /// Peak amplitude measured at loopback before test gain
    pub baseline_peak: f32,
    /// Peak amplitude measured at loopback after applying test gain
    pub test_peak: f32,
    /// Test gain applied in dB
    pub test_gain_db: f32,
    /// Estimated actual gain seen at loopback (corrected for any APO processing)
    pub actual_gain_db: f32,
    /// True if loopback sees the EQ output (post-EQ), meaning tap is BEFORE APO
    pub is_pre_eq: bool,
    /// Confidence in the measurement
    pub confidence: f32,
}

#[derive(Serialize)]
pub struct AudioPathReport {
    pub status: String,
    pub gate_0_result: Option<String>,
    pub tap_position: Option<String>,
    pub measurement: Option<MeasurementResult>,
    pub recommendation: String,
}

const NOISE_FLOOR_DB: f32 = -60.0;
const MEASUREMENT_THRESHOLD_DB: f32 = 1.0;

/// Measure every stage of the audio path from source to speakers.
///
/// Uses loopback capture to determine if Equalizer APO is affecting the
/// signal that the loopback sees. This establishes Gate 0.
///
/// Stages reported:
/// - `eq_available`: Equalizer APO is installed and writable
/// - `eq_config_present`: Config file exists and is readable
/// - `loopback_capture_working`: Can capture audio via WASAPI loopback
/// - `test_gain_applied`: Successfully applied test gain
/// - `loopback_sees_change`: Loopback measured the gain change
/// - `processing_verified`: EQ is actually affecting speakers (requires user verification)
pub async fn diagnose(
    measurement: Option<&MeasurementResult>,
    eq_available: bool,
    eq_config_present: bool,
) -> AudioPathReport {
    let mut report = AudioPathReport {
        status: "ok".into(),
        gate_0_result: None,
        tap_position: None,
        measurement: None,
        recommendation: "Run a measurement to establish Gate 0 evidence.".into(),
    };

    if !eq_available {
        report.status = "eq_not_available".into();
        report.recommendation = "Install Equalizer APO to use SonusPilot.".into();
        return report;
    }

    if !eq_config_present {
        report.status = "eq_config_missing".into();
        report.recommendation = "Equalizer APO is installed but config.txt not found.".into();
        return report;
    }

    // Check loopback capture capability
    if !loopback_capture_available().await {
        report.status = "loopback_unavailable".into();
        report.recommendation = "WASAPI loopback capture unavailable. Check audio device permissions.".into();
        return report;
    }

    // We have the basics - check if we have a measurement
    if let Some(m) = measurement {
        report.measurement = Some(m.clone());
        report.gate_0_result = Some(if m.is_pre_eq {
            "PASS: Tap is PRE-EQ (sees unprocessed audio)".into()
        } else {
            "FAIL: Tap is POST-EQ (sees processed audio)".into()
        });
        report.tap_position = Some(if m.is_pre_eq {
            "before_equalizer_apo".into()
        } else {
            "after_equalizer_apo".into()
        });

        if m.is_pre_eq && m.confidence > 0.8 {
            report.status = "gate0_pass".into();
            report.recommendation = "Gate 0 passed. Loopback sees unprocessed audio. Adaptive EQ can be safely implemented.".into();
        } else if m.is_pre_eq {
            report.status = "gate0_pass_low_confidence".into();
            report.recommendation = format!(
                "Gate 0 passed but confidence ({:.1}) is low. Re-run measurement for confirmation.",
                m.confidence
            );
        } else {
            report.status = "gate0_fail".into();
            report.recommendation = "Gate 0 failed. Loopback sees processed audio - adaptive analysis would measure its own output. Consider finding a pre-EQ tap or use metadata-only EQ.".into();
        }
    } else {
        report.recommendation = "Run run_audio_test() to measure audio path and establish Gate 0.".into();
    }

    report
}

/// Check if loopback capture is available on this system.
async fn loopback_capture_available() -> bool {
    // Try to initialize WASAPI loopback on default endpoint
    // If this succeeds, loopback capture is available
    let result = tokio::task::spawn_blocking(|| {
        unsafe {
            use windows::Win32::Media::Audio::{
                eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
                AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
            };
            use windows::Win32::System::Com::{
                CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
            };

            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let enumerator: IMMDeviceEnumerator = match CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) {
                Ok(e) => e,
                Err(_) => return false,
            };
            let device = match enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
                Ok(d) => d,
                Err(_) => return false,
            };
            let audio_client: windows::Win32::Media::Audio::IAudioClient =
                match device.Activate(CLSCTX_ALL, None) {
                    Ok(ac) => ac,
                    Err(_) => return false,
                };

            let format = match audio_client.GetMixFormat() {
                Ok(f) => f,
                Err(_) => return false,
            };

            let result = audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                10000000, // 1 second buffer
                0,
                format,
                None,
            );

            result.is_ok()
        }
    })
    .await;

    match result {
        Ok(ok) => ok,
        Err(_) => false,
    }
}

/// Apply a temporary safe gain offset, measure whether it changed the output,
/// then restore the user's curve.
///
/// This is the only check that can turn the "processing_verified" stage green.
pub async fn run_measurement(
    controller: &EqController,
    test_preamp_db: f32,
) -> Result<MeasurementResult, String> {
    // Get current profile to restore later
    let current_profile = controller.get_current_profile().await;
    let current_preamp = current_profile.as_ref().map(|p| p.preamp_db).unwrap_or(0.0);

    // Step 1: Measure baseline with current EQ (neutral or user's)
    let baseline_peak = measure_loopback_peak().await?;

    // Step 2: Apply test gain (add to current preamp)
    let test_preamp = current_preamp + test_preamp_db;
    let test_profile = controller.get_current_profile().await.unwrap_or_else(|| {
        // Create a neutral profile with test preamp
        use crate::services::eq_controller::GraphicEQProfile;
        GraphicEQProfile {
            name: "measurement".into(),
            gains_db: [0.0; 31],
            preamp_db: test_preamp,
        }
    });

    // Temporarily apply test gain
    controller.set_profile(test_profile).await.map_err(|e| {
        format!("Failed to apply test gain: {}", e)
    })?;

    // Wait for EQ to settle
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Step 3: Measure with test gain applied
    let test_peak = measure_loopback_peak().await?;

    // Step 4: Restore original profile
    if let Some(orig_profile) = current_profile {
        controller.set_profile(orig_profile).await.ok();
    }

    // Step 5: Analyze results
    let baseline_db = to_db(baseline_peak);
    let test_db = to_db(test_peak);
    let actual_gain_db = test_db - baseline_db;

    // Determine if loopback sees the EQ (pre-EQ case)
    // If we applied +6dB and see ~+6dB at loopback, the tap is BEFORE APO (pre-EQ)
    // If we applied +6dB but see ~0dB at loopback, the tap is AFTER APO (post-EQ)
    let is_pre_eq = actual_gain_db > MEASUREMENT_THRESHOLD_DB;
    let confidence = calculate_confidence(baseline_peak, test_peak, actual_gain_db, test_preamp_db);

    Ok(MeasurementResult {
        baseline_peak,
        test_peak,
        test_gain_db: test_preamp_db,
        actual_gain_db,
        is_pre_eq,
        confidence,
    })
}

/// Measure peak amplitude from loopback capture.
async fn measure_loopback_peak() -> Result<f32, String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<f32>>(10);

    // Spawn loopback capture
    let capture_handle = tokio::spawn(async move {
        let capture = crate::services::loopback::LoopbackCapture::new(tx);
        capture.run().await
    });

    // Wait a moment for capture to start
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Collect samples for a brief period
    let mut all_samples: Vec<f32> = Vec::new();
    let mut samples_received = 0;

    let sample_timeout = Duration::from_millis(200);
    while let Ok(samples) = timeout(sample_timeout, rx.recv()).await {
        if let Some(batch) = samples {
            all_samples.extend(batch);
            samples_received += 1;
            if samples_received >= 10 {
                break; // Got enough samples
            }
        }
    }

    // Cleanup
    capture_handle.abort();

    if all_samples.is_empty() {
        return Err("No audio samples captured".to_string());
    }

    // Calculate peak
    let peak = all_samples.iter().map(|s| s.abs()).fold(f32::NEG_INFINITY, f32::max);
    Ok(peak)
}

/// Convert amplitude to dB.
fn to_db(amplitude: f32) -> f32 {
    if amplitude < 1e-10 {
        NOISE_FLOOR_DB
    } else {
        20.0 * amplitude.log10()
    }
}

/// Calculate measurement confidence.
fn calculate_confidence(
    baseline: f32,
    test: f32,
    actual_gain: f32,
    expected_gain: f32,
) -> f32 {
    // Base confidence on how close actual gain is to expected gain
    let gain_diff = (actual_gain - expected_gain).abs();
    let gain_confidence = if gain_diff < 0.5 {
        1.0
    } else if gain_diff < 1.0 {
        0.8
    } else if gain_diff < 2.0 {
        0.5
    } else {
        0.2
    };

    // Also factor in signal-to-noise ratio
    let signal_peak = test.max(baseline);
    let snr = to_db(signal_peak) - NOISE_FLOOR_DB;
    let snr_confidence = (snr / 60.0).min(1.0).max(0.0);

    // Combined confidence
    (gain_confidence * 0.7 + snr_confidence * 0.3).min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_db_converts_correctly() {
        assert!((to_db(1.0) - 0.0).abs() < 0.001);
        assert!((to_db(0.5) - (-6.02)).abs() < 0.1);
        assert!(to_db(0.001) < -60.0);
    }

    #[test]
    fn calculates_confidence_correctly() {
        // Perfect match
        let c = calculate_confidence(0.5, 1.0, 6.0, 6.0);
        assert!(c > 0.9);

        // Close match
        let c = calculate_confidence(0.5, 1.0, 5.5, 6.0);
        assert!(c > 0.7);
    }
}
