<script lang="ts">
  import type { SdkMessage, SdkImageContent } from '$lib/stores/sdkSessions';
  import { renderMarkdown } from '$lib/utils/markdown';

  let { message, copiedMessageId = null, onCopy }: {
    message: SdkMessage;
    copiedMessageId?: number | null;
    onCopy: (msg: SdkMessage) => void;
  } = $props();

  function createImagePreviewUrl(img: SdkImageContent): string {
    return `data:${img.mediaType};base64,${img.base64Data}`;
  }

  function formatInput(input: Record<string, unknown> | undefined): string {
    if (!input) return '';
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }

  function getToolIcon(tool: string): string {
    const icons: Record<string, string> = {
      Read: '📖',
      Write: '✏️',
      Edit: '🔧',
      Bash: '💻',
      Grep: '🔍',
      Glob: '📁',
      WebFetch: '🌐',
      WebSearch: '🔎',
    };
    return icons[tool] || '🔨';
  }

  let isCopied = $derived(copiedMessageId === message.timestamp);
</script>

<div class="message message-{message.type}">
  {#if message.type === 'user'}
    <div class="user-message">
      {#if message.images && message.images.length > 0}
        <div class="message-images">
          {#each message.images as img}
            <img src={createImagePreviewUrl(img)} alt="Attached" class="message-image" />
          {/each}
        </div>
      {/if}
      {#if message.content}
        <pre class="user-content">{message.content}</pre>
      {/if}
      <button
        class="copy-message-button"
        class:copied={isCopied}
        onclick={() => onCopy(message)}
        title="Copy message"
      >
        {#if isCopied}
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
        {:else}
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
          </svg>
        {/if}
      </button>
    </div>
  {:else if message.type === 'text'}
    <div class="text-message-container">
      <div class="text-content markdown-body">{@html renderMarkdown(message.content ?? '')}</div>
      <button
        class="copy-message-button"
        class:copied={isCopied}
        onclick={() => onCopy(message)}
        title="Copy message"
      >
        {#if isCopied}
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
        {:else}
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
          </svg>
        {/if}
      </button>
    </div>
  {:else if message.type === 'tool_start'}
    <div class="tool-call">
      <div class="tool-header">
        <span class="tool-icon">{getToolIcon(message.tool || '')}</span>
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
  {:else if message.type === 'tool_result'}
    <div class="tool-result">
      <div class="tool-header">
        <span class="tool-icon">{getToolIcon(message.tool || '')}</span>
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
  {:else if message.type === 'error'}
    <div class="error">
      <span class="error-icon">❌</span>
      <span class="error-text">{message.content}</span>
    </div>
  {:else if message.type === 'subagent_start'}
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
    background: #1e293b;
    border-radius: 8px;
    border-left: 3px solid #3b82f6;
    position: relative;
  }

  .user-message:hover .copy-message-button {
    opacity: 1;
  }

  .text-message-container {
    position: relative;
  }

  .text-message-container:hover .copy-message-button {
    opacity: 1;
  }

  .copy-message-button {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    background: #374151;
    color: #9ca3af;
    border: none;
    border-radius: 4px;
    padding: 0.35rem;
    cursor: pointer;
    transition: all 0.2s;
    opacity: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: unset;
  }

  .copy-message-button:hover {
    background: #4b5563;
    color: #e5e7eb;
  }

  .copy-message-button.copied {
    background: #065f46;
    color: #10b981;
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
    color: #e2e8f0;
  }

  .text-content {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.6;
  }

  /* Markdown body styles */
  .markdown-body {
    color: #e0e0e0;
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
    color: #f0f0f0;
  }

  .markdown-body :global(h1:first-child),
  .markdown-body :global(h2:first-child),
  .markdown-body :global(h3:first-child),
  .markdown-body :global(h4:first-child),
  .markdown-body :global(h5:first-child),
  .markdown-body :global(h6:first-child) {
    margin-top: 0;
  }

  .markdown-body :global(h1) { font-size: 1.5em; border-bottom: 1px solid #333; padding-bottom: 0.3em; }
  .markdown-body :global(h2) { font-size: 1.3em; border-bottom: 1px solid #333; padding-bottom: 0.3em; }
  .markdown-body :global(h3) { font-size: 1.15em; }
  .markdown-body :global(h4) { font-size: 1em; }
  .markdown-body :global(h5) { font-size: 0.9em; }
  .markdown-body :global(h6) { font-size: 0.85em; color: #888; }

  .markdown-body :global(p) {
    margin-top: 0;
    margin-bottom: 0.75em;
  }

  .markdown-body :global(p:last-child) {
    margin-bottom: 0;
  }

  .markdown-body :global(a) {
    color: #6366f1;
    text-decoration: none;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-body :global(strong) {
    font-weight: 600;
    color: #f0f0f0;
  }

  .markdown-body :global(em) {
    font-style: italic;
  }

  .markdown-body :global(code) {
    background: #1a1a2e;
    padding: 0.2em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .markdown-body :global(pre) {
    background: #1a1a2e;
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
    border-left: 4px solid #6366f1;
    background: #1a1a2e;
    color: #aaa;
  }

  .markdown-body :global(blockquote p) {
    margin-bottom: 0;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid #333;
    margin: 1em 0;
  }

  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid #333;
    padding: 0.5em 0.75em;
    text-align: left;
  }

  .markdown-body :global(th) {
    background: #1a1a2e;
    font-weight: 600;
  }

  .markdown-body :global(tr:nth-child(even)) {
    background: rgba(26, 26, 46, 0.5);
  }

  /* Highlight.js theme overrides for dark mode */
  .markdown-body :global(.hljs) {
    background: transparent;
    color: #e0e0e0;
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
    background: #1a1a2e;
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
    color: #6366f1;
    font-weight: 600;
  }

  .tool-result .tool-name {
    color: #22c55e;
  }

  .tool-status {
    font-size: 0.75rem;
    color: #888;
    margin-left: auto;
  }

  .tool-status.completed {
    color: #22c55e;
  }

  .tool-input,
  .tool-output {
    margin-top: 0.5rem;
  }

  .tool-input summary,
  .tool-output summary {
    cursor: pointer;
    font-size: 0.8rem;
    color: #888;
    user-select: none;
  }

  .tool-input pre,
  .tool-output pre {
    margin: 0.5rem 0 0 0;
    padding: 0.5rem;
    background: #0f0f1a;
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
    background: rgba(239, 68, 68, 0.1);
    border-radius: 6px;
    border-left: 3px solid #ef4444;
  }

  .error-icon {
    flex-shrink: 0;
  }

  .error-text {
    color: #ef4444;
    font-size: 0.9rem;
  }

  /* Subagent styles */
  .subagent-call {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    padding: 0.75rem;
    border-radius: 6px;
    border-left: 3px solid #8b5cf6;
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
    color: #a78bfa;
    font-weight: 600;
    font-size: 0.85rem;
  }

  .subagent-type {
    background: #8b5cf6;
    color: #fff;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    margin-left: auto;
  }

  .subagent-id {
    font-size: 0.75rem;
    color: #64748b;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
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
