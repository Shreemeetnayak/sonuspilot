use crate::services::features::SongAudioFeatures;

pub struct EQReward {
    // Reference spectral profile for the genre
    pub target_spectral_distribution: Vec<f32>,
}

impl EQReward {
    pub fn new(target_spectral_distribution: Vec<f32>) -> Self {
        EQReward { target_spectral_distribution }
    }

    // Calculates a reward based on how close the current spectral features
    // are to the target reference profile. Higher reward = better match.
    pub fn calculate(&self, current_features: &SongAudioFeatures) -> f32 {
        let mut similarity = 0.0;
        for (idx, &band) in current_features.spectral_bands.iter().enumerate() {
            if let Some(&target) = self.target_spectral_distribution.get(idx) {
                // Simplified similarity metric: inverse difference
                similarity += 1.0 / (1.0 + (band - target).abs());
            }
        }
        similarity / current_features.spectral_bands.len() as f32
    }
}
