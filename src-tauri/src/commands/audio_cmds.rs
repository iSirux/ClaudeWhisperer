use crate::config::AppConfig;
use crate::haiku::HaikuInterpreter;
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

    let transcript = client.transcribe(audio_data).await?;

    if cfg.haiku.enabled && !cfg.haiku.api_key.is_empty() {
        let interpreter = HaikuInterpreter::new(cfg.haiku.api_key, cfg.haiku.model);
        interpreter.interpret_prompt(&transcript).await
    } else {
        Ok(transcript)
    }
}

#[tauri::command]
pub async fn test_whisper_connection(config: State<'_, ConfigState>) -> Result<bool, String> {
    let cfg = config.lock().clone();
    let client = WhisperClient::new(cfg.whisper.endpoint, cfg.whisper.model, cfg.whisper.language);
    client.test_connection().await
}
