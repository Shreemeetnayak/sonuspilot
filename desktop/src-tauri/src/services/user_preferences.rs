use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FeedbackType {
    ExplicitEqEdit,
    NaturalLanguage,
    PassiveBehavior,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreference {
    pub timestamp: u64,
    pub track_id: String,
    pub artist: String,
    pub headphone_profile: String,
    pub output_device: String,
    pub baseline_eq: [f32; 31],
    pub audio_features: Vec<f32>,
    pub metadata_features: Vec<f32>,
    pub feedback_type: FeedbackType,
    pub user_modification: [f32; 31],
    pub target_residual_eq: [f32; 31],
    pub confidence: f32,
    pub schema_version: String,
}

pub fn save_preference(pref: UserPreference) -> Result<(), String> {
    // Basic validation
    if pref.target_residual_eq.iter().any(|g| g.abs() > 12.0) {
        return Err("Unsafe residual EQ".to_string());
    }
    if pref.baseline_eq.len() != 31 || pref.user_modification.len() != 31 {
        return Err("Invalid EQ dimensions".to_string());
    }

    let path = PathBuf::from("user_preferences.json");
    let mut data = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<Vec<UserPreference>>(&content).unwrap_or_default()
    } else {
        Vec::new()
    };
    data.push(pref);
    fs::write(path, serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
