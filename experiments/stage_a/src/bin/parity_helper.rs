use desktop_lib::services::features::FeatureExtractor;
use std::io::{self, Read};
use serde_json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut buffer = Vec::new();
    io::stdin().read_to_end(&mut buffer)?;
    let samples: Vec<f32> = serde_json::from_slice(&buffer)?;
    let features = FeatureExtractor::extract(&samples);
    println!("{}", serde_json::to_string(&features)?);
    Ok(())
}
