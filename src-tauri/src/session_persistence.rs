use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::config::AppConfig;

/// Represents a persisted SDK message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedSdkMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub content: Option<String>,
    pub tool: Option<String>,
    pub input: Option<serde_json::Value>,
    pub output: Option<String>,
    pub timestamp: u64,
}

/// Represents a persisted SDK session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedSdkSession {
    pub id: String,
    pub cwd: String,
    pub model: String,
    pub messages: Vec<PersistedSdkMessage>,
    pub status: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "startedAt")]
    pub started_at: Option<u64>,
}

/// Represents a persisted terminal session (PTY)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedTerminalSession {
    pub id: String,
    pub repo_path: String,
    pub prompt: String,
    pub status: String,
    pub created_at: u64,
    /// Terminal output buffer - stored for historical viewing
    pub output_buffer: Option<String>,
}

/// Container for all persisted sessions
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PersistedSessions {
    pub sdk_sessions: Vec<PersistedSdkSession>,
    pub terminal_sessions: Vec<PersistedTerminalSession>,
    pub active_sdk_session_id: Option<String>,
    pub active_terminal_session_id: Option<String>,
    /// Timestamp when sessions were last saved
    pub saved_at: u64,
}

impl PersistedSessions {
    fn sessions_path() -> PathBuf {
        AppConfig::config_dir().join("sessions.json")
    }

    /// Load persisted sessions from disk
    pub fn load() -> Self {
        let path = Self::sessions_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(sessions) => return sessions,
                    Err(e) => eprintln!("Failed to parse sessions: {}", e),
                },
                Err(e) => eprintln!("Failed to read sessions: {}", e),
            }
        }
        Self::default()
    }

    /// Save sessions to disk
    pub fn save(&self) -> Result<(), String> {
        let dir = AppConfig::config_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;

        let path = Self::sessions_path();
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize sessions: {}", e))?;

        fs::write(&path, &content).map_err(|e| format!("Failed to write sessions: {}", e))?;
        Ok(())
    }

    /// Trim sessions to max count, keeping the most recent ones
    pub fn trim_to_max(&mut self, max_sessions: usize) {
        // Sort SDK sessions by created_at descending and keep only max_sessions
        self.sdk_sessions
            .sort_by(|a, b| b.created_at.cmp(&a.created_at));
        self.sdk_sessions.truncate(max_sessions);

        // Sort terminal sessions by created_at descending and keep only max_sessions
        self.terminal_sessions
            .sort_by(|a, b| b.created_at.cmp(&a.created_at));
        self.terminal_sessions.truncate(max_sessions);
    }

    /// Clear all persisted sessions
    pub fn clear(&mut self) {
        self.sdk_sessions.clear();
        self.terminal_sessions.clear();
        self.active_sdk_session_id = None;
        self.active_terminal_session_id = None;
    }
}
