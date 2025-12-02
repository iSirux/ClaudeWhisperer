<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { sdkSessions, type SdkMessage, type SdkSession } from '$lib/stores/sdkSessions';

  let { sessionId }: { sessionId: string } = $props();

  let prompt = $state('');
  let messagesEl: HTMLDivElement;
  let session = $state<SdkSession | null>(null);
  let unsubscribe: (() => void) | undefined;

  let messages = $derived(session?.messages ?? []);
  let firstUserPrompt = $derived(session?.messages.filter(m => m.type === 'user').at(0)?.content ?? '');
  let status = $derived(session?.status ?? 'idle');
  let isQuerying = $derived(status === 'querying');

  const PROMPT_PREVIEW_LENGTH = 120;
  let truncatedPrompt = $derived(
    firstUserPrompt.length > PROMPT_PREVIEW_LENGTH
      ? firstUserPrompt.slice(0, PROMPT_PREVIEW_LENGTH) + '...'
      : firstUserPrompt
  );

  onMount(() => {
    console.log('[SdkView] Setting up subscription for session:', sessionId);
    unsubscribe = sdkSessions.subscribe((sessions) => {
      try {
        console.log('[SdkView] Store updated, sessions count:', sessions.length);
        const found = sessions.find((s) => s.id === sessionId);
        console.log('[SdkView] Found session:', found?.id, 'status:', found?.status, 'messages:', found?.messages.length);
        session = found || null;
      } catch (err) {
        console.error('[SdkView] Error in subscription:', err);
      }
    });
  });

  onDestroy(() => {
    unsubscribe?.();
  });

  // Auto-scroll on new messages
  $effect(() => {
    if (messages.length && messagesEl) {
      tick().then(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }
  });

  async function sendPrompt() {
    if (!prompt.trim() || isQuerying) return;
    const currentPrompt = prompt;
    prompt = '';
    await sdkSessions.sendPrompt(sessionId, currentPrompt);
  }

  async function stopQuery() {
    if (!isQuerying) return;
    await sdkSessions.stopQuery(sessionId);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
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
</script>

<div class="sdk-view">
  {#if truncatedPrompt}
    <div class="prompt-header">
      <span class="prompt-label">Prompt:</span>
      <span class="prompt-text">{truncatedPrompt}</span>
    </div>
  {/if}
  <div class="messages" bind:this={messagesEl}>
    {#each messages as msg (msg.timestamp)}
      <div class="message message-{msg.type}">
        {#if msg.type === 'user'}
          <div class="user-message">
            <pre class="user-content">{msg.content}</pre>
          </div>
        {:else if msg.type === 'text'}
          <pre class="text-content">{msg.content}</pre>
        {:else if msg.type === 'tool_start'}
          <div class="tool-call">
            <div class="tool-header">
              <span class="tool-icon">{getToolIcon(msg.tool || '')}</span>
              <span class="tool-name">{msg.tool}</span>
              <span class="tool-status">running...</span>
            </div>
            {#if msg.input && Object.keys(msg.input).length > 0}
              <details class="tool-input">
                <summary>Input</summary>
                <pre>{formatInput(msg.input)}</pre>
              </details>
            {/if}
          </div>
        {:else if msg.type === 'tool_result'}
          <div class="tool-result">
            <div class="tool-header">
              <span class="tool-icon">{getToolIcon(msg.tool || '')}</span>
              <span class="tool-name">{msg.tool}</span>
              <span class="tool-status completed">completed</span>
            </div>
            {#if msg.output}
              <details class="tool-output">
                <summary>Output</summary>
                <pre>{msg.output}</pre>
              </details>
            {/if}
          </div>
        {:else if msg.type === 'error'}
          <div class="error">
            <span class="error-icon">❌</span>
            <span class="error-text">{msg.content}</span>
          </div>
        {/if}
      </div>
    {/each}

    {#if isQuerying}
      <div class="message message-loading">
        <div class="loading-indicator">
          <span class="loading-dot"></span>
          <span class="loading-dot"></span>
          <span class="loading-dot"></span>
        </div>
        <span class="loading-text">Claude is thinking...</span>
      </div>
    {/if}
  </div>

  <div class="input-area">
    <textarea
      bind:value={prompt}
      on:keydown={handleKeydown}
      placeholder="Enter your prompt... (Enter to send, Shift+Enter for newline)"
      disabled={isQuerying}
      rows="3"
    ></textarea>
    <div class="button-group">
      {#if isQuerying}
        <button on:click={stopQuery} class="stop-button">
          <svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          Stop
        </button>
      {:else}
        <button on:click={sendPrompt} disabled={!prompt.trim()}>
          Send
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .sdk-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0f0f0f;
    color: #e0e0e0;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

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

  .prompt-header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 0.5rem 1rem;
    background: #1e293b;
    border-bottom: 1px solid #334155;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .prompt-label {
    color: #64748b;
    font-weight: 500;
    flex-shrink: 0;
  }

  .prompt-text {
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-message {
    padding: 0.75rem 1rem;
    background: #1e293b;
    border-radius: 8px;
    border-left: 3px solid #3b82f6;
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
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .tool-call,
  .tool-result {
    background: #1a1a2e;
    padding: 0.75rem;
    border-radius: 6px;
    border-left: 3px solid #6366f1;
  }

  .tool-result {
    border-left-color: #22c55e;
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

  .message-loading {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    color: #888;
  }

  .loading-indicator {
    display: flex;
    gap: 4px;
  }

  .loading-dot {
    width: 6px;
    height: 6px;
    background: #6366f1;
    border-radius: 50%;
    animation: bounce 1.4s ease-in-out infinite;
  }

  .loading-dot:nth-child(1) {
    animation-delay: 0s;
  }
  .loading-dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .loading-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes bounce {
    0%,
    80%,
    100% {
      transform: translateY(0);
    }
    40% {
      transform: translateY(-6px);
    }
  }

  .loading-text {
    font-size: 0.85rem;
  }

  .input-area {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    border-top: 1px solid #2a2a2a;
    background: #0a0a0a;
  }

  textarea {
    flex: 1;
    background: #1a1a1a;
    color: #e0e0e0;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 0.75rem;
    resize: none;
    font-family: inherit;
    font-size: 0.9rem;
    line-height: 1.4;
  }

  textarea:focus {
    outline: none;
    border-color: #6366f1;
  }

  textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  textarea::placeholder {
    color: #666;
  }

  .button-group {
    display: flex;
    align-items: flex-end;
  }

  button {
    background: #6366f1;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0.75rem 1.5rem;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s;
    min-width: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  button:hover:not(:disabled) {
    background: #5558e3;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .stop-button {
    background: #ef4444;
  }

  .stop-button:hover {
    background: #dc2626;
  }

  .stop-icon {
    width: 16px;
    height: 16px;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid transparent;
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
