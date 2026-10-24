use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::mpsc;
use crate::services::audio::AudioBlock;
use crate::services::eq_controller::EqController;
use tracing::info;

/// Simple biquad peaking filter for one ISO band.
/// Coefficients are computed using the Audio EQ Cookbook (RBJ).
struct BiquadFilter {
    b0: f32, b1: f32, b2: f32,
    a1: f32, a2: f32,
    z1: f32, z2: f32,
}

impl BiquadFilter {
    fn peaking(sample_rate: u32, freq_hz: f32, gain_db: f32, q: f32) -> Self {
        let fs = sample_rate as f32;
        let a = 10f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * freq_hz / fs;
        let alpha = w0.sin() / (2.0 * q);
        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * w0.cos();
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * w0.cos();
        let a2 = 1.0 - alpha / a;
        Self { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0, z1: 0.0, z2: 0.0 }
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

fn apply_eq_gains(samples: &mut [f32], gains_db: &[f32; 31], sample_rate: u32) {
    use crate::services::eq_controller::ISO_BANDS;
    let mut filters: Vec<BiquadFilter> = ISO_BANDS.iter().zip(gains_db.iter())
        .map(|(&freq, &gain)| BiquadFilter::peaking(sample_rate, freq, gain, 1.41))
        .collect();
    for s in samples.iter_mut() {
        let mut v = *s;
        for f in &mut filters {
            v = f.process(v);
        }
        *s = v;
    }
}

pub struct WasapiRenderClient {
    pub receiver: mpsc::Receiver<AudioBlock>,
    pub controller: Arc<EqController>,
    stop_flag: Arc<AtomicBool>,
}

impl WasapiRenderClient {
    pub fn new(receiver: mpsc::Receiver<AudioBlock>, controller: Arc<EqController>) -> Self {
        Self {
            receiver,
            controller,
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
        info!("Stopping WASAPI Render Client");
    }

    pub async fn run(&mut self) -> anyhow::Result<()> {
        info!("Starting WASAPI Render Client loop");

        while !self.stop_flag.load(Ordering::Relaxed) {
            let Some(block) = self.receiver.recv().await else { break };

            let gains_db = self.controller.get_current_gains().await.unwrap_or([0.0; 31]);
            let mut samples = block.samples.clone();

            apply_eq_gains(&mut samples, &gains_db, block.sample_rate);

            // ponytail: WASAPI GetBuffer/ReleaseBuffer omitted — add when replacing APO with owned DSP path
            let _ = samples;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn biquad_silence_in_silence_out() {
        let mut f = BiquadFilter::peaking(44100, 1000.0, 6.0, 1.41);
        let out = f.process(0.0);
        assert_eq!(out, 0.0);
    }

    #[test]
    fn biquad_flat_gain_passes_signal() {
        let mut f = BiquadFilter::peaking(44100, 1000.0, 0.0, 1.41);
        let input = 0.5f32;
        let out = f.process(input);
        assert!((out - input).abs() < 1e-5, "0dB filter should be near-identity: got {out}");
    }

    #[test]
    fn apply_eq_gains_flat_is_identity() {
        let gains = [0.0f32; 31];
        let mut samples = vec![0.3f32; 512];
        let orig = samples.clone();
        apply_eq_gains(&mut samples, &gains, 44100);
        for (a, b) in orig.iter().zip(samples.iter()) {
            assert!((a - b).abs() < 1e-4, "flat EQ should not change samples");
        }
    }
}
