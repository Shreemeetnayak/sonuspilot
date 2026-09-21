mod services;
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use services::eq_controller::{create_eq_engine, EqController, GraphicEQProfile, EqProfilePayload};
use std::sync::Arc;
use tauri::Manager;

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
async fn get_eq_engine_status(state: tauri::State<'_, Arc<EqController>>) -> Result<bool, String> {
    Ok(state.is_available())
}

#[tauri::command]
async fn get_current_eq_profile(state: tauri::State<'_, Arc<EqController>>) -> Result<Option<GraphicEQProfile>, String> {
    Ok(state.get_current_profile().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize EQ controller
    let eq_engine = create_eq_engine();
    let eq_controller = Arc::new(EqController::new(eq_engine));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(eq_controller)
        .invoke_handler(tauri::generate_handler![
            greet,
            services::media_session::get_current_track,
            services::audio_device::get_default_output_device,
            apply_eq_profile,
            set_neutral_eq,
            get_eq_engine_status,
            get_current_eq_profile,
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
            tauri::async_runtime::spawn(async move {
                if let Err(e) = services::media_session::watch_media_sessions(app_handle).await {
                    eprintln!("Media session watcher error: {}", e);
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}