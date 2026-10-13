use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Write, BufRead, BufReader};

#[derive(Debug, Serialize, Deserialize)]
pub struct TestEvent {
    pub schema_version: String,
    pub timestamp: u64,
    pub feedback_type: String,
    pub headphone_profile_id: String,
    pub baseline_eq: Vec<f32>,
    pub feedback_delta: Vec<f32>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let test_path = "test_feedback_events.jsonl";
    let event = TestEvent {
        schema_version: "0.1.0".to_string(),
        timestamp: 123456789,
        feedback_type: "muddy".to_string(),
        headphone_profile_id: "test-hp".to_string(),
        baseline_eq: vec![0.0; 31],
        feedback_delta: vec![0.0; 31],
    };

    let mut file = File::create(test_path)?;
    file.write_all(serde_json::to_string(&event)?.as_bytes())?;
    file.write_all(b"\n")?;

    // Verify it was persisted correctly
    let file = File::open(test_path)?;
    let reader = BufReader::new(file);
    let lines: Vec<_> = reader.lines().collect::<Result<_, _>>()?;
    assert_eq!(lines.len(), 1);

    fs::remove_file(test_path)?;
    println!("PERSISTENCE_TEST_PASSED");
    Ok(())
}
