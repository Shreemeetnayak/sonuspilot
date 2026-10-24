pub mod services;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use services::eq_controller::{create_eq_engine, EqController, GraphicEQProfile, EqProfilePayload};
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
async fn append_feedback_event(event: serde_json::Value) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let path = "feedback_events.jsonl";

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;

    let line = serde_json::to_string(&event).map_err(|e| e.to_string())? + "\n";
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn apply_eq_profile(
    state: tauri::State<'_, Arc<EqController>>,
    payload: EqProfilePayload,
) -> Result<(), String> {
    let profile = GraphicEQProfile::try_from(payload).map_err(|e| e.to_string())?;
    state.set_profile(profile).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_neutral_eq(state: tauri::State<'_, Arc<EqController>>) -> Result<(), String> {
    state.set_neutral().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_eq_engine_status(
    state: tauri::State<'_, Arc<EqController>>,
) -> Result<services::eq_controller::EngineStatus, String> {
    Ok(state.status())
}

#[tauri::command]
async fn get_current_eq_profile(state: tauri::State<'_, Arc<EqController>>) -> Result<Option<GraphicEQProfile>, String> {
    Ok(state.get_current_profile().await)
}

/// Where Equalizer APO is registered, and which endpoints lack it.
///
/// A correct `config.txt` still does nothing when APO is bound to an endpoint
/// other than the one Windows is playing through, so the UI needs this to say
/// which one it is.
#[tauri::command]
fn get_apo_binding() -> services::apobinding::ApoBindingStatus {
    services::apobinding::probe()
}

/// The last audio test's outcome, held so a later diagnostic can show it
/// without the test being re-run. `None` until a test has actually happened.
#[derive(Default)]
struct LastMeasurement(std::sync::Mutex<Option<services::audio_path::MeasurementResult>>);

/// Measure every stage of the audio path from a source to the speakers.
///
/// Stages are reported green only when measured, never inferred from a config
/// file existing; `processing_verified` is the only field that may be described
/// as verified processing.
#[tauri::command]
async fn get_audio_path_report(
    controller: tauri::State<'_, Arc<EqController>>,
    last: tauri::State<'_, LastMeasurement>,
) -> Result<services::audio_path::AudioPathReport, String> {
    let status = controller.status();
    let measurement = last.0.lock().ok().and_then(|m| m.clone());
    Ok(services::audio_path::diagnose(
        measurement.as_ref(),
        status.available,
        status.config_present,
    )
    .await)
}

/// Apply a temporary safe gain offset, measure whether it changed the output,
/// then restore the user's curve.
///
/// This is the only check that can turn the "audible EQ change" stage green.
#[tauri::command]
async fn run_audio_test(
    controller: tauri::State<'_, Arc<EqController>>,
    last: tauri::State<'_, LastMeasurement>,
    test_preamp_db: Option<f32>,
) -> Result<services::audio_path::MeasurementResult, String> {
    // 6 dB is clearly measurable and modest enough to be safe on most content.
    let db = test_preamp_db.unwrap_or(6.0);
    let result = services::audio_path::run_measurement(&controller, db).await?;
    if let Ok(mut slot) = last.0.lock() {
        *slot = Some(result.clone());
    }
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize EQ controller
    let eq_engine = create_eq_engine();
    let eq_controller = Arc::new(EqController::new(eq_engine));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(eq_controller)
        .manage(LastMeasurement::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            services::media_session::get_current_track,
            services::audio_device::get_default_output_device,
            services::audio_device::list_output_devices,
            apply_eq_profile,
            set_neutral_eq,
            get_eq_engine_status,
            get_current_eq_profile,
            get_apo_binding,
            get_audio_path_report,
            run_audio_test,
            append_feedback_event,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let eq_controller = app.state::<Arc<EqController>>().inner().clone();

            // Initialize EQ engine (apply neutral on startup)
            tauri::async_runtime::spawn(async move {
                if let Err(e) = eq_controller.set_neutral().await {
                    eprintln!("Failed to set initial neutral EQ: {}", e);
                }
            });

            // Start media session watcher
            let media_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = services::media_session::watch_media_sessions(media_handle).await {
                    eprintln!("Media session watcher error: {}", e);
                }
            });

            // Start output-device watcher
            tauri::async_runtime::spawn(services::audio_device::watch_output_devices(app_handle));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}