use crate::session_persistence::PersistedSessions;

#[tauri::command]
pub fn get_persisted_sessions() -> PersistedSessions {
    PersistedSessions::load()
}

#[tauri::command]
pub fn save_persisted_sessions(sessions: PersistedSessions, max_sessions: usize) -> Result<(), String> {
    let mut sessions = sessions;
    sessions.trim_to_max(max_sessions);
    sessions.saved_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    sessions.save()
}

#[tauri::command]
pub fn clear_persisted_sessions() -> Result<(), String> {
    let sessions = PersistedSessions::default();
    sessions.save()
}
