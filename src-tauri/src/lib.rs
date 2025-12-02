mod commands;
mod config;
mod git;
mod haiku;
mod sidecar;
mod terminal;
mod whisper;

use commands::{audio_cmds, sdk_cmds, settings_cmds, terminal_cmds};
use config::AppConfig;
use parking_lot::Mutex;
use sidecar::SidecarManager;
use std::sync::Arc;
use terminal::TerminalManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let config = AppConfig::load();
    let terminal_manager = Arc::new(TerminalManager::new());
    let sidecar_manager = Arc::new(SidecarManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(config))
        .manage(terminal_manager)
        .manage(sidecar_manager)
        .invoke_handler(tauri::generate_handler![
            settings_cmds::get_config,
            settings_cmds::save_config,
            settings_cmds::add_repo,
            settings_cmds::remove_repo,
            settings_cmds::set_active_repo,
            settings_cmds::get_active_repo,
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
            sdk_cmds::close_sdk_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
