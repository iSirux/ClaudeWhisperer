//! SDK provider selection and authentication methods.

use serde::{Deserialize, Serialize};

/// SDK provider for the main coding agent (Claude or OpenAI Codex)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum SdkProvider {
    #[default]
    Claude,
    OpenAI,
}

/// Which SDK providers are surfaced in the UI (chosen during onboarding).
/// When only one is enabled, provider pickers are hidden entirely and the
/// disabled provider's settings tab disappears.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct EnabledProviders {
    pub claude: bool,
    pub openai: bool,
}

impl Default for EnabledProviders {
    fn default() -> Self {
        Self {
            claude: true,
            openai: true,
        }
    }
}

/// OpenAI authentication method
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum OpenAiAuthMethod {
    #[default]
    OAuth,
    ApiKey,
}

/// Claude authentication method
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum ClaudeAuthMethod {
    /// Use existing Claude CLI OAuth session (~/.claude/.credentials.json)
    #[default]
    OAuth,
    /// Use API key stored in keyring (ANTHROPIC_API_KEY)
    ApiKey,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum CodexMode {
    #[default]
    AppServer,
    Sdk,
}

/// Permission mode for interactive Claude sessions (maps to the Claude Agent
/// SDK's `permissionMode`). Only affects Claude sessions; OpenAI/Codex ignores it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum ClaudePermissionMode {
    /// Current behavior: auto-approve file edits; other tools are allowed via the
    /// sidecar's `canUseTool` callback (no prompts). Maps to SDK `"acceptEdits"`.
    #[default]
    AcceptEdits,
    /// Research-preview auto mode: an AI classifier reviews each tool call
    /// (including Bash) and runs safe ones automatically, blocking/escalating
    /// risky ones server-side. Maps to SDK `"auto"`.
    Auto,
}

impl ClaudePermissionMode {
    /// The SDK `permissionMode` string this maps to.
    pub fn as_sdk_str(&self) -> &'static str {
        match self {
            ClaudePermissionMode::AcceptEdits => "acceptEdits",
            ClaudePermissionMode::Auto => "auto",
        }
    }
}

/// Permission mode for interactive Codex (OpenAI app-server) sessions. Maps to
/// the app-server's `approvalPolicy` + `sandbox` on `thread/start`/`thread/resume`.
/// Only affects OpenAI/Codex sessions; Claude ignores it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum CodexPermissionMode {
    /// Fully unattended mode: `approvalPolicy: "never"` with an explicit
    /// `danger-full-access` sandbox. The explicit sandbox is important because
    /// the app-server default may be `workspace-write`, which protects `.git`;
    /// combined with `never`, that would make commits impossible with no
    /// approval path.
    #[default]
    AutoApprove,
    /// Codex "Auto" preset: `sandbox: "workspace-write"` +
    /// `approvalPolicy: "on-request"`. Edits/commands inside the workspace run
    /// automatically; leaving the workspace or hitting the network prompts for
    /// approval (surfaced as an approval dialog).
    Auto,
}

impl CodexPermissionMode {
    /// The app-server `approvalPolicy` value (kebab-case, per the protocol schema).
    pub fn approval_policy(&self) -> &'static str {
        match self {
            CodexPermissionMode::AutoApprove => "never",
            CodexPermissionMode::Auto => "on-request",
        }
    }

    /// The app-server `sandbox` value. Always send this explicitly so app-server
    /// defaults cannot silently change the selected permission mode.
    pub fn sandbox_mode(&self) -> &'static str {
        match self {
            CodexPermissionMode::AutoApprove => "danger-full-access",
            CodexPermissionMode::Auto => "workspace-write",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_permission_modes_are_explicit_and_coherent() {
        assert_eq!(CodexPermissionMode::AutoApprove.approval_policy(), "never");
        assert_eq!(
            CodexPermissionMode::AutoApprove.sandbox_mode(),
            "danger-full-access"
        );
        assert_eq!(CodexPermissionMode::Auto.approval_policy(), "on-request");
        assert_eq!(CodexPermissionMode::Auto.sandbox_mode(), "workspace-write");
    }
}
