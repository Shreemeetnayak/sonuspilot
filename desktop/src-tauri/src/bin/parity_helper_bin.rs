use desktop_lib::services::features::FeatureExtractor;
use std::io::{self, Read};
use serde_json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut buffer = Vec::new();
    io::stdin().read_to_end(&mut buffer)?;
    let samples: Vec<f32> = buffer.chunks_exact(4)
        .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
        .collect();
    let features = FeatureExtractor::extract(&samples);
    println!("{}", serde_json::to_string(&features)?);
    Ok(())
}
