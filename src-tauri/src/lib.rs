mod commands;
mod config;
mod git;
mod session_persistence;
mod sidecar;
mod terminal;
mod whisper;

use commands::{audio_cmds, input_cmds, sdk_cmds, session_cmds, settings_cmds, terminal_cmds, usage_cmds};
use config::{AppConfig, UsageStats};
use parking_lot::Mutex;
use sidecar::SidecarManager;
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use terminal::TerminalManager;

#[tauri::command]
fn get_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Failed to get autostart status: {}", e))
}

#[tauri::command]
fn toggle_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let autostart = app.autolaunch();
    if enabled {
        autostart
            .enable()
            .map_err(|e| format!("Failed to enable autostart: {}", e))
    } else {
        autostart
            .disable()
            .map_err(|e| format!("Failed to disable autostart: {}", e))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = AppConfig::load();
    let usage_stats = UsageStats::load();
    let start_minimized = config.system.start_minimized;
    let terminal_manager = Arc::new(TerminalManager::new());
    let sidecar_manager = Arc::new(SidecarManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Mutex::new(config))
        .manage(Mutex::new(usage_stats))
        .manage(terminal_manager)
        .manage(sidecar_manager)
        .setup(move |app| {
            // Build tray menu
            let show_item = MenuItemBuilder::new("Show")
                .id("show")
                .build(app)?;
            let quit_item = MenuItemBuilder::new("Quit")
                .id("quit")
                .build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // Load tray icon from embedded bytes
            let icon = Image::from_bytes(include_bytes!("../icons/icon.ico"))
                .or_else(|_| Image::from_bytes(include_bytes!("../icons/32x32.png")))
                .map_err(|e| format!("Failed to load tray icon: {}", e))?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Claude Whisperer")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            // Properly shutdown before quitting
                            let sidecar: tauri::State<Arc<SidecarManager>> = app.state();
                            sidecar.shutdown();
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                        if button == tauri::tray::MouseButton::Left {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Start minimized if configured (or launched with --minimized)
            let args: Vec<String> = std::env::args().collect();
            let should_minimize = start_minimized || args.contains(&"--minimized".to_string());

            if should_minimize {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let config: tauri::State<Mutex<AppConfig>> = app.state();
                let minimize_to_tray = config.lock().system.minimize_to_tray;

                if window.label() == "main" && minimize_to_tray {
                    // Prevent the window from closing, just hide it
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings_cmds::get_config,
            settings_cmds::save_config,
            settings_cmds::add_repo,
            settings_cmds::remove_repo,
            settings_cmds::set_active_repo,
            settings_cmds::get_active_repo,
            settings_cmds::get_git_branch,
            terminal_cmds::create_terminal_session,
            terminal_cmds::create_interactive_session,
            terminal_cmds::write_to_terminal,
            terminal_cmds::resize_terminal,
            terminal_cmds::close_terminal,
            terminal_cmds::get_terminal_sessions,
            terminal_cmds::get_terminal_session,
            audio_cmds::transcribe_audio,
            audio_cmds::test_whisper_connection,
            sdk_cmds::start_sidecar,
            sdk_cmds::create_sdk_session,
            sdk_cmds::send_sdk_prompt,
            sdk_cmds::stop_sdk_query,
            sdk_cmds::update_sdk_model,
            sdk_cmds::close_sdk_session,
            session_cmds::get_persisted_sessions,
            session_cmds::save_persisted_sessions,
            session_cmds::clear_persisted_sessions,
            usage_cmds::get_usage_stats,
            usage_cmds::track_session,
            usage_cmds::track_prompt,
            usage_cmds::track_tool_call,
            usage_cmds::track_recording,
            usage_cmds::track_transcription,
            usage_cmds::track_token_usage,
            usage_cmds::reset_usage_stats,
            get_autostart_enabled,
            toggle_autostart,
            input_cmds::paste_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
