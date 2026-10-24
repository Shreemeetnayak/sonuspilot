use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use std::time::Duration;
use tokio::time::interval;
use tauri::{command, Emitter};
use tracing::info;

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
        .get()
        .map_err(|e| e.to_string())?;

    let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
    get_track_info(&session).await.map(Some).map_err(|e| e.to_string())
}

/// Watch media sessions and emit track-changed events
pub async fn watch_media_sessions(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Acquire once at startup; the manager stays valid for the app's lifetime.
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;

    let mut ticker = interval(Duration::from_millis(500));
    let mut last_track: Option<TrackInfo> = None;

    loop {
        ticker.tick().await;

        if let Ok(Some(session)) = get_current_session(&manager) {
            if let Ok(track) = get_track_info(&session).await {
                if has_changed(last_track.as_ref(), &track) {
                    info!("Track changed: {} - {} ({})", track.title, track.artist, track.status);
                    let _ = app.emit("track-changed", &track);
                    last_track = Some(track);
                }
            }
        }
    }
}

/// A track counts as changed when title, artist or playback state differ, so a
/// pause or a source switch is noticed even though the metadata is identical.
fn has_changed(last: Option<&TrackInfo>, current: &TrackInfo) -> bool {
    match last {
        None => true,
        Some(previous) => {
            previous.title != current.title
                || previous.artist != current.artist
                || previous.album != current.album
                || previous.status != current.status
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
    let props = session.TryGetMediaPropertiesAsync()?.get()?;

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
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_live_gsmtc_session() {
        let Ok(manager) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .and_then(|op| op.get())
        else {
            eprintln!("GSMTC unavailable on this machine; skipping");
            return;
        };
        let Ok(session) = manager.GetCurrentSession() else {
            eprintln!("no current media session right now; skipping");
            return;
        };
        let future = get_track_info(&session);
        let track = futures_util_poll(future).expect("track info");
        eprintln!("GSMTC TRACK: {} — {} [{}]", track.title, track.artist, track.status);
        assert!(["playing", "paused", "stopped"].contains(&track.status.as_str()));
    }

    /// Block on the WinRT IAsyncOperation future inside a test.
    fn futures_util_poll<F: std::future::Future>(mut future: F) -> F::Output {
        use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};
        fn noop(_: *const ()) {}
        fn clone(ptr: *const ()) -> RawWaker { RawWaker::new(ptr, &VTABLE) }
        static VTABLE: RawWakerVTable = RawWakerVTable::new(clone, noop, noop, noop);
        let waker = unsafe { Waker::from_raw(RawWaker::new(std::ptr::null(), &VTABLE)) };
        let mut cx = Context::from_waker(&waker);
        let mut future = unsafe { std::pin::Pin::new_unchecked(&mut future) };
        loop {
            match future.as_mut().poll(&mut cx) {
                Poll::Ready(value) => return value,
                Poll::Pending => std::thread::sleep(std::time::Duration::from_millis(10)),
            }
        }
    }

    #[test]
    fn change_detection_compares_title_artist_and_status() {
        let a = TrackInfo { title: "A".into(), artist: "X".into(), album: String::new(), status: "playing".into() };
        let b = TrackInfo { title: "B".into(), artist: "X".into(), album: String::new(), status: "playing".into() };
        let c = TrackInfo { title: "A".into(), artist: "X".into(), album: String::new(), status: "paused".into() };
        assert!(has_changed(Some(&a), &b), "new title must register");
        assert!(has_changed(Some(&a), &c), "pause must register");
        assert!(!has_changed(Some(&a), &a), "same track must not re-emit");
    }
}
