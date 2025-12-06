use crate::config::{LlmModelPriority, LlmProvider};
use serde::{Deserialize, Serialize};

/// Response types for structured outputs

/// Result for generating a session name from the initial prompt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionNameResult {
    pub name: String,
    pub category: String, // feature, bugfix, refactor, research, question, other
}

/// Result for generating a session outcome after completion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionOutcomeResult {
    pub outcome: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionAnalysis {
    pub needs_interaction: bool,
    pub reason: Option<String>,
    pub urgency: String, // low, medium, high
    pub waiting_for: Option<String>, // approval, clarification, input, review, decision
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionCleanupResult {
    pub cleaned_text: String,
    pub corrections_made: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRecommendation {
    pub recommended_model: String, // haiku, sonnet, opus
    pub reasoning: String,
    pub confidence: String, // low, medium, high
    pub suggested_thinking: Option<String>, // null, think, megathink, ultrathink
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub success: bool,
    pub error: Option<String>,
    pub model_info: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoDescriptionResult {
    pub description: String,
    pub keywords: Vec<String>,
    /// Project-specific vocabulary/lingo (20-50 words) - actual terms used in the codebase
    pub vocabulary: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoRecommendation {
    /// The index of the recommended repository (0-based), or -1 if no clear match
    pub recommended_index: i64,
    /// The name of the recommended repository, or empty string if no clear match
    pub recommended_name: String,
    pub confidence: String, // low, medium, high
    pub reasoning: String,
}

impl RepoRecommendation {
    /// Returns the recommended index as Option<usize>, converting -1 to None
    pub fn get_index(&self) -> Option<usize> {
        if self.recommended_index >= 0 {
            Some(self.recommended_index as usize)
        } else {
            None
        }
    }

    /// Returns the recommended name as Option<&str>, converting empty string to None
    pub fn get_name(&self) -> Option<&str> {
        if self.recommended_name.is_empty() {
            None
        } else {
            Some(&self.recommended_name)
        }
    }
}

/// Unified LLM client that supports multiple providers (Gemini, OpenAI, Groq, Local)
pub struct LlmClient {
    client: reqwest::Client,
    api_key: String,
    model: String,
    provider: LlmProvider,
    endpoint: Option<String>,
    /// When true and provider is Gemini, automatically select model with fallbacks
    auto_model: bool,
    /// Model priority when auto_model is enabled
    model_priority: LlmModelPriority,
}

// Type alias for backwards compatibility
pub type GeminiClient = LlmClient;

/// Model fallback chains for Gemini provider
const GEMINI_MODELS_SPEED: &[&str] = &[
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
];

const GEMINI_MODELS_ACCURACY: &[&str] = &[
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
];

// ============================================================================
// Gemini API Types
// ============================================================================

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    generation_config: Option<GeminiGenerationConfig>,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiGenerationConfig {
    response_mime_type: String,
    response_schema: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<GeminiCandidate>>,
    error: Option<GeminiError>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiCandidateContent,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidateContent {
    parts: Vec<GeminiResponsePart>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponsePart {
    text: String,
}

#[derive(Debug, Deserialize)]
struct GeminiError {
    message: String,
}

// ============================================================================
// OpenAI-compatible API Types
// ============================================================================

#[derive(Debug, Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<OpenAIResponseFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
}

#[derive(Debug, Serialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OpenAIResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponse {
    choices: Option<Vec<OpenAIChoice>>,
    error: Option<OpenAIError>,
}

#[derive(Debug, Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAIResponseMessage {
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAIError {
    message: String,
}

impl LlmClient {
    pub fn new(
        api_key: String,
        model: String,
        provider: LlmProvider,
        endpoint: Option<String>,
        auto_model: bool,
        model_priority: LlmModelPriority,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            model,
            provider,
            endpoint,
            auto_model,
            model_priority,
        }
    }

    /// Get the fallback chain of models based on priority
    fn get_model_fallback_chain(&self) -> Vec<&str> {
        if !self.auto_model || !matches!(self.provider, LlmProvider::Gemini) {
            // No fallback - just use the configured model
            return vec![];
        }

        match self.model_priority {
            LlmModelPriority::Speed => GEMINI_MODELS_SPEED.to_vec(),
            LlmModelPriority::Accuracy => GEMINI_MODELS_ACCURACY.to_vec(),
        }
    }

    fn api_url_for_model(&self, model: &str) -> String {
        match &self.provider {
            LlmProvider::Gemini => {
                format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                    model, self.api_key
                )
            }
            LlmProvider::OpenAI => {
                "https://api.openai.com/v1/chat/completions".to_string()
            }
            LlmProvider::Groq => {
                "https://api.groq.com/openai/v1/chat/completions".to_string()
            }
            LlmProvider::Local | LlmProvider::Custom => {
                self.endpoint
                    .clone()
                    .unwrap_or_else(|| "http://localhost:1234/v1/chat/completions".to_string())
            }
        }
    }

    fn api_url(&self) -> String {
        self.api_url_for_model(&self.model)
    }

    fn is_openai_compatible(&self) -> bool {
        !matches!(self.provider, LlmProvider::Gemini)
    }

    /// Test connection to the LLM API
    pub async fn test_connection(&self) -> Result<ConnectionTestResult, String> {
        let prompt = "Say 'Hello' in one word.";

        if self.is_openai_compatible() {
            self.test_connection_openai(prompt).await
        } else {
            self.test_connection_gemini(prompt).await
        }
    }

    async fn test_connection_gemini(&self, prompt: &str) -> Result<ConnectionTestResult, String> {
        let request = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart {
                    text: prompt.to_string(),
                }],
            }],
            generation_config: None,
        };

        match self.client.post(&self.api_url()).json(&request).send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<GeminiResponse>().await {
                        Ok(resp) => {
                            if let Some(error) = resp.error {
                                Ok(ConnectionTestResult {
                                    success: false,
                                    error: Some(error.message),
                                    model_info: None,
                                })
                            } else {
                                Ok(ConnectionTestResult {
                                    success: true,
                                    error: None,
                                    model_info: Some(self.model.clone()),
                                })
                            }
                        }
                        Err(e) => Ok(ConnectionTestResult {
                            success: false,
                            error: Some(format!("Failed to parse response: {}", e)),
                            model_info: None,
                        }),
                    }
                } else {
                    let error_text = response.text().await.unwrap_or_default();
                    Ok(ConnectionTestResult {
                        success: false,
                        error: Some(format!("API error: {}", error_text)),
                        model_info: None,
                    })
                }
            }
            Err(e) => Ok(ConnectionTestResult {
                success: false,
                error: Some(format!("Request failed: {}", e)),
                model_info: None,
            }),
        }
    }

    async fn test_connection_openai(&self, prompt: &str) -> Result<ConnectionTestResult, String> {
        let request = OpenAIRequest {
            model: self.model.clone(),
            messages: vec![OpenAIMessage {
                role: "user".to_string(),
                content: prompt.to_string(),
            }],
            response_format: None,
            temperature: Some(0.0),
        };

        let mut req = self.client.post(&self.api_url()).json(&request);

        // Add Authorization header for non-local providers
        if !matches!(self.provider, LlmProvider::Local) && !self.api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.api_key));
        }

        match req.send().await {
            Ok(response) => {
                if response.status().is_success() {
                    match response.json::<OpenAIResponse>().await {
                        Ok(resp) => {
                            if let Some(error) = resp.error {
                                Ok(ConnectionTestResult {
                                    success: false,
                                    error: Some(error.message),
                                    model_info: None,
                                })
                            } else {
                                Ok(ConnectionTestResult {
                                    success: true,
                                    error: None,
                                    model_info: Some(self.model.clone()),
                                })
                            }
                        }
                        Err(e) => Ok(ConnectionTestResult {
                            success: false,
                            error: Some(format!("Failed to parse response: {}", e)),
                            model_info: None,
                        }),
                    }
                } else {
                    let error_text = response.text().await.unwrap_or_default();
                    Ok(ConnectionTestResult {
                        success: false,
                        error: Some(format!("API error: {}", error_text)),
                        model_info: None,
                    })
                }
            }
            Err(e) => Ok(ConnectionTestResult {
                success: false,
                error: Some(format!("Request failed: {}", e)),
                model_info: None,
            }),
        }
    }

    /// Generate a session name from the user's prompt (called immediately when prompt is sent)
    pub async fn generate_session_name(
        &self,
        user_prompt: &str,
    ) -> Result<SessionNameResult, String> {
        let prompt = format!(
            r#"Generate a concise name for this coding session based on the user's request.

User's request:
{}

Respond with ONLY a JSON object in this exact format:
{{"name": "3-6 word concise name describing the task", "category": "feature|bugfix|refactor|research|question|other"}}"#,
            truncate_text(user_prompt, 500)
        );

        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "A concise session name (3-6 words, no special characters)"
                },
                "category": {
                    "type": "string",
                    "enum": ["feature", "bugfix", "refactor", "research", "question", "plan", "other"],
                    "description": "The type of task"
                }
            },
            "required": ["name", "category"]
        });

        self.generate_structured(&prompt, Some(schema)).await
    }

    /// Generate a session outcome after the session completes
    /// This provides a brief result of what happened - answer to question, implementation status, etc.
    pub async fn generate_session_outcome(
        &self,
        user_prompt: &str,
        assistant_messages: &str,
    ) -> Result<SessionOutcomeResult, String> {
        let prompt = format!(
            r#"Analyze this completed coding session and extract the KEY RESULT.

IMPORTANT: Include the actual answer/value, not a description of what was provided.

Examples of BAD outcomes (too vague, clickbait-style):
- "Provided the movement speed values" ❌
- "Explained the authentication flow" ❌
- "Found the issue" ❌

Examples of GOOD outcomes (specific, informative):
- "Player speed: 5.0, Enemy speed: 3.5" ✓
- "Use JWT tokens with 24h expiry" ✓
- "Missing null check in getUserById()" ✓
- "Added dark mode toggle to settings" ✓
- "File not found - path was incorrect" ✓

The outcome should be:
- If the user asked a question: THE ACTUAL ANSWER with specific values/names
- If it was an implementation task: What was specifically done
- If there was an error: The specific error or blocker

Keep it brief (5-15 words) but INCLUDE THE ACTUAL INFORMATION.

User's original request:
{}

Assistant's work (truncated):
{}

Respond with ONLY a JSON object in this exact format:
{{"outcome": "the specific result or answer"}}"#,
            truncate_text(user_prompt, 500),
            truncate_text(assistant_messages, 2000)
        );

        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "outcome": {
                    "type": "string",
                    "description": "A brief outcome describing what was accomplished or the answer (3-10 words)"
                }
            },
            "required": ["outcome"]
        });

        self.generate_structured(&prompt, Some(schema)).await
    }

    /// Analyze if the last message requires human interaction
    pub async fn analyze_interaction_needed(
        &self,
        last_message: &str,
    ) -> Result<InteractionAnalysis, String> {
        let prompt = format!(
            r#"Analyze this AI assistant's message to determine if it TRULY requires human interaction to proceed.

IMPORTANT: Only flag as needs_interaction=true if the assistant CANNOT proceed without user input.

DO NOT flag as needing interaction:
- Polite offers to help further (e.g., "Would you like me to...", "Let me know if you need...")
- Conversational questions that don't block progress (e.g., "Would you like help with X?")
- Suggestions or recommendations the user can ignore
- "Is there anything else?" type questions
- Offers to implement additional features
- Questions about whether the user wants more examples or explanations

DO flag as needing interaction:
- Explicit requests for required information (e.g., "What is your API key?", "Which database should I use?")
- Errors that require user decision to resolve
- Multiple critical options where the assistant cannot reasonably choose
- Requests for approval before destructive operations (e.g., deleting files, force pushing)
- Missing required configuration or credentials
- Ambiguous requirements where proceeding would be risky

Message to analyze:
{}

Respond with ONLY a JSON object in this exact format:
{{"needs_interaction": true/false, "reason": "why or null", "urgency": "low|medium|high", "waiting_for": "approval|clarification|input|review|decision|null"}}"#,
            truncate_text(last_message, 2000)
        );

        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "needs_interaction": {
                    "type": "boolean",
                    "description": "Whether the message requires human input to proceed"
                },
                "reason": {
                    "type": "string",
                    "description": "Why interaction is needed (null if not needed)"
                },
                "urgency": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "How urgently the interaction is needed"
                },
                "waiting_for": {
                    "type": "string",
                    "enum": ["approval", "clarification", "input", "review", "decision"],
                    "description": "What type of interaction is needed (null if not needed)"
                }
            },
            "required": ["needs_interaction", "urgency"]
        });

        self.generate_structured(&prompt, Some(schema)).await
    }

    /// Clean up voice transcription errors
    /// When vosk_transcription is provided, both transcriptions are compared
    /// to improve accuracy (Whisper is more accurate but may miss context that Vosk captured)
    pub async fn clean_transcription(
        &self,
        whisper_transcription: &str,
        vosk_transcription: Option<&str>,
        repo_context: Option<&str>,
    ) -> Result<TranscriptionCleanupResult, String> {
        let context_section = if let Some(context) = repo_context {
            format!(
                r#"
Project context (use this to better recognize project-specific terms):
{}

"#,
                context
            )
        } else {
            String::new()
        };

        // Build the transcription section based on whether we have both sources
        let transcription_section = if let Some(vosk) = vosk_transcription {
            format!(
                r#"You have two transcriptions from different speech-to-text engines:

**Whisper transcription** (more accurate, but may miss quick words):
{}

**Vosk transcription** (real-time, may capture words Whisper missed but less accurate overall):
{}

Compare both transcriptions and produce the best combined result. Use Whisper as the primary source but incorporate any clearly correct words from Vosk that Whisper may have missed."#,
                truncate_text(whisper_transcription, 1500),
                truncate_text(vosk, 1500)
            )
        } else {
            format!(
                "Transcription to clean:\n{}",
                truncate_text(whisper_transcription, 2000)
            )
        };

        let prompt = format!(
            r#"Clean up this voice transcription for a software development task. Fix:

1. Common homophones (there/their/they're, your/you're, its/it's, etc.)
2. Technical terms that may have been misheard (e.g., "react" vs "re-act", "typescript" vs "type script")
3. Missing or incorrect punctuation
4. Code-related terms (function names, file extensions, programming concepts)
5. Common speech-to-text errors
{}
Keep the original meaning and intent. Only fix clear errors, don't rewrite the content.

{}

Respond with ONLY a JSON object in this exact format:
{{"cleaned_text": "the corrected text", "corrections_made": ["correction 1", "correction 2"]}}"#,
            context_section,
            transcription_section
        );

        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "cleaned_text": {
                    "type": "string",
                    "description": "The corrected transcription with proper punctuation and fixed errors"
                },
                "corrections_made": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of corrections made"
                }
            },
            "required": ["cleaned_text", "corrections_made"]
        });

        self.generate_structured(&prompt, Some(schema)).await
    }

    /// Recommend the best model for a given prompt
    pub async fn recommend_model(&self, prompt: &str) -> Result<ModelRecommendation, String> {
        let prompt_text = format!(
            r#"Analyze this software development prompt and recommend the best Claude model.

Model capabilities:
- **Haiku**: Fast, cheap. Best for simple questions, quick lookups, straightforward code edits, syntax questions, documentation searches.
- **Sonnet**: Balanced. Good for typical coding tasks, debugging, feature implementation, code review, refactoring.
- **Opus**: Most capable, expensive. Best for complex architecture, multi-file refactoring, difficult debugging, system design, novel problem-solving.

Extended thinking levels (for complex reasoning):
- **null**: No extended thinking needed (most tasks)
- **think**: Basic extended thinking for moderate complexity
- **megathink**: For architectural decisions, complex algorithms
- **ultrathink**: Deep analysis, very complex system design

Prompt to analyze:
{}

Choose the most cost-effective model that can handle this task well. Prefer cheaper models when the task is simple.

Respond with ONLY a JSON object in this exact format:
{{"recommended_model": "haiku|sonnet|opus", "reasoning": "brief explanation", "confidence": "low|medium|high", "suggested_thinking": "null|think|megathink|ultrathink"}}"#,
            truncate_text(prompt, 1500)
        );

        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "recommended_model": {
                    "type": "string",
                    "enum": ["haiku", "sonnet", "opus"],
                    "description": "The recommended Claude model"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of why this model was chosen"
                },
                "confidence": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Confidence level in this recommendation"
                },
                "suggested_thinking": {
                    "type": "string",
                    "enum": ["null", "think", "megathink", "ultrathink"],
                    "description": "Suggested extended thinking level"
                }
            },
            "required": ["recommended_model", "reasoning", "confidence", "suggested_thinking"]
        });

        self.generate_structured(&prompt_text, Some(schema)).await
    }

    /// Generate a description for a repository based on its CLAUDE.md or README content
    pub async fn generate_repo_description(
        &self,
        repo_name: &str,
        claude_md_content: Option<&str>,
        readme_content: Option<&str>,
    ) -> Result<RepoDescriptionResult, String> {
        let content = match (claude_md_content, readme_content) {
            (Some(claude_md), _) => format!("CLAUDE.md content:\n{}", truncate_text(claude_md, 4000)),
            (None, Some(readme)) => format!("README content:\n{}", truncate_text(readme, 4000)),
            (None, None) => format!("Repository name: {}", repo_name),
        };

        let prompt = format!(
            r#"Generate a description, keywords, and vocabulary for this software repository to help with auto-selection and voice transcription accuracy.

Repository: {}

{}

Create THREE distinct outputs:

1. **Description** (1-2 sentences): What the project does and its main technologies

2. **Keywords** (~20 words): Categorical/conceptual terms for matching user intent:
   - Technology categories (e.g., "frontend", "database", "authentication")
   - Domain concepts (e.g., "e-commerce", "real-time", "streaming")
   - Feature types (e.g., "CRUD", "API", "dashboard")
   - Action verbs users might say (e.g., "deploy", "migrate", "refactor")

3. **Vocabulary** (20-50 words): Actual project-specific lingo/jargon that appears in the codebase:
   - Function/class/module names (e.g., "SdkSession", "useSettings", "transcribeAudio")
   - File names and paths (e.g., "config.rs", "llm.ts", "overlay")
   - Custom types and interfaces (e.g., "RepoConfig", "WhisperProvider")
   - Project-specific terminology (e.g., "sidecar", "PTY", "hotkey")
   - Abbreviations and acronyms used (e.g., "SDK", "LLM", "WSL")
   - Library/framework specific terms (e.g., "Tauri", "Svelte", "xterm")

Keywords help match "I want to add authentication" to the right repo.
Vocabulary helps speech-to-text correctly hear "SdkSession" instead of "SDK session" or "useSettings" instead of "use settings".

Respond with ONLY a JSON object in this exact format:
{{"description": "...", "keywords": ["..."], "vocabulary": ["..."]}}"#,
            repo_name,
            content
        );

        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": "A concise 1-2 sentence description of the repository"
                },
                "keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Categorical/conceptual keywords for matching user intent (~20 words)"
                },
                "vocabulary": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Project-specific lingo/jargon from the codebase (20-50 words)"
                }
            },
            "required": ["description", "keywords", "vocabulary"]
        });

        self.generate_structured(&prompt, Some(schema)).await
    }

    /// Recommend the best repository for a given prompt
    pub async fn recommend_repo(
        &self,
        prompt: &str,
        repos: &[(String, String, Option<String>, Option<Vec<String>>, Option<Vec<String>>)], // (name, path, description, keywords, vocabulary)
        is_transcribed: bool,
    ) -> Result<RepoRecommendation, String> {
        if repos.is_empty() {
            return Ok(RepoRecommendation {
                recommended_index: -1,
                recommended_name: String::new(),
                confidence: "low".to_string(),
                reasoning: "No repositories configured".to_string(),
            });
        }

        let repos_list = repos
            .iter()
            .enumerate()
            .map(|(i, (name, path, desc, keywords, vocabulary))| {
                let desc_text = desc.as_deref().unwrap_or("No description");
                let keywords_text = keywords
                    .as_ref()
                    .map(|kw| kw.join(", "))
                    .unwrap_or_else(|| "None".to_string());
                let vocab_text = vocabulary
                    .as_ref()
                    .map(|v| v.join(", "))
                    .unwrap_or_else(|| "None".to_string());
                format!(
                    "{}. {} ({})\n   Description: {}\n   Keywords: {}\n   Vocabulary: {}",
                    i, name, path, desc_text, keywords_text, vocab_text
                )
            })
            .collect::<Vec<_>>()
            .join("\n\n");

        // Add transcription context if the prompt was voice-transcribed
        let transcription_notice = if is_transcribed {
            "\n\nNOTE: The user's prompt was recorded via voice and transcribed using speech-to-text. \
             There may be minor transcription errors such as homophones, missing punctuation, or misheard words. \
             Pay special attention to the Vocabulary field - if the prompt contains words that sound like items in a repo's vocabulary, that's a strong match signal.\n"
        } else {
            ""
        };

        let prompt_text = format!(
            r#"Based on the user's prompt, recommend which repository they should work in.

Available repositories:
{}
{transcription_notice}
User's prompt:
{}

Analyze the prompt and determine which repository best matches. Consider:
- **Keywords**: Categorical terms that match the user's intent (e.g., "authentication", "frontend")
- **Vocabulary**: Project-specific lingo - if the prompt mentions terms from a repo's vocabulary, it's likely the right repo
- Project names or terminology mentioned
- Technologies or frameworks referenced
- Domain or feature areas discussed

For voice-transcribed prompts: The vocabulary is especially important because speech-to-text might transcribe project-specific terms incorrectly. Look for words that sound similar to vocabulary items.

IMPORTANT: If the prompt doesn't contain enough information to make a meaningful recommendation (e.g., generic requests like "help me with this" or "fix the bug"), return -1 for recommended_index and empty string for recommended_name. Only recommend a repository if you have actual evidence from the prompt to support the choice.

Respond with ONLY a JSON object in this exact format:
{{"recommended_index": 0, "recommended_name": "repo name", "confidence": "low|medium|high", "reasoning": "brief explanation"}}

Or if no clear match:
{{"recommended_index": -1, "recommended_name": "", "confidence": "low", "reasoning": "Not enough information to determine repository"}}"#,
            repos_list,
            truncate_text(prompt, 1500)
        );

        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "recommended_index": {
                    "type": "integer",
                    "description": "The index of the recommended repository (0-based), or -1 if no clear match"
                },
                "recommended_name": {
                    "type": "string",
                    "description": "The name of the recommended repository, or empty string if no clear match"
                },
                "confidence": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Confidence level in this recommendation"
                },
                "reasoning": {
                    "type": "string",
                    "description": "Brief explanation of why this repo was chosen or why no recommendation could be made"
                }
            },
            "required": ["recommended_index", "recommended_name", "confidence", "reasoning"]
        });

        self.generate_structured(&prompt_text, Some(schema)).await
    }

    /// Internal method for structured generation
    async fn generate_structured<T: for<'de> Deserialize<'de>>(
        &self,
        prompt: &str,
        schema: Option<serde_json::Value>,
    ) -> Result<T, String> {
        let text = if self.is_openai_compatible() {
            self.generate_openai(prompt).await?
        } else {
            self.generate_gemini(prompt, schema).await?
        };

        // Try to extract JSON from the response (handle markdown code blocks)
        let json_text = extract_json(&text);

        serde_json::from_str(&json_text)
            .map_err(|e| format!("Failed to parse JSON response: {}. Raw text: {}", e, text))
    }

    /// Try a single Gemini model request
    async fn try_gemini_model(
        &self,
        model: &str,
        prompt: &str,
        schema: &Option<serde_json::Value>,
    ) -> Result<String, String> {
        let request = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart {
                    text: prompt.to_string(),
                }],
            }],
            generation_config: schema.clone().map(|s| GeminiGenerationConfig {
                response_mime_type: "application/json".to_string(),
                response_schema: Some(s),
            }),
        };

        let response = self
            .client
            .post(&self.api_url_for_model(model))
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Gemini API error ({}): {}", model, error_text));
        }

        let gemini_response: GeminiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        if let Some(error) = gemini_response.error {
            return Err(format!("Gemini error ({}): {}", model, error.message));
        }

        gemini_response
            .candidates
            .and_then(|c| c.into_iter().next())
            .and_then(|c| c.content.parts.into_iter().next())
            .map(|p| p.text)
            .ok_or_else(|| format!("No response from Gemini ({})", model))
    }

    async fn generate_gemini(
        &self,
        prompt: &str,
        schema: Option<serde_json::Value>,
    ) -> Result<String, String> {
        let fallback_chain = self.get_model_fallback_chain();

        // If auto_model is enabled and we have a fallback chain, try each model
        if !fallback_chain.is_empty() {
            let mut last_error = String::new();

            for model in fallback_chain {
                match self.try_gemini_model(model, prompt, &schema).await {
                    Ok(result) => {
                        // Log which model succeeded (helpful for debugging)
                        eprintln!("[gemini] Request succeeded with model: {}", model);
                        return Ok(result);
                    }
                    Err(e) => {
                        eprintln!("[gemini] Model {} failed, trying next: {}", model, e);
                        last_error = e;
                    }
                }
            }

            // All models failed
            return Err(format!("All Gemini models failed. Last error: {}", last_error));
        }

        // No fallback - use the configured model directly
        self.try_gemini_model(&self.model, prompt, &schema).await
    }

    async fn generate_openai(&self, prompt: &str) -> Result<String, String> {
        let request = OpenAIRequest {
            model: self.model.clone(),
            messages: vec![
                OpenAIMessage {
                    role: "system".to_string(),
                    content: "You are a helpful assistant that responds only with valid JSON. Do not include any markdown formatting or code blocks, just the raw JSON object.".to_string(),
                },
                OpenAIMessage {
                    role: "user".to_string(),
                    content: prompt.to_string(),
                },
            ],
            response_format: Some(OpenAIResponseFormat {
                format_type: "json_object".to_string(),
            }),
            temperature: Some(0.0),
        };

        let mut req = self.client.post(&self.api_url()).json(&request);

        // Add Authorization header for non-local providers
        if !matches!(self.provider, LlmProvider::Local) && !self.api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.api_key));
        }

        let response = req
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("API error ({}): {}", status, error_text));
        }

        let openai_response: OpenAIResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        if let Some(error) = openai_response.error {
            return Err(format!("API error: {}", error.message));
        }

        openai_response
            .choices
            .and_then(|c| c.into_iter().next())
            .map(|c| c.message.content)
            .ok_or_else(|| "No response from API".to_string())
    }
}

/// Extract JSON from text that might be wrapped in markdown code blocks
fn extract_json(text: &str) -> String {
    let trimmed = text.trim();

    // Check for ```json ... ``` or ``` ... ```
    if trimmed.starts_with("```") {
        let without_prefix = if trimmed.starts_with("```json") {
            &trimmed[7..]
        } else {
            &trimmed[3..]
        };

        if let Some(end) = without_prefix.rfind("```") {
            return without_prefix[..end].trim().to_string();
        }
    }

    // Return as-is if no code block
    trimmed.to_string()
}

/// Truncate text to a maximum length, adding ellipsis if truncated
fn truncate_text(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len.saturating_sub(3)])
    }
}
