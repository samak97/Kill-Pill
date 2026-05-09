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
      use tauri::menu::{Menu, MenuItem};
      use tauri::tray::TrayIconBuilder;

      // Initialize autostart plugin
      let _ = app.handle().plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])));
      
      // Setup System Tray
      let quit_i = MenuItem::with_id(app, "quit", "Exit KillPill", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&quit_i])?;

      let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| {
          if event.id.as_ref() == "quit" {
            app.exit(0);
          }
        })
        .build(app)?;

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
