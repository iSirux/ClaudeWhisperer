use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct HaikuRequest {
    model: String,
    max_tokens: u32,
    messages: Vec<Message>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    text: String,
}

#[derive(Debug, Deserialize)]
struct HaikuResponse {
    content: Vec<ContentBlock>,
}

pub struct HaikuInterpreter {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

impl HaikuInterpreter {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            model,
        }
    }

    pub async fn interpret_prompt(&self, raw_transcript: &str) -> Result<String, String> {
        let system_prompt = r#"You are a helpful assistant that interprets voice-to-text transcriptions for a developer.
Your task is to:
1. Fix any transcription errors (homophones, technical terms, etc.)
2. Clean up filler words and hesitations
3. Format the prompt clearly for a coding assistant
4. Preserve the developer's intent exactly

Return ONLY the cleaned prompt, nothing else. Do not add explanations or commentary."#;

        let request = HaikuRequest {
            model: self.model.clone(),
            max_tokens: 1024,
            messages: vec![
                Message {
                    role: "user".to_string(),
                    content: format!(
                        "{}\n\nRaw transcription to clean:\n{}",
                        system_prompt, raw_transcript
                    ),
                },
            ],
        };

        let response = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Haiku API error: {}", error_text));
        }

        let result: HaikuResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        result
            .content
            .first()
            .map(|c| c.text.clone())
            .ok_or_else(|| "Empty response from Haiku".to_string())
    }
}
