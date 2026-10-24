use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInput {
    pub audio_features: super::features::SongAudioFeatures,
    pub headphone_id: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelOutput {
    pub residual_gains: [f32; 31],
    pub confidence: f32,
}

pub trait ResidualModel: Send + Sync {
    fn infer(&self, input: &ModelInput) -> ModelOutput;
    fn version(&self) -> String;
}

pub struct DeterministicBaseline;

impl ResidualModel for DeterministicBaseline {
    fn infer(&self, _input: &ModelInput) -> ModelOutput {
        ModelOutput {
            residual_gains: [0.0; 31],
            confidence: 0.0,
        }
    }
    fn version(&self) -> String { "baseline-v1".to_string() }
}
