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
            model: "Systran/faster-whisper-base".to_string(),
            language: "en".to_string(),
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
    pub switch_repo: String,
    #[serde(default = "default_transcribe_to_input")]
    pub transcribe_to_input: String,
}

fn default_transcribe_to_input() -> String {
    "CommandOrControl+Shift+T".to_string()
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            toggle_recording: "CommandOrControl+Shift+Space".to_string(),
            switch_repo: "CommandOrControl+Shift+R".to_string(),
            transcribe_to_input: "CommandOrControl+Shift+T".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayConfig {
    pub show_transcript: bool,
    pub transcript_lines: usize,
    pub show_settings: bool,
    pub show_terminals: bool,
    pub sessions_overlay_enabled: bool,
    #[serde(default = "default_show_when_focused")]
    pub show_when_focused: bool,
    #[serde(default = "default_show_hotkey_hints")]
    pub show_hotkey_hints: bool,
    #[serde(default)]
    pub position_x: Option<i32>,
    #[serde(default)]
    pub position_y: Option<i32>,
}

fn default_show_when_focused() -> bool {
    true
}

fn default_show_hotkey_hints() -> bool {
    true
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            show_transcript: true,
            transcript_lines: 3,
            show_settings: true,
            show_terminals: true,
            sessions_overlay_enabled: true,
            show_when_focused: true,
            show_hotkey_hints: true,
            position_x: None,
            position_y: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemConfig {
    pub minimize_to_tray: bool,
    pub start_minimized: bool,
    pub autostart: bool,
}

impl Default for SystemConfig {
    fn default() -> Self {
        Self {
            minimize_to_tray: true,
            start_minimized: false,
            autostart: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPersistenceConfig {
    pub enabled: bool,
    pub max_sessions: usize,
    #[serde(default = "default_restore_sessions")]
    pub restore_sessions: usize,
}

fn default_restore_sessions() -> usize {
    10
}

impl Default for SessionPersistenceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_sessions: 50,
            restore_sessions: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionStats {
    pub total_sessions: u64,
    pub total_pty_sessions: u64,
    pub total_sdk_sessions: u64,
    pub total_prompts: u64,
    pub total_tool_calls: u64,
    pub total_recordings: u64,
    pub total_recording_duration_ms: u64,
    pub total_transcriptions: u64,
    pub first_session_at: Option<u64>,
    pub last_session_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenStats {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelUsageStats {
    pub opus_sessions: u64,
    pub sonnet_sessions: u64,
    pub haiku_sessions: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RepoUsageStats {
    pub repo_path: String,
    pub session_count: u64,
    pub prompt_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DailyStats {
    pub date: String, // YYYY-MM-DD format
    pub sessions: u64,
    pub prompts: u64,
    pub recordings: u64,
    pub tool_calls: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageStats {
    pub session_stats: SessionStats,
    #[serde(default)]
    pub token_stats: TokenStats,
    pub model_usage: ModelUsageStats,
    pub repo_usage: Vec<RepoUsageStats>,
    pub daily_stats: Vec<DailyStats>,
    pub streak_days: u32,
    pub longest_streak: u32,
    pub average_session_duration_ms: u64,
    pub average_prompts_per_session: f64,
    pub most_used_tools: Vec<(String, u64)>,
}

impl Default for UsageStats {
    fn default() -> Self {
        Self {
            session_stats: SessionStats::default(),
            token_stats: TokenStats::default(),
            model_usage: ModelUsageStats::default(),
            repo_usage: Vec::new(),
            daily_stats: Vec::new(),
            streak_days: 0,
            longest_streak: 0,
            average_session_duration_ms: 0,
            average_prompts_per_session: 0.0,
            most_used_tools: Vec::new(),
        }
    }
}

impl UsageStats {
    pub fn stats_path() -> PathBuf {
        AppConfig::config_dir().join("usage_stats.json")
    }

    pub fn load() -> Self {
        let path = Self::stats_path();
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(stats) => return stats,
                    Err(e) => eprintln!("Failed to parse usage stats: {}", e),
                },
                Err(e) => eprintln!("Failed to read usage stats: {}", e),
            }
        }
        Self::default()
    }

    pub fn save(&self) -> Result<(), String> {
        let dir = AppConfig::config_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;

        let path = Self::stats_path();
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize usage stats: {}", e))?;

        fs::write(&path, &content).map_err(|e| format!("Failed to write usage stats: {}", e))?;
        Ok(())
    }

    fn get_today() -> String {
        chrono::Local::now().format("%Y-%m-%d").to_string()
    }

    fn ensure_today_stats(&mut self) {
        let today = Self::get_today();
        if self.daily_stats.last().map(|d| &d.date) != Some(&today) {
            self.daily_stats.push(DailyStats {
                date: today,
                sessions: 0,
                prompts: 0,
                recordings: 0,
                tool_calls: 0,
            });
            // Keep only last 90 days
            if self.daily_stats.len() > 90 {
                self.daily_stats.remove(0);
            }
        }
    }

    pub fn track_session(&mut self, session_type: &str, model: &str, repo_path: Option<&str>) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        self.session_stats.total_sessions += 1;

        if session_type == "pty" {
            self.session_stats.total_pty_sessions += 1;
        } else if session_type == "sdk" {
            self.session_stats.total_sdk_sessions += 1;
        }

        if self.session_stats.first_session_at.is_none() {
            self.session_stats.first_session_at = Some(now);
        }
        self.session_stats.last_session_at = Some(now);

        // Track model usage
        let model_lower = model.to_lowercase();
        if model_lower.contains("opus") {
            self.model_usage.opus_sessions += 1;
        } else if model_lower.contains("sonnet") {
            self.model_usage.sonnet_sessions += 1;
        } else if model_lower.contains("haiku") {
            self.model_usage.haiku_sessions += 1;
        }

        // Track repo usage
        if let Some(path) = repo_path {
            if let Some(repo_stats) = self.repo_usage.iter_mut().find(|r| r.repo_path == path) {
                repo_stats.session_count += 1;
            } else {
                self.repo_usage.push(RepoUsageStats {
                    repo_path: path.to_string(),
                    session_count: 1,
                    prompt_count: 0,
                });
            }
        }

        // Update daily stats
        self.ensure_today_stats();
        if let Some(today) = self.daily_stats.last_mut() {
            today.sessions += 1;
        }

        // Update streak
        self.update_streak();
    }

    pub fn track_prompt(&mut self, repo_path: Option<&str>) {
        self.session_stats.total_prompts += 1;

        if let Some(path) = repo_path {
            if let Some(repo_stats) = self.repo_usage.iter_mut().find(|r| r.repo_path == path) {
                repo_stats.prompt_count += 1;
            }
        }

        self.ensure_today_stats();
        if let Some(today) = self.daily_stats.last_mut() {
            today.prompts += 1;
        }
    }

    pub fn track_tool_call(&mut self, tool_name: &str) {
        self.session_stats.total_tool_calls += 1;

        // Update most used tools
        if let Some(tool) = self.most_used_tools.iter_mut().find(|(name, _)| name == tool_name) {
            tool.1 += 1;
        } else {
            self.most_used_tools.push((tool_name.to_string(), 1));
        }

        // Sort by count and keep top 20
        self.most_used_tools.sort_by(|a, b| b.1.cmp(&a.1));
        self.most_used_tools.truncate(20);

        self.ensure_today_stats();
        if let Some(today) = self.daily_stats.last_mut() {
            today.tool_calls += 1;
        }
    }

    pub fn track_recording(&mut self, duration_ms: u64) {
        self.session_stats.total_recordings += 1;
        self.session_stats.total_recording_duration_ms += duration_ms;

        self.ensure_today_stats();
        if let Some(today) = self.daily_stats.last_mut() {
            today.recordings += 1;
        }
    }

    pub fn track_transcription(&mut self) {
        self.session_stats.total_transcriptions += 1;
    }

    pub fn track_token_usage(
        &mut self,
        input_tokens: u64,
        output_tokens: u64,
        cache_read_tokens: u64,
        cache_creation_tokens: u64,
        cost_usd: f64,
    ) {
        self.token_stats.total_input_tokens += input_tokens;
        self.token_stats.total_output_tokens += output_tokens;
        self.token_stats.total_cache_read_tokens += cache_read_tokens;
        self.token_stats.total_cache_creation_tokens += cache_creation_tokens;
        self.token_stats.total_cost_usd += cost_usd;
    }

    fn update_streak(&mut self) {
        let today = Self::get_today();
        let yesterday = (chrono::Local::now() - chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();

        // Check if we already have an entry for today
        let has_today = self.daily_stats.iter().any(|d| d.date == today && d.sessions > 0);
        let had_yesterday = self.daily_stats.iter().any(|d| d.date == yesterday && d.sessions > 0);

        if has_today {
            if had_yesterday {
                // Continue streak - but don't double-count if we already incremented today
                // The streak is counted by looking back at consecutive days
            }

            // Calculate actual streak from daily_stats
            let mut streak = 0u32;
            let mut check_date = chrono::Local::now().date_naive();

            for day_stats in self.daily_stats.iter().rev() {
                let expected_date = check_date.format("%Y-%m-%d").to_string();
                if day_stats.date == expected_date && day_stats.sessions > 0 {
                    streak += 1;
                    check_date -= chrono::Duration::days(1);
                } else if day_stats.date != expected_date {
                    // Skip if dates don't match (gap in data)
                    break;
                }
            }

            self.streak_days = streak;
            if streak > self.longest_streak {
                self.longest_streak = streak;
            }
        }
    }

    pub fn update_averages(&mut self, total_session_duration_ms: u64, total_prompts: u64, session_count: u64) {
        if session_count > 0 {
            self.average_session_duration_ms = total_session_duration_ms / session_count;
            self.average_prompts_per_session = total_prompts as f64 / session_count as f64;
        }
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    pub device_id: Option<String>,
    pub use_hotkey: bool,
    #[serde(default)]
    pub play_sound_on_completion: bool,
    #[serde(default = "default_recording_linger_ms")]
    pub recording_linger_ms: u32,
    #[serde(default = "default_include_transcription_notice")]
    pub include_transcription_notice: bool,
}

fn default_recording_linger_ms() -> u32 {
    500
}

fn default_include_transcription_notice() -> bool {
    true
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            device_id: None,
            use_hotkey: true,
            play_sound_on_completion: false,
            recording_linger_ms: 500,
            include_transcription_notice: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoConfig {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum TerminalMode {
    Interactive,
    Prompt,
    #[default]
    Sdk,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum Theme {
    #[default]
    Midnight,
    Slate,
    Snow,
    Sand,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum SessionSortOrder {
    #[default]
    Chronological,
    StatusThenChronological,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub whisper: WhisperConfig,
    pub git: GitConfig,
    pub hotkeys: HotkeyConfig,
    pub overlay: OverlayConfig,
    pub audio: AudioConfig,
    pub repos: Vec<RepoConfig>,
    pub active_repo_index: usize,
    pub default_model: String,
    #[serde(default)]
    pub terminal_mode: TerminalMode,
    #[serde(default)]
    pub skip_permissions: bool,
    #[serde(default)]
    pub theme: Theme,
    #[serde(default)]
    pub system: SystemConfig,
    #[serde(default)]
    pub show_branch_in_sessions: bool,
    #[serde(default)]
    pub session_persistence: SessionPersistenceConfig,
    #[serde(default)]
    pub session_sort_order: SessionSortOrder,
    #[serde(default = "default_mark_sessions_unread")]
    pub mark_sessions_unread: bool,
    #[serde(default = "default_show_latest_message_preview")]
    pub show_latest_message_preview: bool,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default = "default_session_prompt_rows")]
    pub session_prompt_rows: usize,
    #[serde(default = "default_session_response_rows")]
    pub session_response_rows: usize,
}

fn default_mark_sessions_unread() -> bool {
    true
}

fn default_show_latest_message_preview() -> bool {
    true
}

fn default_sidebar_width() -> u32 {
    256
}

fn default_session_prompt_rows() -> usize {
    2
}

fn default_session_response_rows() -> usize {
    2
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            whisper: WhisperConfig::default(),
            git: GitConfig::default(),
            hotkeys: HotkeyConfig::default(),
            overlay: OverlayConfig::default(),
            audio: AudioConfig::default(),
            repos: vec![],
            active_repo_index: 0,
            default_model: "claude-sonnet-4-20250514".to_string(),
            terminal_mode: TerminalMode::default(),
            skip_permissions: false,
            theme: Theme::default(),
            system: SystemConfig::default(),
            show_branch_in_sessions: false,
            session_persistence: SessionPersistenceConfig::default(),
            session_sort_order: SessionSortOrder::default(),
            mark_sessions_unread: true,
            show_latest_message_preview: true,
            sidebar_width: 256,
            session_prompt_rows: 2,
            session_response_rows: 2,
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
        println!("[config.save] Saving to dir: {:?}", dir);
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {}", e))?;

        let path = Self::config_path();
        println!("[config.save] Config path: {:?}", path);
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        println!("[config.save] Writing {} bytes, repos count: {}", content.len(), self.repos.len());
        fs::write(&path, &content).map_err(|e| format!("Failed to write config: {}", e))?;
        println!("[config.save] Write successful");
        Ok(())
    }

    pub fn get_active_repo(&self) -> Option<&RepoConfig> {
        self.repos.get(self.active_repo_index)
    }
}
