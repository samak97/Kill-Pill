pub mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      commands::media::get_media_info,
      commands::media::media_play_pause,
      commands::media::media_next,
      commands::media::media_previous,
    ])
    .setup(|app| {
      let handle = app.handle().clone();
      commands::notifications::start_notification_listener(handle);
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
