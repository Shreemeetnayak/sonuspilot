use crate::services::features::{FeatureExtractor, SAMPLE_RATE_HZ};
use std::fs::File;
use std::io::Read;
use std::path::Path;

#[test]
fn test_feature_parity_with_raw_pcm() {
    let signals = vec!["silence", "sine_1k"];
    
    for signal in signals {
        // Try multiple paths due to unpredictable cwd
        let paths = vec![
            format!("../../experiments/stage_a/test_pcm/{}.raw", signal),
            format!("experiments/stage_a/test_pcm/{}.raw", signal),
            format!("test_pcm/{}.raw", signal),
        ];
        
        let path = paths.iter().find(|p| Path::new(p).exists()).expect("Failed to find PCM file");
        
        let mut file = File::open(path).expect("Failed to open PCM file");
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).expect("Failed to read PCM file");
        
        let samples: Vec<f32> = buffer.chunks_exact(4)
            .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
            .collect();

        let f = FeatureExtractor::extract(&samples);
        println!("SIGNAL: {}", signal);
        println!("rms: {}", f.rms);
        println!("peak: {}", f.peak);
    }
}
