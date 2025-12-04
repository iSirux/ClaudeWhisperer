use crate::config::{AppConfig, LlmProvider};
use crate::llm::{
    ConnectionTestResult, InteractionAnalysis, LlmClient, ModelRecommendation,
    RepoDescriptionResult, RepoRecommendation, SessionNameResult, SessionOutcomeResult,
    TranscriptionCleanupResult,
};
use parking_lot::Mutex;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_keyring::KeyringExt;

/// Service name for keyring storage
const KEYRING_SERVICE: &str = "claude-whisperer";
/// User/account name for the LLM API key
const KEYRING_LLM_KEY: &str = "llm-api-key";

// --- Legacy obfuscation for migration purposes only ---

fn legacy_deobfuscate(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter()
        .enumerate()
        .map(|(i, b)| b ^ key[i % key.len()])
        .collect()
}

const LEGACY_OBFUSCATION_KEY: &[u8] = b"claude-whisperer-gemini-key-protection";

fn get_legacy_secrets_path() -> PathBuf {
    AppConfig::config_dir().join("gemini_key.dat")
}

/// Migrate legacy XOR-obfuscated key to secure keyring storage
/// Returns Ok(true) if migration happened, Ok(false) if no migration needed
fn migrate_legacy_key(app: &AppHandle) -> Result<bool, String> {
    let legacy_path = get_legacy_secrets_path();

    if !legacy_path.exists() {
        return Ok(false);
    }

    // Read and decode the legacy key
    let encrypted = fs::read(&legacy_path)
        .map_err(|e| format!("Failed to read legacy API key file: {}", e))?;

    let decrypted = legacy_deobfuscate(&encrypted, LEGACY_OBFUSCATION_KEY);

    let api_key = String::from_utf8(decrypted)
        .map_err(|e| format!("Failed to decode legacy API key: {}", e))?;

    // Store in keyring
    app.keyring()
        .set_password(KEYRING_SERVICE, KEYRING_LLM_KEY, &api_key)
        .map_err(|e| format!("Failed to migrate API key to keyring: {}", e))?;

    // Delete the legacy file
    if let Err(e) = fs::remove_file(&legacy_path) {
        eprintln!("[keyring] Warning: Failed to delete legacy key file: {}", e);
        // Don't fail migration just because we couldn't delete the old file
    } else {
        eprintln!("[keyring] Successfully migrated API key from legacy storage to system keyring");
    }

    Ok(true)
}

/// Helper to get the API key from keyring
fn get_api_key_internal(app: &AppHandle) -> Result<String, String> {
    // First, try to migrate legacy key if it exists
    let _ = migrate_legacy_key(app);

    // Get from keyring
    match app.keyring().get_password(KEYRING_SERVICE, KEYRING_LLM_KEY) {
        Ok(Some(key)) => Ok(key),
        Ok(None) => Err("API key not set".to_string()),
        Err(e) => Err(format!("Failed to get API key from keyring: {}", e)),
    }
}

/// Helper to create an LlmClient with proper configuration
fn create_client(app: &AppHandle, config: &AppConfig) -> Result<LlmClient, String> {
    let llm_config = &config.llm;

    // For local provider, API key is optional
    let api_key = if matches!(llm_config.provider, LlmProvider::Local) {
        get_api_key_internal(app).unwrap_or_default()
    } else {
        get_api_key_internal(app)?
    };

    Ok(LlmClient::new(
        api_key,
        llm_config.model.clone(),
        llm_config.provider.clone(),
        llm_config.endpoint.clone(),
        llm_config.auto_model,
        llm_config.model_priority.clone(),
    ))
}

/// Save the API key to the system keyring
#[tauri::command]
pub async fn save_gemini_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    app.keyring()
        .set_password(KEYRING_SERVICE, KEYRING_LLM_KEY, &api_key)
        .map_err(|e| format!("Failed to save API key to keyring: {}", e))?;

    // Clean up any legacy file if it exists
    let legacy_path = get_legacy_secrets_path();
    if legacy_path.exists() {
        let _ = fs::remove_file(&legacy_path);
    }

    Ok(())
}

/// Check if API key is configured
#[tauri::command]
pub async fn has_llm_api_key(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
) -> Result<bool, String> {
    let llm_config = config.lock().llm.clone();

    // Local provider doesn't require an API key
    if matches!(llm_config.provider, LlmProvider::Local) {
        return Ok(true);
    }

    // Check if key exists in keyring (this will also trigger migration if needed)
    Ok(get_api_key_internal(&app).is_ok())
}

// Alias for backwards compatibility
#[tauri::command]
pub async fn has_gemini_api_key(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
) -> Result<bool, String> {
    has_llm_api_key(app, config).await
}

/// Delete the API key from the system keyring
#[tauri::command]
pub async fn delete_gemini_api_key(app: AppHandle) -> Result<(), String> {
    // Delete from keyring
    match app.keyring().delete_password(KEYRING_SERVICE, KEYRING_LLM_KEY) {
        Ok(_) => {}
        Err(e) => {
            // Only error if it's not a "not found" type error
            let err_str = format!("{}", e);
            if !err_str.contains("not found") && !err_str.contains("No such") {
                return Err(format!("Failed to delete API key from keyring: {}", e));
            }
        }
    }

    // Also clean up any legacy file
    let legacy_path = get_legacy_secrets_path();
    if legacy_path.exists() {
        let _ = fs::remove_file(&legacy_path);
    }

    Ok(())
}

/// Test connection to the LLM API
#[tauri::command]
pub async fn test_gemini_connection(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
) -> Result<ConnectionTestResult, String> {
    let cfg = config.lock().clone();
    let client = create_client(&app, &cfg)?;
    client.test_connection().await
}

/// Generate a session name from the user prompt (called immediately when prompt is sent)
#[tauri::command]
pub async fn generate_session_name(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
    user_prompt: String,
) -> Result<SessionNameResult, String> {
    let cfg = config.lock().clone();

    if !cfg.llm.enabled {
        return Err("LLM integration is not enabled".to_string());
    }

    let client = create_client(&app, &cfg)?;
    client.generate_session_name(&user_prompt).await
}

/// Generate a session outcome after the session completes
#[tauri::command]
pub async fn generate_session_outcome(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
    user_prompt: String,
    assistant_messages: String,
) -> Result<SessionOutcomeResult, String> {
    let cfg = config.lock().clone();

    if !cfg.llm.enabled {
        return Err("LLM integration is not enabled".to_string());
    }

    let client = create_client(&app, &cfg)?;
    client
        .generate_session_outcome(&user_prompt, &assistant_messages)
        .await
}

/// Analyze if the last message needs human interaction
#[tauri::command]
pub async fn analyze_interaction_needed(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
    last_message: String,
) -> Result<InteractionAnalysis, String> {
    let cfg = config.lock().clone();

    if !cfg.llm.enabled {
        return Err("LLM integration is not enabled".to_string());
    }

    let client = create_client(&app, &cfg)?;
    client.analyze_interaction_needed(&last_message).await
}

/// Clean up a voice transcription
#[tauri::command]
pub async fn clean_transcription(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
    raw_transcription: String,
    repo_context: Option<String>,
) -> Result<TranscriptionCleanupResult, String> {
    let cfg = config.lock().clone();

    if !cfg.llm.enabled {
        return Err("LLM integration is not enabled".to_string());
    }

    if !cfg.llm.features.clean_transcription {
        return Err("Transcription cleanup feature is not enabled".to_string());
    }

    let client = create_client(&app, &cfg)?;
    client
        .clean_transcription(&raw_transcription, repo_context.as_deref())
        .await
}

/// Recommend the best model for a prompt
#[tauri::command]
pub async fn recommend_model(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
    prompt: String,
) -> Result<ModelRecommendation, String> {
    let cfg = config.lock().clone();

    if !cfg.llm.enabled {
        return Err("LLM integration is not enabled".to_string());
    }

    if !cfg.llm.features.recommend_model {
        return Err("Model recommendation feature is not enabled".to_string());
    }

    let client = create_client(&app, &cfg)?;
    client.recommend_model(&prompt).await
}

/// Generate a description for a repository by reading its CLAUDE.md or README
#[tauri::command]
pub async fn generate_repo_description(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
    repo_path: String,
    repo_name: String,
) -> Result<RepoDescriptionResult, String> {
    let cfg = config.lock().clone();

    if !cfg.llm.enabled {
        return Err("LLM integration is not enabled".to_string());
    }

    let client = create_client(&app, &cfg)?;

    // Try to read CLAUDE.md first, then README.md
    let repo_path = PathBuf::from(&repo_path);

    let claude_md_content = fs::read_to_string(repo_path.join("CLAUDE.md")).ok();
    let readme_content = if claude_md_content.is_none() {
        fs::read_to_string(repo_path.join("README.md"))
            .or_else(|_| fs::read_to_string(repo_path.join("readme.md")))
            .ok()
    } else {
        None
    };

    client
        .generate_repo_description(&repo_name, claude_md_content.as_deref(), readme_content.as_deref())
        .await
}

/// Recommend the best repository for a given prompt
#[tauri::command]
pub async fn recommend_repo(
    app: AppHandle,
    config: State<'_, Mutex<AppConfig>>,
    prompt: String,
    is_transcribed: Option<bool>,
) -> Result<RepoRecommendation, String> {
    let cfg = config.lock().clone();

    if !cfg.llm.enabled {
        return Err("LLM integration is not enabled".to_string());
    }

    if !cfg.llm.features.auto_select_repo {
        return Err("Auto-select repository feature is not enabled".to_string());
    }

    let client = create_client(&app, &cfg)?;

    // Build repos list with descriptions and keywords
    let repos: Vec<(String, String, Option<String>, Option<Vec<String>>)> = cfg
        .repos
        .iter()
        .map(|r| (r.name.clone(), r.path.clone(), r.description.clone(), r.keywords.clone()))
        .collect();

    client.recommend_repo(&prompt, &repos, is_transcribed.unwrap_or(false)).await
}
