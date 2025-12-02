use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResponse {
    pub text: String,
}

pub struct WhisperClient {
    client: reqwest::Client,
    endpoint: String,
    model: String,
    language: String,
}

impl WhisperClient {
    pub fn new(endpoint: String, model: String, language: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            endpoint,
            model,
            language,
        }
    }

    pub async fn transcribe(&self, audio_data: Vec<u8>) -> Result<String, String> {
        let part = Part::bytes(audio_data)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| format!("Failed to create part: {}", e))?;

        let form = Form::new()
            .part("file", part)
            .text("model", self.model.clone())
            .text("language", self.language.clone());

        let response = self
            .client
            .post(&self.endpoint)
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Whisper API error: {}", error_text));
        }

        let result: TranscriptionResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(result.text)
    }

    pub async fn test_connection(&self) -> Result<bool, String> {
        let response = self
            .client
            .get(&self.endpoint.replace("/v1/audio/transcriptions", "/health"))
            .send()
            .await;

        match response {
            Ok(r) => Ok(r.status().is_success()),
            Err(_) => Ok(false),
        }
    }
}
