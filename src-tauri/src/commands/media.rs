use serde::Serialize;
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus;
use std::sync::Mutex;

static CACHED_THUMB: Mutex<Option<(String, String)>> = Mutex::new(None); // (title, base64)

#[derive(Serialize, Clone)]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    pub thumbnail: Option<String>,
    pub position_ms: u64,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn get_media_info() -> Result<Option<MediaInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = match manager.GetCurrentSession() {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };

        let properties = session.TryGetMediaPropertiesAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let playback_info = session.GetPlaybackInfo()
            .map_err(|e| e.to_string())?;

        let timeline = session.GetTimelineProperties()
            .map_err(|e| e.to_string())?;

        // Determine playing state using the actual enum variant
        let is_playing = match playback_info.PlaybackStatus() {
            Ok(status) => status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing,
            Err(_) => false,
        };

        let title = properties.Title().unwrap_or_default().to_string();
        let artist = properties.Artist().unwrap_or_default().to_string();
        let album = properties.AlbumTitle().unwrap_or_default().to_string();

        // Only re-fetch thumbnail if song title changed (expensive operation)
        let mut thumbnail_base64 = None;
        {
            let cache = CACHED_THUMB.lock().unwrap();
            if let Some((cached_title, cached_b64)) = cache.as_ref() {
                if *cached_title == title {
                    thumbnail_base64 = Some(cached_b64.clone());
                }
            }
        }

        if thumbnail_base64.is_none() {
            if let Ok(thumb_ref) = properties.Thumbnail() {
                if let Ok(stream) = thumb_ref.OpenReadAsync()
                    .map_err(|e| e.to_string())?
                    .get()
                {
                    let size = stream.Size().unwrap_or(0);
                    if size > 0 && size < 10_000_000 {
                        let reader = windows::Storage::Streams::DataReader::CreateDataReader(&stream)
                            .map_err(|e| e.to_string())?;
                        let _ = reader.LoadAsync(size as u32)
                            .map_err(|e| e.to_string())?
                            .get();
                        let mut buffer = vec![0u8; size as usize];
                        reader.ReadBytes(&mut buffer).map_err(|e| e.to_string())?;
                        let b64 = base64::Engine::encode(
                            &base64::prelude::BASE64_STANDARD,
                            &buffer,
                        );
                        thumbnail_base64 = Some(b64.clone());
                        let mut cache = CACHED_THUMB.lock().unwrap();
                        *cache = Some((title.clone(), b64));
                    }
                }
            }
        }

        let pos_ticks = timeline.Position().unwrap_or_default().Duration;
        let dur_ticks = timeline.EndTime().unwrap_or_default().Duration;

        Ok(Some(MediaInfo {
            title,
            artist,
            album,
            is_playing,
            thumbnail: thumbnail_base64,
            position_ms: (pos_ticks as u64) / 10_000,
            duration_ms: (dur_ticks as u64) / 10_000,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_play_pause() -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;
        if let Ok(session) = manager.GetCurrentSession() {
            let _ = session.TryTogglePlayPauseAsync()
                .map_err(|e| e.to_string())?
                .get();
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_next() -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;
        if let Ok(session) = manager.GetCurrentSession() {
            let _ = session.TrySkipNextAsync()
                .map_err(|e| e.to_string())?
                .get();
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_previous() -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;
        if let Ok(session) = manager.GetCurrentSession() {
            let _ = session.TrySkipPreviousAsync()
                .map_err(|e| e.to_string())?
                .get();
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
