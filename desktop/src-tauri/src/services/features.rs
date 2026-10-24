use rustfft::{num_complex::Complex32, FftPlanner};
use serde::{Deserialize, Serialize};

pub const ISO_BANDS_HZ: [f32; 31] = [
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
    200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
    2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0,
    16000.0, 20000.0,
];

pub const SAMPLE_RATE_HZ: f32 = 44_100.0;
pub const FFT_SIZE: usize = 2_048;
pub const FFT_HOP_SIZE: usize = 1_024;
pub const ROLLOFF_FRACTION: f32 = 0.85;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongAudioFeatures {
    pub rms: f32,
    pub peak: f32,
    pub crest_factor: f32,
    pub spectral_bands: Vec<f32>,
    pub band_ratios: Vec<f32>,
    pub spectral_centroid_hz: f32,
    pub spectral_rolloff_hz: f32,
    pub spectral_flux: f32,
    pub transient_density: f32,
    pub low_energy: f32,
    pub mid_energy: f32,
    pub high_energy: f32,
    pub effective_bandwidth_hz: f32,
}

pub struct FeatureExtractor;

impl FeatureExtractor {
    pub fn extract(samples: &[f32]) -> SongAudioFeatures {
        Self::extract_at_sample_rate(samples, SAMPLE_RATE_HZ)
    }

    pub fn extract_at_sample_rate(samples: &[f32], sample_rate_hz: f32) -> SongAudioFeatures {
        let rms = root_mean_square(samples);
        let peak = samples.iter().fold(0.0_f32, |current, sample| current.max(sample.abs()));
        let crest_factor = if rms > 0.0 { peak / rms } else { 0.0 };
        let frames = spectral_frames(samples, sample_rate_hz);
        let band_energies = average_band_energies(&frames, sample_rate_hz);
        let total_band_energy = band_energies.iter().sum::<f32>();
        let band_ratios = if total_band_energy > 0.0 {
            band_energies.iter().map(|energy| energy / total_band_energy).collect()
        } else {
            vec![0.0; ISO_BANDS_HZ.len()]
        };
        let spectrum = average_spectrum(&frames);
        let spectral_centroid_hz = spectral_centroid(&spectrum, sample_rate_hz);
        let spectral_rolloff_hz = spectral_rolloff(&spectrum, sample_rate_hz);
        let spectral_flux = spectral_flux(&frames);
        let transient_density = transient_density(&frames);
        let effective_bandwidth_hz = effective_bandwidth(&spectrum, sample_rate_hz);
        let low_energy = summed_band_energy(&band_energies, 20.0, 250.0);
        let mid_energy = summed_band_energy(&band_energies, 250.0, 4_000.0);
        let high_energy = summed_band_energy(&band_energies, 4_000.0, effective_bandwidth_hz);

        SongAudioFeatures {
            rms,
            peak,
            crest_factor,
            spectral_bands: band_energies,
            band_ratios,
            spectral_centroid_hz,
            spectral_rolloff_hz,
            spectral_flux,
            transient_density,
            low_energy,
            mid_energy,
            high_energy,
            effective_bandwidth_hz,
        }
    }
}

fn root_mean_square(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
}

fn spectral_frames(samples: &[f32], _sample_rate_hz: f32) -> Vec<Vec<f32>> {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);
    let window = hann_window();
    let padded_samples = if samples.len() < FFT_SIZE {
        let mut padded = samples.to_vec();
        padded.resize(FFT_SIZE, 0.0);
        padded
    } else {
        samples.to_vec()
    };
    let starts = if padded_samples.len() == FFT_SIZE {
        vec![0]
    } else {
        (0..=padded_samples.len() - FFT_SIZE).step_by(FFT_HOP_SIZE).collect()
    };

    starts.into_iter().map(|start| {
        let mut buffer = padded_samples[start..start + FFT_SIZE]
            .iter()
            .zip(window.iter())
            .map(|(sample, weight)| Complex32::new(sample * weight, 0.0))
            .collect::<Vec<_>>();
        fft.process(&mut buffer);
        buffer[..=FFT_SIZE / 2]
            .iter()
            .map(|bin| bin.norm_sqr() / FFT_SIZE as f32)
            .collect()
    }).collect()
}

fn hann_window() -> Vec<f32> {
    (0..FFT_SIZE)
        .map(|index| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * index as f32 / FFT_SIZE as f32).cos())
        .collect()
}

fn average_spectrum(frames: &[Vec<f32>]) -> Vec<f32> {
    if frames.is_empty() {
        return vec![0.0; FFT_SIZE / 2 + 1];
    }

    let mut average = vec![0.0; frames[0].len()];
    for frame in frames {
        for (value, sum) in frame.iter().zip(average.iter_mut()) {
            *sum += value;
        }
    }
    for value in &mut average {
        *value /= frames.len() as f32;
    }
    average
}

fn average_band_energies(frames: &[Vec<f32>], sample_rate_hz: f32) -> Vec<f32> {
    let spectrum = average_spectrum(frames);
    ISO_BANDS_HZ.iter().enumerate().map(|(index, _)| {
        let (lower_hz, upper_hz) = band_edges(index);
        band_energy(&spectrum, sample_rate_hz, lower_hz, upper_hz)
    }).collect()
}

fn band_edges(index: usize) -> (f32, f32) {
    let center = ISO_BANDS_HZ[index];
    let lower = if index == 0 {
        center / 2.0_f32.sqrt()
    } else {
        (ISO_BANDS_HZ[index - 1] * center).sqrt()
    };
    let upper = if index + 1 == ISO_BANDS_HZ.len() {
        center * 2.0_f32.sqrt()
    } else {
        (center * ISO_BANDS_HZ[index + 1]).sqrt()
    };
    (lower, upper)
}

fn band_energy(spectrum: &[f32], sample_rate_hz: f32, lower_hz: f32, upper_hz: f32) -> f32 {
    let bin_width = sample_rate_hz / FFT_SIZE as f32;
    spectrum.iter().enumerate()
        .filter(|(index, _)| {
            let frequency = *index as f32 * bin_width;
            frequency >= lower_hz && frequency < upper_hz
        })
        .map(|(_, power)| power)
        .sum()
}

fn spectral_centroid(spectrum: &[f32], sample_rate_hz: f32) -> f32 {
    let bin_width = sample_rate_hz / FFT_SIZE as f32;
    let total = spectrum.iter().sum::<f32>();
    if total == 0.0 {
        return 0.0;
    }

    spectrum.iter().enumerate().map(|(index, power)| index as f32 * bin_width * power).sum::<f32>() / total
}

fn spectral_rolloff(spectrum: &[f32], sample_rate_hz: f32) -> f32 {
    let total = spectrum.iter().sum::<f32>();
    if total == 0.0 {
        return 0.0;
    }

    let threshold = total * ROLLOFF_FRACTION;
    let bin_width = sample_rate_hz / FFT_SIZE as f32;
    let mut cumulative = 0.0;
    for (index, power) in spectrum.iter().enumerate() {
        cumulative += power;
        if cumulative >= threshold {
            return index as f32 * bin_width;
        }
    }
    sample_rate_hz / 2.0
}

fn spectral_flux(frames: &[Vec<f32>]) -> f32 {
    if frames.len() < 2 {
        return 0.0;
    }

    let flux_sum = frames.windows(2).map(|pair| {
        pair[1].iter().zip(pair[0].iter())
            .map(|(current, previous)| (current.sqrt() - previous.sqrt()).max(0.0))
            .sum::<f32>()
    }).sum::<f32>();
    flux_sum / (frames.len() - 1) as f32
}

fn transient_density(frames: &[Vec<f32>]) -> f32 {
    if frames.len() < 2 {
        return 0.0;
    }

    let frame_energy = frames.iter().map(|frame| frame.iter().sum::<f32>()).collect::<Vec<_>>();
    let average = frame_energy.iter().sum::<f32>() / frame_energy.len() as f32;
    let threshold = average * 1.5;
    frame_energy.windows(2).filter(|pair| pair[1] > threshold && pair[0] <= threshold).count() as f32
        / (frames.len() - 1) as f32
}

fn effective_bandwidth(spectrum: &[f32], sample_rate_hz: f32) -> f32 {
    spectral_rolloff(spectrum, sample_rate_hz)
}

fn summed_band_energy(band_energies: &[f32], lower_hz: f32, upper_hz: f32) -> f32 {
    ISO_BANDS_HZ.iter().zip(band_energies.iter())
        .filter(|(frequency, _)| **frequency >= lower_hz && **frequency < upper_hz)
        .map(|(_, energy)| energy)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(frequency_hz: f32, amplitude: f32, seconds: f32) -> Vec<f32> {
        (0..(SAMPLE_RATE_HZ * seconds) as usize)
            .map(|index| amplitude * (2.0 * std::f32::consts::PI * frequency_hz * index as f32 / SAMPLE_RATE_HZ).sin())
            .collect()
    }

    #[test]
    fn silence_features_are_zero_and_finite() {
        let features = FeatureExtractor::extract(&vec![0.0; FFT_SIZE]);
        assert_eq!(features.rms, 0.0);
        assert_eq!(features.peak, 0.0);
        assert_eq!(features.crest_factor, 0.0);
        assert!(features.spectral_bands.iter().all(|value| *value == 0.0));
        assert!(features.band_ratios.iter().all(|value| *value == 0.0));
        assert!(features.spectral_centroid_hz.is_finite());
        assert!(features.spectral_rolloff_hz.is_finite());
    }

    #[test]
    fn sine_energy_is_largest_in_its_matching_band() {
        let features = FeatureExtractor::extract(&sine(1_000.0, 0.5, 1.0));
        let strongest_band = features.spectral_bands.iter().enumerate()
            .max_by(|(_, left), (_, right)| left.total_cmp(right)).unwrap().0;
        assert_eq!(ISO_BANDS_HZ[strongest_band], 1_000.0);
        assert!((features.spectral_centroid_hz - 1_000.0).abs() < 30.0);
    }

    #[test]
    fn rms_peak_and_crest_scale_with_level() {
        let quiet = FeatureExtractor::extract(&sine(1_000.0, 0.1, 1.0));
        let loud = FeatureExtractor::extract(&sine(1_000.0, 0.5, 1.0));
        assert!((loud.rms / quiet.rms - 5.0).abs() < 0.01);
        assert!((loud.peak / quiet.peak - 5.0).abs() < 0.01);
        assert!((loud.crest_factor - quiet.crest_factor).abs() < 0.001);
        assert!((loud.band_ratios[17] - quiet.band_ratios[17]).abs() < 0.001);
        assert!((loud.spectral_centroid_hz - quiet.spectral_centroid_hz).abs() < 1.0);
    }

    #[test]
    fn impulse_has_transient_and_broadband_energy() {
        let mut impulse = vec![0.0; FFT_SIZE * 3];
        impulse[FFT_SIZE] = 1.0;
        let features = FeatureExtractor::extract(&impulse);
        assert!(features.transient_density > 0.0);
        assert!(features.spectral_bands.iter().filter(|energy| **energy > 0.0).count() > 20);
    }
}
