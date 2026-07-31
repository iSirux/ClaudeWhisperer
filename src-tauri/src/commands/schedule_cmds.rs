//! Native scheduling persistence.
//!
//! Schedules are stored as opaque JSON — the frontend (`stores/schedules.ts`)
//! owns the schema, so there is no AppConfig entry and no migration ladder here.
//! Mirrors the pile pattern (`pile_cmds`): dev/prod file split, full-replacement
//! saves, atomic writes.

use std::fs;
use std::path::PathBuf;

use crate::config::AppConfig;
use crate::persist::atomic_write;

/// Path to the schedules file (separate for debug/release builds)
fn schedules_file_path() -> PathBuf {
    #[cfg(debug_assertions)]
    let filename = "schedules.dev.json";
    #[cfg(not(debug_assertions))]
    let filename = "schedules.json";
    AppConfig::config_dir().join(filename)
}

/// Load all schedules. Items are stored as opaque JSON — the frontend owns the schema.
#[tauri::command]
pub fn get_schedules() -> Vec<serde_json::Value> {
    let path = schedules_file_path();
    let Ok(content) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&content).unwrap_or_else(|e| {
        // Must reach the log file: an empty return here is indistinguishable from
        // "no schedules configured", and the next save replaces the file wholesale.
        log::error!("Failed to parse schedules at {:?}: {}", path, e);
        Vec::new()
    })
}

/// Save all schedules (full replacement, atomic write).
#[tauri::command]
pub fn save_schedules(items: Vec<serde_json::Value>) -> Result<(), String> {
    let path = schedules_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(&items)
        .map_err(|e| format!("Failed to serialize schedules: {}", e))?;
    atomic_write(&path, &content).map_err(|e| format!("Failed to write schedules: {}", e))
}
