use crate::services::features::{FeatureExtractor, SAMPLE_RATE_HZ, FFT_SIZE};
use std::f32::consts::PI;

#[test]
fn test_feature_parity_with_sine_wave() {
    let freq = 1000.0;
    let mut samples = vec![0.0; FFT_SIZE];
    for i in 0..FFT_SIZE {
        samples[i] = (2.0 * PI * freq * (i as f32) / SAMPLE_RATE_HZ).sin();
    }
    
    let features = FeatureExtractor::extract(&samples);
    
    assert!((features.rms - 0.707).abs() < 0.05);
    
    let max_band_idx = features.spectral_bands.iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
        .map(|(idx, _)| idx)
        .unwrap();
    
    assert!(max_band_idx >= 17 && max_band_idx <= 19);
}

#[test]
fn test_level_independence() {
    let samples_high = vec![0.5; FFT_SIZE];
    let samples_low = vec![0.05; FFT_SIZE];
    
    let feat_high = FeatureExtractor::extract(&samples_high);
    let feat_low = FeatureExtractor::extract(&samples_low);
    
    assert!((feat_high.crest_factor - feat_low.crest_factor).abs() < 0.01);
}
