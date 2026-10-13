use serde::{Deserialize, Serialize};
use crate::services::features::{FeatureExtractor, SongAudioFeatures, SAMPLE_RATE_HZ};

#[test]
fn test_features_rms_sanity() {
    let samples = vec![0.0, 0.5, 0.0, -0.5];
    let features = FeatureExtractor::extract(&samples);
    assert!((features.rms - 0.3535).abs() < 0.001);
}

#[test]
fn test_features_zero_input() {
    let samples = vec![0.0; 2048];
    let features = FeatureExtractor::extract(&samples);
    assert_eq!(features.rms, 0.0);
    assert_eq!(features.peak, 0.0);
}

#[test]
fn test_features_sine_energy() {
    let t = (0..2048).map(|i| (i as f32) / SAMPLE_RATE_HZ).collect::<Vec<_>>();
    let samples: Vec<f32> = t.iter().map(|&t| 0.5 * (2.0 * std::f32::consts::PI * 1000.0 * t).sin()).collect();

    let features = FeatureExtractor::extract(&samples);

    let mid_bands_sum: f32 = features.spectral_bands[10..20].iter().sum();
    let other_bands_sum: f32 = features.spectral_bands.iter().sum::<f32>() - mid_bands_sum;

    assert!(mid_bands_sum > other_bands_sum, "1kHz energy should be concentrated in mid bands");
}
