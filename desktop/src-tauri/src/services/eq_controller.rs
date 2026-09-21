//! Equalizer APO / Peace CLI integration
//!
//! This module provides a clean abstraction over the EQ engine so we can
//! swap implementations later (e.g., custom APO, virtual device).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

/// ISO 266 31-band center frequencies (Hz)
pub const ISO_BANDS: [f32; 31] = [
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
    200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
    2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0,
];

/// A single parametric filter band (Peak, Low-Shelf, High-Shelf)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterBand {
    pub filter_type: FilterType,
    pub frequency_hz: f32,
    pub gain_db: f32,
    pub q: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FilterType {
    Peak,
    LowShelf,
    HighShelf,
}

/// Full 31-band graphic EQ profile (gains in dB at each ISO band)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphicEQProfile {
    pub name: String,
    pub gains_db: [f32; 31],
    pub preamp_db: f32,
}

/// Equalizer engine abstraction
pub trait EqEngine: Send + Sync {
    /// Apply a 31-band graphic EQ profile
    fn apply_graphic_eq(&self, profile: &GraphicEQProfile) -> Result<()>;

    /// Get current active profile name
    fn get_active_profile(&self) -> Option<String>;

    /// Check if engine is available
    fn is_available(&self) -> bool;
}

/// Equalizer APO engine — writes config.txt and signals Peace/APO to reload
pub struct EqualizerApoEngine {
    config_path: PathBuf,
    peace_cli_path: Option<PathBuf>,
}

impl EqualizerApoEngine {
    pub fn new() -> Result<Self> {
        // Equalizer APO config location: %ProgramData%\EqualizerAPO\config\config.txt
        let program_data = std::env::var("PROGRAMDATA")
            .context("PROGRAMDATA environment variable not set")?;
        let config_path = Path::new(&program_data)
            .join("EqualizerAPO")
            .join("config")
            .join("config.txt");

        // Try to find Peace CLI
        let peace_cli_path = Self::find_peace_cli();

        Ok(Self {
            config_path,
            peace_cli_path,
        })
    }

    fn find_peace_cli() -> Option<PathBuf> {
        // Peace installs to %LocalAppData%\Peace or similar
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let candidate = Path::new(&local_app_data).join("Peace").join("peace.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
        // Also check Program Files
        if let Ok(program_files) = std::env::var("PROGRAMFILES") {
            let candidate = Path::new(&program_files).join("Peace").join("peace.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
        None
    }

    /// Generate Equalizer APO config.txt content from a graphic EQ profile
    fn generate_config(&self, profile: &GraphicEQProfile) -> String {
        let mut lines = Vec::new();

        lines.push("# SonusPilot - Auto-generated EQ profile".to_string());
        lines.push(format!("Preamp: {:.1} dB", profile.preamp_db));
        lines.push("".to_string());

        // Add GraphicEQ line: "GraphicEQ: freq1 gain1; freq2 gain2; ..."
        let mut graphic_eq_parts = Vec::new();
        for (freq, gain) in ISO_BANDS.iter().zip(profile.gains_db.iter()) {
            graphic_eq_parts.push(format!("{} {:.1}", freq, gain));
        }
        lines.push(format!("GraphicEQ: {}", graphic_eq_parts.join("; ")));

        lines.join("\n")
    }

    /// Write config and signal reload
    fn write_and_reload(&self, profile: &GraphicEQProfile) -> Result<()> {
        let config_content = self.generate_config(profile);

        // Write config file
        std::fs::write(&self.config_path, config_content)
            .with_context(|| format!("Failed to write Equalizer APO config to {:?}", self.config_path))?;

        info!("Wrote EQ profile '{}' to Equalizer APO config", profile.name);

        // Signal Peace to reload if available
        if let Some(peace_path) = &self.peace_cli_path {
            let output = Command::new(peace_path)
                .args(["--reload"])
                .output()
                .context("Failed to execute Peace CLI --reload")?;

            if !output.status.success() {
                warn!("Peace CLI reload failed: {}", String::from_utf8_lossy(&output.stderr));
            } else {
                debug!("Signaled Peace to reload config");
            }
        }

        Ok(())
    }
}

impl EqEngine for EqualizerApoEngine {
    fn apply_graphic_eq(&self, profile: &GraphicEQProfile) -> Result<()> {
        self.write_and_reload(profile)
    }

    fn get_active_profile(&self) -> Option<String> {
        // Try to read current config and parse profile name from comment
        if let Ok(content) = std::fs::read_to_string(&self.config_path) {
            for line in content.lines() {
                if line.starts_with("# SonusPilot - ") {
                    return Some(line.trim_start_matches("# SonusPilot - ").to_string());
                }
            }
        }
        None
    }

    fn is_available(&self) -> bool {
        self.config_path.exists() || self.peace_cli_path.is_some()
    }
}

/// Mock engine for development/testing without Equalizer APO installed
pub struct MockEqEngine {
    current_profile: Mutex<Option<GraphicEQProfile>>,
}

impl MockEqEngine {
    pub fn new() -> Self {
        Self {
            current_profile: Mutex::new(None),
        }
    }
}

impl EqEngine for MockEqEngine {
    fn apply_graphic_eq(&self, profile: &GraphicEQProfile) -> Result<()> {
        info!("[MOCK EQ] Applied profile: {} (preamp: {:.1} dB)", profile.name, profile.preamp_db);
        for (freq, gain) in ISO_BANDS.iter().zip(profile.gains_db.iter()) {
            if gain.abs() > 0.05 {
                debug!("[MOCK EQ]   {} Hz: {:.1} dB", freq, gain);
            }
        }
        // In real implementation, we'd use a blocking write here
        // For mock, just store it
        let mut guard = self.current_profile.blocking_lock();
        *guard = Some(profile.clone());
        Ok(())
    }

    fn get_active_profile(&self) -> Option<String> {
        let guard = self.current_profile.blocking_lock();
        guard.as_ref().map(|p| p.name.clone())
    }

    fn is_available(&self) -> bool {
        true // Mock is always available
    }
}

/// Factory to create the appropriate EQ engine
pub fn create_eq_engine() -> Arc<dyn EqEngine> {
    // Try Equalizer APO first
    match EqualizerApoEngine::new() {
        Ok(engine) if engine.is_available() => {
            info!("Using Equalizer APO engine");
            Arc::new(engine)
        }
        Ok(_) => {
            warn!("Equalizer APO config not found, falling back to mock engine");
            Arc::new(MockEqEngine::new())
        }
        Err(e) => {
            warn!("Failed to initialize Equalizer APO engine: {}, using mock", e);
            Arc::new(MockEqEngine::new())
        }
    }
}

/// EQ Controller - manages profile transitions with crossfade
pub struct EqController {
    engine: Arc<dyn EqEngine>,
    current_profile: Mutex<Option<GraphicEQProfile>>,
    crossfade_duration_ms: u64,
}

impl EqController {
    pub fn new(engine: Arc<dyn EqEngine>) -> Self {
        Self {
            engine,
            current_profile: Mutex::new(None),
            crossfade_duration_ms: 20, // 20ms equal-power crossfade
        }
    }

    /// Set the active EQ profile (with crossfade for smooth transitions)
    pub async fn set_profile(&self, profile: GraphicEQProfile) -> Result<()> {
        let mut current = self.current_profile.lock().await;

        if let Some(ref old_profile) = *current {
            // In a real implementation, we'd do a smooth crossfade here
            // by running both filter chains and crossfading the output.
            // For Equalizer APO, we just swap configs - the audio engine handles it.
            debug!(
                "Switching EQ profile: '{}' -> '{}'",
                old_profile.name, profile.name
            );
        } else {
            info!("Setting initial EQ profile: '{}'", profile.name);
        }

        self.engine.apply_graphic_eq(&profile)?;
        *current = Some(profile);
        Ok(())
    }

    /// Get current active profile
    pub async fn get_current_profile(&self) -> Option<GraphicEQProfile> {
        let current = self.current_profile.lock().await;
        current.clone()
    }

    /// Set to flat/neutral
    pub async fn set_neutral(&self) -> Result<()> {
        let neutral = GraphicEQProfile {
            name: "Neutral (Flat)".to_string(),
            gains_db: [0.0; 31],
            preamp_db: 0.0,
        };
        self.set_profile(neutral).await
    }

    /// Check if engine is available
    pub fn is_available(&self) -> bool {
        self.engine.is_available()
    }
}

/// Tauri command types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EqProfilePayload {
    pub name: String,
    pub gains_db: Vec<f32>,
    pub preamp_db: f32,
}

impl TryFrom<EqProfilePayload> for GraphicEQProfile {
    type Error = anyhow::Error;

    fn try_from(payload: EqProfilePayload) -> Result<Self> {
        if payload.gains_db.len() != 31 {
            anyhow::bail!("Expected 31 gain values, got {}", payload.gains_db.len());
        }
        let mut gains = [0.0; 31];
        gains.copy_from_slice(&payload.gains_db);
        Ok(Self {
            name: payload.name,
            gains_db: gains,
            preamp_db: payload.preamp_db,
        })
    }
}