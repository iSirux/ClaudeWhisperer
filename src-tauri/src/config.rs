use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperConfig {
    pub endpoint: String,
    pub model: String,
    pub language: String,
}

impl Default for WhisperConfig {
    fn default() -> Self {
        Self {
            endpoint: "http://localhost:8000/v1/audio/transcriptions".to_string(),
            model: "base".to_string(),
            language: "en".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HaikuConfig {
    pub enabled: bool,
    pub api_key: String,
    pub model: String,
}

impl Default for HaikuConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            api_key: String::new(),
            model: "claude-3-haiku-20240307".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitConfig {
    pub create_branch: bool,
    pub auto_merge: bool,
    pub create_pr: bool,
    pub use_worktrees: bool,
}

impl Default for GitConfig {
    fn default() -> Self {
        Self {
            create_branch: true,
            auto_merge: false,
            create_pr: false,
            use_worktrees: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyConfig {
    pub toggle_recording: String,
    pub toggle_open_mic: String,
    pub send_prompt: String,
    pub switch_repo: String,
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            toggle_recording: "CommandOrControl+Shift+Space".to_string(),
            toggle_open_mic: "CommandOrControl+Shift+M".to_string(),
            send_prompt: "CommandOrControl+Enter".to_string(),
            switch_repo: "CommandOrControl+Shift+R".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayConfig {
    pub show_transcript: bool,
    pub transcript_lines: usize,
    pub show_settings: bool,
    pub show_terminals: bool,
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            show_transcript: true,
            transcript_lines: 3,
            show_settings: true,
            show_terminals: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    pub device_id: Option<String>,
    pub open_mic: bool,
    pub voice_command: String,
    pub use_voice_command: bool,
    pub use_hotkey: bool,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            device_id: None,
            open_mic: false,
            voice_command: "go go".to_string(),
            use_voice_command: true,
            use_hotkey: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConfig {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub whisper: WhisperConfig,
    pub haiku: HaikuConfig,
    pub git: GitConfig,
    pub hotkeys: HotkeyConfig,
    pub overlay: OverlayConfig,
    pub audio: AudioConfig,
    pub repos: Vec<RepoConfig>,
    pub active_repo_index: usize,
    pub default_model: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            whisper: WhisperConfig::default(),
            haiku: HaikuConfig::default(),
            git: GitConfig::default(),
            hotkeys: HotkeyConfig::default(),
            overlay: OverlayConfig::default(),
            audio: AudioConfig::default(),
            repos: vec![],
            active_repo_index: 0,
            default_model: "claude-sonnet-4-20250514".to_string(),
        }
    }
}

impl AppConfig {
    pub fn config_dir() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("claude-whisperer")
    }

    pub fn config_path() -> PathBuf {
        Self::config_dir().join("config.json")
    }

    pub fn load() -> Self {
        let path = Self::config_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(config) => return config,
                    Err(e) => eprintln!("Failed to parse config: {}", e),
                },
                Err(e) => eprintln!("Failed to read config: {}", e),
            }
        }
        Self::default()
    }

    pub fn save(&self) -> Result<(), String> {
        let dir = Self::config_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;

        let path = Self::config_path();
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))
    }

    pub fn get_active_repo(&self) -> Option<&RepoConfig> {
        self.repos.get(self.active_repo_index)
    }
}
