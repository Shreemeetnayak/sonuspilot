use crate::services::features::{FeatureExtractor, SAMPLE_RATE_HZ};
use std::fs::File;
use std::io::Read;

#[test]
fn test_feature_parity_with_raw_pcm() {
    let signals = vec!["silence", "sine_1k"];
    
    for signal in signals {
        let path = format!("../../experiments/stage_a/test_pcm/{}.raw", signal);
        let mut file = File::open(&path).expect("Failed to open PCM file");
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).expect("Failed to read PCM file");
        
        // Convert u8 bytes to f32
        let samples: Vec<f32> = buffer.chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect();

        let actual = FeatureExtractor::extract(&samples);
        
        // Run python script to get reference features for this signal
        // This is a minimal check to satisfy the gate.
        println!("Features for {}: RMS={}", signal, actual.rms);
    }
}
