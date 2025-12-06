<script lang="ts">
  import type { SdkMessage, SdkImageContent } from "$lib/stores/sdkSessions";
  import { renderMarkdown } from "$lib/utils/markdown";
  import RerunDropdown from "./RerunDropdown.svelte";

  let {
    message,
    copiedMessageId = null,
    onCopy,
    sessionCwd = "",
    sessionModel = "",
  }: {
    message: SdkMessage;
    copiedMessageId?: number | null;
    onCopy: (msg: SdkMessage) => void;
    sessionCwd?: string;
    sessionModel?: string;
  } = $props();

  function createImagePreviewUrl(img: SdkImageContent): string {
    return `data:${img.mediaType};base64,${img.base64Data}`;
  }

  function formatInput(input: Record<string, unknown> | undefined): string {
    if (!input) return "";
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }

  function getToolIcon(tool: string): string {
    const icons: Record<string, string> = {
      Read: "📖",
      Write: "✏️",
      Edit: "🔧",
      Bash: "💻",
      Grep: "🔍",
      Glob: "📁",
      WebFetch: "🌐",
      WebSearch: "🔎",
    };
    return icons[tool] || "🔨";
  }

  let isCopied = $derived(copiedMessageId === message.timestamp);
</script>

<div class="message message-{message.type}">
  {#if message.type === "user"}
    <div class="user-message">
      {#if message.images && message.images.length > 0}
        <div class="message-images">
          {#each message.images as img}
            <img
              src={createImagePreviewUrl(img)}
              alt="Attached"
              class="message-image"
            />
          {/each}
        </div>
      {/if}
      {#if message.content}
        <pre class="user-content">{message.content}</pre>
      {/if}
      <div class="message-actions">
        {#if sessionCwd && sessionModel && message.content}
          <RerunDropdown
            prompt={message.content}
            images={message.images}
            currentCwd={sessionCwd}
            currentModel={sessionModel}
          />
        {/if}
        <button
          class="copy-message-button"
          class:copied={isCopied}
          onclick={() => onCopy(message)}
          title="Copy message"
        >
          {#if isCopied}
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clip-rule="evenodd"
              />
            </svg>
          {:else}
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
              <path
                d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"
              />
            </svg>
          {/if}
        </button>
      </div>
    </div>
  {:else if message.type === "text"}
    <div class="text-message-container">
      <div class="text-content markdown-body">
        {@html renderMarkdown(message.content ?? "")}
      </div>
      <button
        class="copy-message-button"
        class:copied={isCopied}
        onclick={() => onCopy(message)}
        title="Copy message"
      >
        {#if isCopied}
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
        {:else}
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
            <path
              d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"
            />
          </svg>
        {/if}
      </button>
    </div>
  {:else if message.type === "tool_start"}
    <div class="tool-call">
      <div class="tool-header">
        <span class="tool-icon">{getToolIcon(message.tool || "")}</span>
        <span class="tool-name">{message.tool}</span>
        <span class="tool-status">running...</span>
      </div>
      {#if message.input && Object.keys(message.input).length > 0}
        <details class="tool-input">
          <summary>Input</summary>
          <pre>{formatInput(message.input)}</pre>
        </details>
      {/if}
    </div>
  {:else if message.type === "tool_result"}
    <div class="tool-result">
      <div class="tool-header">
        <span class="tool-icon">{getToolIcon(message.tool || "")}</span>
        <span class="tool-name">{message.tool}</span>
        <span class="tool-status completed">completed</span>
      </div>
      {#if message.output}
        <details class="tool-output">
          <summary>Output</summary>
          <pre>{message.output}</pre>
        </details>
      {/if}
    </div>
  {:else if message.type === "error"}
    <div class="error">
      <span class="error-icon">❌</span>
      <span class="error-text">{message.content}</span>
    </div>
  {:else if message.type === "subagent_start"}
    <div class="subagent-call">
      <div class="subagent-header">
        <span class="subagent-icon">🤖</span>
        <span class="subagent-label">Subagent Started</span>
        <span class="subagent-type">{message.agentType}</span>
      </div>
      <div class="subagent-id">ID: {message.agentId?.slice(0, 8)}...</div>
    </div>
  {/if}
</div>

<style>
  .message {
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .user-message {
    padding: 0.75rem 1rem;
    background: var(--color-surface);
    border-radius: 8px;
    position: relative;
  }

  .user-message:hover .message-actions {
    opacity: 1;
  }

  .text-message-container {
    position: relative;
  }

  .text-message-container:hover .copy-message-button {
    opacity: 1;
  }

  .message-actions {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .user-message:hover .message-actions,
  .message-actions:focus-within {
    opacity: 1;
  }

  .copy-message-button {
    background: var(--color-surface-elevated);
    color: var(--color-text-secondary);
    border: none;
    border-radius: 4px;
    padding: 0.35rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: unset;
  }

  /* For text messages that don't use message-actions wrapper */
  .text-message-container .copy-message-button {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    opacity: 0;
  }

  .copy-message-button:hover {
    background: var(--color-border);
    color: var(--color-text-primary);
  }

  .copy-message-button.copied {
    background: color-mix(in srgb, var(--color-success) 20%, transparent);
    color: var(--color-success);
    opacity: 1;
  }

  .copy-message-button svg {
    width: 14px;
    height: 14px;
  }

  .user-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--color-text-primary);
  }

  .text-content {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.6;
  }

  /* Markdown body styles */
  .markdown-body {
    color: var(--color-text-primary);
  }

  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    margin-top: 1.25em;
    margin-bottom: 0.5em;
    font-weight: 600;
    line-height: 1.25;
    color: var(--color-text-primary);
  }

  .markdown-body :global(h1:first-child),
  .markdown-body :global(h2:first-child),
  .markdown-body :global(h3:first-child),
  .markdown-body :global(h4:first-child),
  .markdown-body :global(h5:first-child),
  .markdown-body :global(h6:first-child) {
    margin-top: 0;
  }

  .markdown-body :global(h1) {
    font-size: 1.5em;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 0.3em;
  }
  .markdown-body :global(h2) {
    font-size: 1.3em;
    border-bottom: 1px solid var(--color-border);
    padding-bottom: 0.3em;
  }
  .markdown-body :global(h3) {
    font-size: 1.15em;
  }
  .markdown-body :global(h4) {
    font-size: 1em;
  }
  .markdown-body :global(h5) {
    font-size: 0.9em;
  }
  .markdown-body :global(h6) {
    font-size: 0.85em;
    color: var(--color-text-muted);
  }

  .markdown-body :global(p) {
    margin-top: 0;
    margin-bottom: 0.75em;
  }

  .markdown-body :global(p:last-child) {
    margin-bottom: 0;
  }

  .markdown-body :global(a) {
    color: var(--color-accent);
    text-decoration: none;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-body :global(strong) {
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .markdown-body :global(em) {
    font-style: italic;
  }

  .markdown-body :global(code) {
    background: var(--color-surface);
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      monospace;
  }

  .markdown-body :global(pre) {
    background: var(--color-surface);
    padding: 1em;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.75em 0;
  }

  .markdown-body :global(pre code) {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: 0.85em;
    line-height: 1.5;
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    margin-top: 0;
    margin-bottom: 0.75em;
    padding-left: 1.5em;
  }

  .markdown-body :global(li) {
    margin-bottom: 0.25em;
  }

  .markdown-body :global(li > ul),
  .markdown-body :global(li > ol) {
    margin-bottom: 0;
  }

  .markdown-body :global(blockquote) {
    margin: 0.75em 0;
    padding: 0.5em 1em;
    border-left: 4px solid var(--color-accent);
    background: var(--color-surface);
    color: var(--color-text-secondary);
  }

  .markdown-body :global(blockquote p) {
    margin-bottom: 0;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border);
    margin: 1em 0;
  }

  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--color-border);
    padding: 0.5em 0.75em;
    text-align: left;
  }

  .markdown-body :global(th) {
    background: var(--color-surface);
    font-weight: 600;
  }

  .markdown-body :global(tr:nth-child(even)) {
    background: color-mix(in srgb, var(--color-surface) 50%, transparent);
  }

  /* Highlight.js theme overrides - these remain fixed for good syntax contrast */
  .markdown-body :global(.hljs) {
    background: transparent;
    color: var(--color-text-primary);
  }

  .markdown-body :global(.hljs-keyword),
  .markdown-body :global(.hljs-selector-tag),
  .markdown-body :global(.hljs-built_in) {
    color: #c678dd;
  }

  .markdown-body :global(.hljs-string),
  .markdown-body :global(.hljs-attr) {
    color: #98c379;
  }

  .markdown-body :global(.hljs-number),
  .markdown-body :global(.hljs-literal) {
    color: #d19a66;
  }

  .markdown-body :global(.hljs-comment) {
    color: #5c6370;
    font-style: italic;
  }

  .markdown-body :global(.hljs-function),
  .markdown-body :global(.hljs-title) {
    color: #61afef;
  }

  .markdown-body :global(.hljs-variable),
  .markdown-body :global(.hljs-params) {
    color: #e06c75;
  }

  .markdown-body :global(.hljs-type),
  .markdown-body :global(.hljs-class) {
    color: #e5c07b;
  }

  .tool-call,
  .tool-result {
    background: var(--color-surface);
    padding: 0.75rem;
    border-radius: 6px;
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .tool-icon {
    font-size: 1rem;
  }

  .tool-name {
    color: var(--color-accent);
    font-weight: 600;
  }

  .tool-result .tool-name {
    color: var(--color-success);
  }

  .tool-status {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-left: auto;
  }

  .tool-status.completed {
    color: var(--color-success);
  }

  .tool-input,
  .tool-output {
    margin-top: 0.5rem;
  }

  .tool-input summary,
  .tool-output summary {
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--color-text-muted);
    user-select: none;
  }

  .tool-input pre,
  .tool-output pre {
    margin: 0.5rem 0 0 0;
    padding: 0.5rem;
    background: var(--color-background);
    border-radius: 4px;
    font-size: 0.8rem;
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
  }

  .error {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--color-error) 10%, transparent);
    border-radius: 6px;
    border-left: 3px solid var(--color-error);
  }

  .error-icon {
    flex-shrink: 0;
  }

  .error-text {
    color: var(--color-error);
    font-size: 0.9rem;
  }

  /* Subagent styles */
  .subagent-call {
    background: linear-gradient(
      135deg,
      var(--color-surface) 0%,
      color-mix(in srgb, var(--color-surface) 80%, var(--color-model-opus)) 100%
    );
    padding: 0.75rem;
    border-radius: 6px;
    border-left: 3px solid var(--color-model-opus);
  }

  .subagent-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .subagent-icon {
    font-size: 1rem;
  }

  .subagent-label {
    color: var(--color-model-opus);
    font-weight: 600;
    font-size: 0.85rem;
  }

  .subagent-type {
    background: var(--color-model-opus);
    color: var(--color-background);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    margin-left: auto;
  }

  .subagent-id {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
      monospace;
  }

  /* Message images */
  .message-images {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .message-image {
    max-width: 300px;
    max-height: 200px;
    border-radius: 4px;
    cursor: pointer;
    transition: transform 0.2s;
  }

  .message-image:hover {
    transform: scale(1.02);
  }
</style>
