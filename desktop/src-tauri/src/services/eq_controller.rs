//! Equalizer APO / Peace CLI integration
//!
//! This module provides a clean abstraction over the EQ engine so we can
//! swap implementations later (e.g., custom APO, virtual device).

use crate::services::neural_eq_engine::NeuralEqEngine;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};
use ts_rs::TS;

/// First line of every config SonusPilot writes. Used to tell our file apart
/// from a config the user wrote by hand.
const SONUSPILOT_MARKER: &str = "# SonusPilot";

/// ISO 266 31-band center frequencies (Hz)
pub const ISO_BANDS: [f32; 31] = [
    20.0, 25.0, 31.5, 40.0, 50.0, 63.0, 80.0, 100.0, 125.0, 160.0,
    200.0, 250.0, 315.0, 400.0, 500.0, 630.0, 800.0, 1000.0, 1250.0, 1600.0,
    2000.0, 2500.0, 3150.0, 4000.0, 5000.0, 6300.0, 8000.0, 10000.0, 12500.0, 16000.0, 20000.0,
];

/// Full 31-band graphic EQ profile (gains in dB at each ISO band)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GraphicEQProfile {
    pub name: String,
    pub gains_db: [f32; 31],
    pub preamp_db: f32,
}

/// Engine status reported to the UI.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub struct EngineStatus {
    pub available: bool,
    pub reason: String,
    pub config_path: Option<String>,
    pub config_present: bool,
}

/// Equalizer engine abstraction
pub trait EqEngine: Send + Sync {
    /// Apply a 31-band graphic EQ profile
    fn apply_graphic_eq(&self, profile: &GraphicEQProfile) -> Result<()>;
    /// Apply DSP to audio samples
    fn apply_dsp(&self, samples: &[f32]) -> Vec<f32>;

    /// Get current active profile name
    fn get_active_profile(&self) -> Option<String>;

    /// Check if engine is available
    fn is_available(&self) -> bool;

    /// Why the engine cannot be used, when it cannot. Defaults to a generic
    /// message so an engine that is simply absent needs no extra code.
    fn unavailable_reason(&self) -> String {
        "Equalizer APO is not installed".to_string()
    }

    /// Path this engine writes to, when it has one.
    fn config_path(&self) -> Option<PathBuf> {
        None
    }
}

pub trait EqDecisionEngine: EqEngine {
    /// Attempt to apply a profile with fallback capability
    fn apply_with_fallback(&self, profile: &GraphicEQProfile, fallback: &GraphicEQProfile) -> Result<()> {
        match self.apply_graphic_eq(profile) {
            Ok(_) => Ok(()),
            Err(e) => {
                warn!("Primary EQ apply failed: {}, applying fallback", e);
                self.apply_graphic_eq(fallback)
            }
        }
    }
}

// Blanket implementation for all EqEngine types
impl<T: EqEngine> EqDecisionEngine for T {}

/// Equalizer APO engine — writes config.txt and signals Peace/APO to reload
pub struct EqualizerApoEngine {
    config_path: PathBuf,
    peace_cli_path: Option<PathBuf>,
}

impl EqualizerApoEngine {
    pub fn new() -> Result<Self> {
        // Equalizer APO's config.txt can live in several places depending on
        // how APO was installed. Probe the known locations and use the first
        // one that actually exists, so a per-user install does not break a
        // system-wide one and vice versa.
        let config_path = Self::find_config_path().ok_or_else(|| {
            anyhow::anyhow!(
                "Equalizer APO config.txt not found in any known location"
            )
        })?;

        // Try to find Peace CLI
        let peace_cli_path = Self::find_peace_cli();

        Ok(Self {
            config_path,
            peace_cli_path,
        })
    }

    pub fn new_with_path(config_path: PathBuf) -> Result<Self> {
        let peace_cli_path = Self::find_peace_cli();
        Ok(Self {
            config_path,
            peace_cli_path,
        })
    }

    /// Locate `config.txt` in any of the places Equalizer APO might have
    /// installed it. Returns None when APO is genuinely absent.
    fn find_config_path() -> Option<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();

        // Per-user install: %LOCALAPPDATA%\EqualizerAPO\config\config.txt
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                Path::new(&local_app_data)
                    .join("EqualizerAPO")
                    .join("config")
                    .join("config.txt"),
            );
        }

        // System-wide install: %ProgramData%\EqualizerAPO\config\config.txt
        if let Ok(program_data) = std::env::var("PROGRAMDATA") {
            candidates.push(
                Path::new(&program_data)
                    .join("EqualizerAPO")
                    .join("config")
                    .join("config.txt"),
            );
        }

        // Install-dir-relative: %ProgramFiles%\EqualizerAPO\config\config.txt
        for var in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
            if let Ok(program_files) = std::env::var(var) {
                candidates.push(
                    Path::new(&program_files)
                        .join("EqualizerAPO")
                        .join("config")
                        .join("config.txt"),
                );
            }
        }

        candidates.into_iter().find(|path| path.exists())
    }

    /// Equalizer APO reloads `config.txt` on every audio buffer when the file
    /// changes, so a plain write is enough. A Peace GUI can also be told to
    /// reload, but it is optional and its location is not fixed, so it is
    /// probed in the usual install locations and skipped when absent.
    fn find_peace_cli() -> Option<PathBuf> {
        let mut candidates: Vec<PathBuf> = Vec::new();
        for (var, sub) in [
            ("LOCALAPPDATA", "Peace"),
            ("PROGRAMFILES", "Peace"),
            ("PROGRAMFILES(X86)", "Peace"),
        ] {
            if let Ok(base) = std::env::var(var) {
                candidates.push(Path::new(&base).join(sub).join("peace.exe"));
            }
        }
        candidates.into_iter().find(|path| path.exists())
    }

    /// Generate Equalizer APO config content from a graphic EQ profile
    fn generate_config(&self, profile: &GraphicEQProfile) -> Result<String> {
        if !profile.preamp_db.is_finite() || profile.gains_db.iter().any(|g| !g.is_finite()) {
            anyhow::bail!("Gains or preamp contain non-finite values (NaN/inf)");
        }

        let mut lines = Vec::new();

        lines.push(format!("{SONUSPILOT_MARKER} — auto-generated, edit in SonusPilot instead of here"));
        lines.push(format!("# profile: {}", profile.name));

        // Clamp gains for safety (Max +6dB, Min -12dB)
        let clamped_gains: Vec<f32> = profile.gains_db.iter().map(|&g| g.clamp(-12.0, 6.0)).collect();

        // Derive preamp from max boost so it is always <= 0 (match computePreamp logic)
        let max_boost = clamped_gains.iter().cloned().filter(|&g| g > 0.0).fold(0.0, f32::max);
        let safe_preamp = (-max_boost).min(0.0).clamp(-12.0, 0.0);

        lines.push(format!("Preamp: {:.1} dB", safe_preamp));
        lines.push("".to_string());

        // Add GraphicEQ line: "GraphicEQ: freq1 gain1; freq2 gain2; ..."
        let mut graphic_eq_parts = Vec::new();
        for (freq, gain) in ISO_BANDS.iter().zip(clamped_gains.iter()) {
            graphic_eq_parts.push(format!("{} {:.1}", freq, gain));
        }
        lines.push(format!("GraphicEQ: {}", graphic_eq_parts.join("; ")));

        Ok(lines.join("\n"))
    }

    /// Write config atomically to sonuspilot.txt and update config.txt non-destructively
    fn write_and_reload(&self, profile: &GraphicEQProfile) -> Result<()> {
        let config_content = self.generate_config(profile)?;

        let parent_dir = self.config_path.parent().ok_or_else(|| anyhow::anyhow!("Invalid config path"))?;
        std::fs::create_dir_all(parent_dir)?;

        let sonuspilot_path = parent_dir.join("sonuspilot.txt");
        let tmp_path = parent_dir.join("sonuspilot.txt.tmp");

        // Atomic write: temp file then rename
        std::fs::write(&tmp_path, &config_content)
            .with_context(|| format!("Failed to write temp config to {:?}", tmp_path))?;
        std::fs::rename(&tmp_path, &sonuspilot_path)
            .with_context(|| format!("Failed to rename temp config to {:?}", sonuspilot_path))?;

        // Never overwrite user's own config.txt. Add Include line, backing up original first if needed.
        if self.config_path.exists() {
            let config_txt = std::fs::read_to_string(&self.config_path)?;
            let include_line = "Include: sonuspilot.txt";
            if !config_txt.contains(include_line) && !config_txt.contains("sonuspilot") {
                let bak_path = parent_dir.join("config.txt.bak");
                if !bak_path.exists() {
                    let _ = std::fs::copy(&self.config_path, &bak_path);
                }
                let new_config_txt = format!("{}\n{}\n", config_txt.trim_end(), include_line);
                std::fs::write(&self.config_path, new_config_txt)?;
            }
        } else {
            std::fs::write(&self.config_path, "Include: sonuspilot.txt\n")?;
        }

        info!("Wrote EQ profile '{}' to sonuspilot.txt and updated config.txt", profile.name);

        if let Some(peace_path) = &self.peace_cli_path {
            match Command::new(peace_path).args(["--reload"]).output() {
                Ok(output) if output.status.success() => debug!("Signaled Peace to reload config"),
                Ok(output) => warn!("Peace reload returned {:?}: {}", output.status, String::from_utf8_lossy(&output.stderr)),
                Err(e) => warn!("Peace reload could not run: {e}"),
            }
        }

        Ok(())
    }
}

impl EqualizerApoEngine {
    /// Remove a config SonusPilot created, so quitting does not leave a stale
    /// graphic EQ curve wired into the user's system audio.
    pub fn remove_if_ours(&self) {
        if let Ok(content) = std::fs::read_to_string(&self.config_path) {
            if content.starts_with(SONUSPILOT_MARKER) {
                let _ = std::fs::remove_file(&self.config_path);
                info!("Removed SonusPilot-managed Equalizer APO config");
            }
        }
    }
}

impl EqEngine for EqualizerApoEngine {

    fn apply_graphic_eq(&self, profile: &GraphicEQProfile) -> Result<()> {
        self.write_and_reload(profile)
    }

    fn apply_dsp(&self, samples: &[f32]) -> Vec<f32> {
        // EqualizerApoEngine does not support in-process DSP
        samples.to_vec()
    }

    fn get_active_profile(&self) -> Option<String> {
        let parent_dir = self.config_path.parent()?;
        let sonuspilot_path = parent_dir.join("sonuspilot.txt");
        for path in &[sonuspilot_path, self.config_path.clone()] {
            if let Ok(content) = std::fs::read_to_string(path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("# profile: ") {
                        return Some(trimmed.trim_start_matches("# profile: ").to_string());
                    }
                }
            }
        }
        None
    }

    fn is_available(&self) -> bool {
        // Only claim availability when Equalizer APO itself is installed, not
        // merely when a config file happens to exist.
        self.apo_installed()
    }

    fn config_path(&self) -> Option<PathBuf> {
        Some(self.config_path.clone())
    }
}

impl EqualizerApoEngine {
    /// Equalizer APO ships a Directory Configuration component; when that is
    /// registered, the system-wide processor is present.
    fn apo_installed(&self) -> bool {
        if let Ok(program_files) = std::env::var("PROGRAMFILES") {
            for sub in ["EqualizerAPO", "EqualizerAPO64"] {
                let dir = Path::new(&program_files).join(sub);
                if dir.join("bin").exists() || dir.join("config").exists() {
                    return true;
                }
            }
        }
        if let Some(parent) = self.config_path.parent().and_then(|p| p.parent()) {
            if parent.join("bin").exists() {
                return true;
            }
        }
        false
    }
}

/// Engine used when Equalizer APO is not installed. It reports itself as
/// unavailable and refuses every write, so the UI can show "preview only"
/// rather than implying the system audio changed.
pub struct UnavailableEqEngine {
    reason: String,
}

impl UnavailableEqEngine {
    pub fn new(reason: impl Into<String>) -> Self {
        Self { reason: reason.into() }
    }
}

impl EqEngine for UnavailableEqEngine {
    fn apply_graphic_eq(&self, profile: &GraphicEQProfile) -> Result<()> {
        anyhow::bail!("Equalizer APO unavailable ({}): '{}' not applied", self.reason, profile.name)
    }

    fn get_active_profile(&self) -> Option<String> {
        None
    }

    fn is_available(&self) -> bool {
        false
    }

    fn unavailable_reason(&self) -> String {
        self.reason.clone()
    }

    fn apply_dsp(&self, samples: &[f32]) -> Vec<f32> {
        samples.to_vec()
    }
}

/// Hybrid Engine: Neural Inference with Deterministic Fallback
pub struct HybridResidualEngine {
    neural: NeuralEqEngine,
    baseline: EqualizerApoEngine,
}

impl HybridResidualEngine {
    pub fn new(neural: NeuralEqEngine, baseline: EqualizerApoEngine) -> Self {
        Self { neural, baseline }
    }
}

impl EqEngine for HybridResidualEngine {
    fn apply_graphic_eq(&self, profile: &GraphicEQProfile) -> Result<()> {
        debug!("Hybrid Engine applying profile: {}", profile.name);

        // Phase 3: Neural Inference + Deterministic Fallback
        let features = [0.0; 31];
        match self.neural.predict(&features) {
            Ok(residual_gains) => {
                let mut combined_gains = profile.gains_db;
                for i in 0..combined_gains.len().min(residual_gains.len()) {
                    combined_gains[i] += residual_gains[i];
                }
                let combined_profile = GraphicEQProfile {
                    name: format!("{}-neural", profile.name),
                    gains_db: combined_gains,
                    preamp_db: profile.preamp_db,
                };
                self.baseline.apply_graphic_eq(&combined_profile)
            }
            Err(e) => {
                warn!("Neural inference failed: {}, falling back to baseline", e);
                self.baseline.apply_graphic_eq(profile)
            }
        }
    }

    fn get_active_profile(&self) -> Option<String> {
        self.baseline.get_active_profile()
    }

    fn is_available(&self) -> bool {
        self.baseline.is_available()
    }

    fn unavailable_reason(&self) -> String {
        self.baseline.unavailable_reason()
    }

    fn apply_dsp(&self, samples: &[f32]) -> Vec<f32> {
        self.baseline.apply_dsp(samples)
    }
}

// Remove lines 357-385 (the HybridEqEngine definition and implementation)
// They are redundant as HybridResidualEngine (lines 307-355) is the correct, implemented engine.


/// Factory to create the appropriate EQ engine.
pub fn create_eq_engine() -> Arc<dyn EqDecisionEngine> {
    match EqualizerApoEngine::new() {
        Ok(engine) if engine.is_available() => {
            info!("Using Equalizer APO engine at {:?}", engine.config_path);
            Arc::new(engine)
        }
        Ok(engine) => {
            let path = engine.config_path.clone();
            warn!("Equalizer APO not installed (no config at {:?}) — EQ stays preview only", path);
            Arc::new(UnavailableEqEngine::new(format!("no config at {}", path.display())))
        }
        Err(e) => {
            warn!("Equalizer APO initialisation failed: {e} — EQ stays preview only");
            Arc::new(UnavailableEqEngine::new(e.to_string()))
        }
    }
}

/// EQ Controller - manages profile transitions with crossfade
pub struct EqController {
    engine: Arc<dyn EqDecisionEngine>,
    current_profile: Mutex<Option<GraphicEQProfile>>,
    cache: Mutex<HashMap<String, GraphicEQProfile>>,
}

impl EqController {
    pub fn new(engine: Arc<dyn EqDecisionEngine>) -> Self {
        Self {
            engine,
            current_profile: Mutex::new(None),
            cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn apply_dsp(&self, samples: &[f32]) -> Vec<f32> {
        self.engine.apply_dsp(samples)
    }
    pub async fn set_profile(&self, profile: GraphicEQProfile) -> Result<()> {
        {
            let mut cache = self.cache.lock().await;
            cache.insert(profile.name.clone(), profile.clone());
        }

        let mut current = self.current_profile.lock().await;

        if let Some(ref old_profile) = *current {
            debug!(
                "Switching EQ profile: '{}' -> '{}'",
                old_profile.name, profile.name
            );
        } else {
            info!("Setting initial EQ profile: '{}'", profile.name);
        }

        // Apply with neutral as fallback
        let neutral = GraphicEQProfile {
            name: "Neutral (Flat)".to_string(),
            gains_db: [0.0; 31],
            preamp_db: 0.0,
        };

        self.engine.apply_with_fallback(&profile, &neutral)?;
        *current = Some(profile);
        Ok(())
    }

    pub async fn get_current_profile(&self) -> Option<GraphicEQProfile> {
        let current = self.current_profile.lock().await;
        current.clone()
    }

    /// Get current active gains
    pub async fn get_current_gains(&self) -> Option<[f32; 31]> {
        self.get_current_profile().await.map(|p| p.gains_db)
    }

    /// Get a profile from the cache by name
    pub async fn get_cached_profile(&self, name: &str) -> Option<GraphicEQProfile> {
        let cache = self.cache.lock().await;
        cache.get(name).cloned()
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

    /// Full engine status, including why it is unusable when it is.
    pub fn status(&self) -> EngineStatus {
        let available = self.engine.is_available();
        EngineStatus {
            available,
            reason: if available {
                "Equalizer APO is installed and SonusPilot can write its configuration."
                    .to_string()
            } else {
                self.engine.unavailable_reason().to_string()
            },
            config_path: self.engine.config_path().map(|p| p.display().to_string()),
            config_present: self.engine.config_path().is_some(),
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_finite_gains() {
        let dir = std::env::temp_dir().join(format!("sonuspilot_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        let config_path = dir.join("config.txt");
        let engine = EqualizerApoEngine::new_with_path(config_path).unwrap();

        let profile_nan = GraphicEQProfile {
            name: "nan-test".into(),
            gains_db: [f32::NAN; 31],
            preamp_db: 0.0,
        };
        assert!(engine.apply_graphic_eq(&profile_nan).is_err());

        let profile_inf = GraphicEQProfile {
            name: "inf-test".into(),
            gains_db: [0.0; 31],
            preamp_db: f32::INFINITY,
        };
        assert!(engine.apply_graphic_eq(&profile_inf).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clamps_gains_and_derives_preamp() {
        let dir = std::env::temp_dir().join(format!("sonuspilot_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        let config_path = dir.join("config.txt");
        let engine = EqualizerApoEngine::new_with_path(config_path.clone()).unwrap();

        let mut gains = [0.0; 31];
        gains[0] = 15.0; // Above +6.0 clamp
        gains[1] = -20.0; // Below -12.0 clamp

        let profile = GraphicEQProfile {
            name: "clamp-test".into(),
            gains_db: gains,
            preamp_db: 5.0, // Positive preamp requested, should be forced <= 0
        };

        engine.apply_graphic_eq(&profile).unwrap();

        let sonuspilot_content = std::fs::read_to_string(dir.join("sonuspilot.txt")).unwrap();
        assert!(sonuspilot_content.contains("Preamp: -6.0 dB") || sonuspilot_content.contains("Preamp: -6"));
        assert!(sonuspilot_content.contains("6.0")); // Clamped from 15.0
        assert!(sonuspilot_content.contains("-12.0")); // Clamped from -20.0

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preserves_user_config_and_adds_include() {
        let dir = std::env::temp_dir().join(format!("sonuspilot_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        let config_path = dir.join("config.txt");

        // Write user's existing config.txt
        std::fs::write(&config_path, "Device: Speakers\n").unwrap();

        let engine = EqualizerApoEngine::new_with_path(config_path.clone()).unwrap();
        let profile = GraphicEQProfile {
            name: "include-test".into(),
            gains_db: [0.0; 31],
            preamp_db: 0.0,
        };

        engine.apply_graphic_eq(&profile).unwrap();

        // Check user config was not overwritten, but Include was added
        let config_txt = std::fs::read_to_string(&config_path).unwrap();
        assert!(config_txt.contains("Device: Speakers"));
        assert!(config_txt.contains("Include: sonuspilot.txt"));

        // Check backup was created
        let bak_path = dir.join("config.txt.bak");
        assert!(bak_path.exists());
        let bak_txt = std::fs::read_to_string(&bak_path).unwrap();
        assert_eq!(bak_txt, "Device: Speakers\n");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_active_profile_headers() {
        let dir = std::env::temp_dir().join(format!("sonuspilot_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        let config_path = dir.join("config.txt");
        let engine = EqualizerApoEngine::new_with_path(config_path).unwrap();

        let profile = GraphicEQProfile {
            name: "My-Special-Profile".into(),
            gains_db: [0.0; 31],
            preamp_db: 0.0,
        };

        engine.apply_graphic_eq(&profile).unwrap();
        assert_eq!(engine.get_active_profile(), Some("My-Special-Profile".into()));

        let _ = std::fs::remove_dir_all(&dir);
    }
}
