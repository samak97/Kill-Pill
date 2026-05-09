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
      use tauri_plugin_autostart::MacosLauncher;
      use tauri_plugin_autostart::ManagerExt;

      let _ = app.handle().plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])));
      
      let handle = app.handle().clone();
      commands::notifications::start_notification_listener(handle);
      
      if cfg!(debug_assertions) {
        let _ = app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        );
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
