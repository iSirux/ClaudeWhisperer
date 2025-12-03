use crate::config::AppConfig;
use crate::whisper::WhisperClient;
use parking_lot::Mutex;
use tauri::State;

pub type ConfigState = Mutex<AppConfig>;

#[tauri::command]
pub async fn transcribe_audio(
    config: State<'_, ConfigState>,
    audio_data: Vec<u8>,
) -> Result<String, String> {
    let cfg = config.lock().clone();

    let client = WhisperClient::new(cfg.whisper.endpoint, cfg.whisper.model, cfg.whisper.language);

    client.transcribe(audio_data).await
}

#[tauri::command]
pub async fn test_whisper_connection(config: State<'_, ConfigState>) -> Result<bool, String> {
    let cfg = config.lock().clone();
    let client = WhisperClient::new(cfg.whisper.endpoint, cfg.whisper.model, cfg.whisper.language);
    client.test_connection().await
}
