use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Foundation::TypedEventHandler;
use std::time::Duration;
use tokio::time::interval;
use tauri::{command, Emitter};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TrackInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub status: String,
}

/// Get current track info from GSMTC
#[command]
pub async fn get_current_track() -> Result<Option<TrackInfo>, String> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?
        .await
        .map_err(|e| e.to_string())?;

    let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
    get_track_info(&session).await.map(Some).map_err(|e| e.to_string())
}

/// Watch media sessions and emit track-changed events
pub async fn watch_media_sessions(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await?;

    let mut interval = interval(Duration::from_millis(500));
    let mut last_track: Option<TrackInfo> = None;

    loop {
        interval.tick().await;

        if let Ok(Some(session)) = get_current_session(&manager) {
            if let Ok(track) = get_track_info(&session).await {
                let has_changed = last_track.as_ref().map_or(true, |last| {
                    last.title != track.title || last.artist != track.artist
                });

                if has_changed {
                    println!("Track changed: {} - {}", track.title, track.artist);
                    let _ = app.emit("track-changed", &track);
                    last_track = Some(track);
                }
            }
        }
    }
}

fn get_current_session(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Result<Option<GlobalSystemMediaTransportControlsSession>, windows::core::Error> {
    match manager.GetCurrentSession() {
        Ok(session) => Ok(Some(session)),
        Err(_) => Ok(None),
    }
}

async fn get_track_info(
    session: &GlobalSystemMediaTransportControlsSession,
) -> Result<TrackInfo, Box<dyn std::error::Error + Send + Sync>> {
    let props = session.TryGetMediaPropertiesAsync()?.await?;

    let title = props.Title()?.to_string();
    let artist = props.Artist()?.to_string();
    let album = props.AlbumTitle()?.to_string();

    let playback_info = session.GetPlaybackInfo()?;
    let status = match playback_info.PlaybackStatus()? {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => "playing",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => "paused",
        _ => "stopped",
    };

    Ok(TrackInfo {
        title,
        artist,
        album,
        status: status.to_string(),
    })
}