use serde::{Deserialize, Serialize};

// ============================================================================
// Common Usage Types
// ============================================================================

/// Token usage data extracted from LLM API responses
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LlmUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

// ============================================================================
// Gemini API Types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct GeminiRequest {
    pub contents: Vec<GeminiContent>,
    pub generation_config: Option<GeminiGenerationConfig>,
}

#[derive(Debug, Serialize)]
pub struct GeminiContent {
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
pub struct GeminiPart {
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiGenerationConfig {
    pub response_mime_type: String,
    pub response_schema: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiResponse {
    pub candidates: Option<Vec<GeminiCandidate>>,
    pub error: Option<GeminiError>,
    #[serde(rename = "usageMetadata")]
    pub usage_metadata: Option<GeminiUsageMetadata>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeminiUsageMetadata {
    pub prompt_token_count: Option<u64>,
    pub candidates_token_count: Option<u64>,
    pub total_token_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiCandidate {
    pub content: GeminiCandidateContent,
}

#[derive(Debug, Deserialize)]
pub struct GeminiCandidateContent {
    pub parts: Vec<GeminiResponsePart>,
}

#[derive(Debug, Deserialize)]
pub struct GeminiResponsePart {
    pub text: String,
}

#[derive(Debug, Deserialize)]
pub struct GeminiError {
    pub message: String,
}

// ============================================================================
// OpenAI-compatible API Types
// ============================================================================

#[derive(Debug, Serialize)]
pub struct OpenAIRequest {
    pub model: String,
    pub messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_format: Option<OpenAIResponseFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
pub struct OpenAIMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct OpenAIResponseFormat {
    #[serde(rename = "type")]
    pub format_type: String,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIResponse {
    pub choices: Option<Vec<OpenAIChoice>>,
    pub error: Option<OpenAIError>,
    pub usage: Option<OpenAIUsage>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIUsage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIChoice {
    pub message: OpenAIResponseMessage,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIResponseMessage {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct OpenAIError {
    pub message: String,
}
