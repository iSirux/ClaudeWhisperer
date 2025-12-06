/// Extract JSON from text that might be wrapped in markdown code blocks
pub fn extract_json(text: &str) -> String {
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
pub fn truncate_text(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len.saturating_sub(3)])
    }
}
