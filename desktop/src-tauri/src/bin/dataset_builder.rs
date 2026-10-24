use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;
use tracing::{info, warn};

mod artist_split;

use artist_split::get_split;

#[derive(Debug, Serialize, Deserialize)]
pub struct PerceptualFeedbackEvent {
    pub schema_version: String,
    pub timestamp: u64,
    pub feedback_type: String,
    pub headphone_profile_id: String,
    pub baseline_eq: [f32; 31],
    pub feedback_delta: [f32; 31],
    pub artist_id: Option<String>,
    pub feature_context_status: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TrainingExample {
    pub timestamp: u64,
    pub headphone_profile_id: String,
    pub baseline_eq: [f32; 31],
    pub target_residual_eq: [f32; 31],
    pub schema_version: String,
    pub split: String,
}

fn validate_event(event: &PerceptualFeedbackEvent) -> Result<()> {
    if event.schema_version != "1.0.0" {
        return Err(anyhow::anyhow!("Invalid schema version"));
    }
    if event.feature_context_status == "missing" {
        return Err(anyhow::anyhow!("missing_audio_features"));
    }
    Ok(())
}

fn main() -> Result<()> {
    let input_path = "feedback_events.jsonl";
    if !Path::new(input_path).exists() {
        info!("DATASET STATUS: EMPTY");
        return Ok(());
    }

    let file = File::open(input_path).context("Failed to open events file")?;
    let reader = BufReader::new(file);

    let mut valid_count = 0;
    let mut invalid_count = 0;
    let mut rejected_missing_features = 0;
    let mut examples = Vec::new();

    for line in reader.lines() {
        let line = line.context("Failed to read line")?;
        let event: PerceptualFeedbackEvent = match serde_json::from_str(&line) {
            Ok(e) => e,
            Err(err) => {
                warn!("Invalid JSON: {}", err);
                invalid_count += 1;
                continue;
            }
        };

        match validate_event(&event) {
            Ok(_) => {
                valid_count += 1;
                examples.push(TrainingExample {
                    timestamp: event.timestamp,
                    headphone_profile_id: event.headphone_profile_id,
                    baseline_eq: event.baseline_eq,
                    target_residual_eq: event.feedback_delta,
                    split: get_split(event.artist_id.as_deref().unwrap_or("unknown")).to_string(),
                    schema_version: "1.0.0".to_string(),
                });
            }
            Err(e) if e.to_string() == "missing_audio_features" => {
                rejected_missing_features += 1;
            }
            Err(err) => {
                warn!("Validation error: {}", err);
                invalid_count += 1;
            }
        }
    }

    info!("DATASET STATUS: COLLECTING");
    info!("TOTAL EVENTS: {}", valid_count + invalid_count + rejected_missing_features);
    info!("VALID: {}", valid_count);
    info!("REJECTED_MISSING_FEATURES: {}", rejected_missing_features);
    info!("REJECTED_INVALID: {}", invalid_count);

    fs::write("dataset.json", serde_json::to_string_pretty(&examples).context("Failed to serialize dataset")?)
        .context("Failed to save dataset.json")?;

    Ok(())
}
