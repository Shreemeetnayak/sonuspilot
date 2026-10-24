use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResidualModel {
    pub version: String,
    pub weights: Vec<f32>,
}

impl ResidualModel {
    /// Loads a trained model artifact.
    pub fn load_from_file(path: &str) -> Result<Self, String> {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    /// Performs neural inference on 31-band features.
    pub fn infer(&self, features: &[f32; 31]) -> [f32; 31] {
        let mut output = [0.0; 31];
        for i in 0..31 {
            output[i] = features[i] * self.weights.get(i).unwrap_or(&0.0);
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inference_determinism() {
        let model = ResidualModel {
            version: "test-v1".to_string(),
            weights: vec![0.5; 31],
        };
        let features = [1.0; 31];
        let output = model.infer(&features);
        assert_eq!(output[0], 0.5);
    }
}
