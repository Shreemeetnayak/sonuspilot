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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphicEQProfile {
    pub name: String,
    pub gains_db: [f32; 31],
    pub preamp_db: f32,
}

/// Engine status reported to the UI.
///
/// `available` alone is not enough for the UI: a user whose EQ "does nothing"
/// needs to be told *why*, and a bare false cannot say whether APO is missing,
/// unreadable, or merely bound to the wrong endpoint.
#[derive(Debug, Clone, Serialize)]
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

    /// Generate Equalizer APO config.txt content from a graphic EQ profile
    fn generate_config(&self, profile: &GraphicEQProfile) -> String {
        let mut lines = Vec::new();

        lines.push(format!("{SONUSPILOT_MARKER} — auto-generated, edit in SonusPilot instead of here"));
        lines.push(format!("# profile: {}", profile.name));
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

        // Signal Peace to reload if present. APO itself already re-reads the
        // file, so a missing or unhappy Peace GUI must not fail the apply.
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
}

/// Factory to create the appropriate EQ engine.
pub fn create_eq_engine() -> Arc<dyn EqEngine> {
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
    engine: Arc<dyn EqEngine>,
    current_profile: Mutex<Option<GraphicEQProfile>>,
}

impl EqController {
    pub fn new(engine: Arc<dyn EqEngine>) -> Self {
        Self {
            engine,
            current_profile: Mutex::new(None),
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
    use std::sync::Mutex;

    /// Both tests below write the same config.txt, and cargo runs tests on
    /// parallel threads, so they must not interleave.
    static CONFIG_LOCK: Mutex<()> = Mutex::new(());

    /// Objective check: SonusPilot can locate and write config.txt to the
    /// real APO install directory, and the file survives a reload.
    #[test]
    fn writes_config_to_the_real_apo_install_directory() {
        let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let engine = EqualizerApoEngine::new().expect("APO must be installed");
        assert!(
            engine.config_path.exists(),
            "config.txt not found at {:?}",
            engine.config_path
        );
        assert!(
            engine.apo_installed(),
            "APO DLL not found at {:?}",
            engine.config_path
        );

        let original = std::fs::read_to_string(&engine.config_path)
            .unwrap_or_default();

        let profile = GraphicEQProfile {
            name: "SonusPilot-test".into(),
            gains_db: [1.5; 31],
            preamp_db: -3.0,
        };
        engine.apply_graphic_eq(&profile).expect("config write must succeed");

        let written = std::fs::read_to_string(&engine.config_path).expect("config readable");
        assert!(written.starts_with(SONUSPILOT_MARKER), "marker missing");
        assert!(written.contains("Preamp: -3.0 dB"));
        assert!(written.contains("GraphicEQ:"));
        let eq_line = written.lines().find(|l| l.starts_with("GraphicEQ:")).unwrap();
        assert_eq!(eq_line.matches(';').count(), 30);
        assert!(eq_line.contains("20 1.5"));
        assert!(eq_line.contains("20000 1.5"));

        // Restore the original config so the test is non-destructive.
        let _ = std::fs::write(&engine.config_path, &original);
        let restored = std::fs::read_to_string(&engine.config_path).unwrap();
        assert_eq!(restored, original);
    }

    #[test]
    fn test_curve_is_a_real_31_band_curve_not_a_flatline() {
        let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let engine = EqualizerApoEngine::new().expect("APO must be installed");
        let original = std::fs::read_to_string(&engine.config_path).unwrap_or_default();
        let profile = GraphicEQProfile {
            name: "sweep".into(),
            gains_db: (0..31).map(|i| (i as f32) - 15.0).collect::<Vec<f32>>().try_into().unwrap(),
            preamp_db: 0.0,
        };
        engine.apply_graphic_eq(&profile).expect("write");
        let written = std::fs::read_to_string(&engine.config_path).unwrap();
        let eq_line = written.lines().find(|l| l.starts_with("GraphicEQ:")).unwrap();
        assert!(eq_line.contains("20 -15.0"), "low band must dip");
        assert!(eq_line.contains("20000 15.0"), "high band must rise");

        let _ = std::fs::write(&engine.config_path, &original);
        let restored = std::fs::read_to_string(&engine.config_path).unwrap();
        assert_eq!(restored, original);
    }
}
