<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { sdkSessions, type SdkMessage, type SdkSession } from '$lib/stores/sdkSessions';
  import { recording, isRecording, isProcessing } from '$lib/stores/recording';
  import { settings } from '$lib/stores/settings';
  import { renderMarkdown } from '$lib/utils/markdown';
  import { formatTokens, formatCost } from '$lib/stores/usageStats';

  let { sessionId }: { sessionId: string } = $props();

  // Copy button state
  let copiedMessageId = $state<number | null>(null);
  let copiedAll = $state(false);

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

  // Auto-scroll on new messages, but only if user is near the bottom
  let prevMessageCount = $state(0);
  let userIsNearBottom = $state(true);

  function checkIfNearBottom() {
    if (!messagesEl) return;
    const threshold = 100; // pixels from bottom
    const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    userIsNearBottom = distanceFromBottom < threshold;
  }

  $effect(() => {
    const currentCount = messages.length;
    const hasNewMessages = currentCount > prevMessageCount;

    if (hasNewMessages && userIsNearBottom && messagesEl) {
      tick().then(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }

    prevMessageCount = currentCount;
  });

  async function sendPrompt() {
    if (!prompt.trim()) return;
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

  // Get smart status based on the last messages
  function getSmartStatus(): { status: string; detail?: string } {
    const msgs = messages;

    if (status === 'error') {
      return { status: 'error' };
    }

    if (status === 'querying') {
      // Find the last tool_start that doesn't have a matching tool_result after it
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        if (msg.type === 'tool_start') {
          // Count consecutive calls to this same tool
          let count = 1;
          const currentTool = msg.tool;

          // Look backwards through completed tool pairs
          for (let j = i - 1; j >= 0; j--) {
            const prevMsg = msgs[j];
            if (prevMsg.type === 'tool_start') {
              if (prevMsg.tool === currentTool) {
                count++;
              } else {
                break;
              }
            }
          }

          const detail = count > 1 ? `${msg.tool} (x${count})` : msg.tool;
          return { status: 'tool', detail };
        }
        if (msg.type === 'tool_result') {
          // Tool finished, Claude is thinking
          return { status: 'thinking' };
        }
        if (msg.type === 'text') {
          return { status: 'responding' };
        }
      }
      return { status: 'thinking' };
    }

    return { status: 'idle' };
  }

  function getStatusMessage(smartStatus: { status: string; detail?: string }): string {
    switch (smartStatus.status) {
      case 'tool':
        return `Running ${smartStatus.detail}...`;
      case 'thinking':
        return 'Thinking...';
      case 'responding':
        return 'Responding...';
      default:
        return 'Working...';
    }
  }

  let smartStatus = $derived(getSmartStatus());
  let statusMessage = $derived(getStatusMessage(smartStatus));

  function formatSessionTime(timestamp: number | undefined): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  let sessionStartTime = $derived(formatSessionTime(session?.createdAt));
  let usage = $derived(session?.usage);
  let hasUsageData = $derived(!!usage && (usage.totalInputTokens > 0 || usage.totalOutputTokens > 0));

  let textareaEl: HTMLTextAreaElement;

  function autoResize() {
    if (textareaEl) {
      textareaEl.style.height = 'auto';
      const maxHeight = 200;
      const newHeight = Math.min(textareaEl.scrollHeight, maxHeight);
      textareaEl.style.height = newHeight + 'px';
      textareaEl.style.overflowY = textareaEl.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }
  }

  $effect(() => {
    // Auto-resize when prompt changes
    prompt;
    autoResize();
  });

  // Copy functions
  function getMessageText(msg: SdkMessage): string {
    switch (msg.type) {
      case 'user':
        return msg.content ?? '';
      case 'text':
        return msg.content ?? '';
      case 'error':
        return `Error: ${msg.content ?? ''}`;
      case 'tool_start':
        return `[Tool: ${msg.tool}]\nInput: ${formatInput(msg.input)}`;
      case 'tool_result':
        return `[Tool: ${msg.tool} completed]\nOutput: ${msg.output ?? ''}`;
      default:
        return '';
    }
  }

  function formatChatForCopy(): string {
    return messages
      .filter(msg => msg.type !== 'done')
      .map(msg => {
        const prefix = msg.type === 'user' ? 'User: ' : msg.type === 'text' ? 'Claude: ' : '';
        return prefix + getMessageText(msg);
      })
      .join('\n\n');
  }

  async function copyMessage(msg: SdkMessage) {
    const text = msg.type === 'user' ? msg.content ?? '' : getMessageText(msg);
    await navigator.clipboard.writeText(text);
    copiedMessageId = msg.timestamp;
    setTimeout(() => {
      copiedMessageId = null;
    }, 2000);
  }

  async function copyAllMessages() {
    const text = formatChatForCopy();
    await navigator.clipboard.writeText(text);
    copiedAll = true;
    setTimeout(() => {
      copiedAll = false;
    }, 2000);
  }

  // Recording for current session (not creating new session)
  let isRecordingForCurrentSession = $state(false);

  async function startRecordingForSession() {
    if ($isRecording) return;
    isRecordingForCurrentSession = true;
    await recording.startRecording($settings.audio.device_id || undefined);
  }

  async function stopRecordingForSession() {
    if (!$isRecording) return;
    const transcript = await recording.stopRecording(true);
    if (transcript && isRecordingForCurrentSession) {
      await sdkSessions.sendPrompt(sessionId, transcript);
      recording.clearTranscript();
    }
    isRecordingForCurrentSession = false;
  }
</script>

<div class="sdk-view">
  <div class="session-header">
    <div class="header-top">
      {#if sessionStartTime}
        <span class="session-time">{sessionStartTime}</span>
      {/if}
      {#if truncatedPrompt}
        <span class="prompt-label">Prompt:</span>
        <span class="prompt-text">{truncatedPrompt}</span>
      {/if}
      <button
        class="copy-all-button"
        class:copied={copiedAll}
        onclick={copyAllMessages}
        title="Copy entire chat"
        disabled={messages.length === 0}
      >
        {#if copiedAll}
          <svg class="copy-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          Copied!
        {:else}
          <svg class="copy-icon" viewBox="0 0 20 20" fill="currentColor">
            <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
            <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
          </svg>
          Copy All
        {/if}
      </button>
    </div>
    {#if hasUsageData && usage}
      <div class="usage-bar">
        <div class="usage-stats">
          <span class="usage-stat" title="Input tokens">
            <svg class="usage-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 8a.5.5 0 0 1 .5-.5h5.793L8.146 5.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 8.5H4.5A.5.5 0 0 1 4 8z"/>
            </svg>
            {formatTokens(usage.totalInputTokens)}
          </span>
          <span class="usage-stat" title="Output tokens">
            <svg class="usage-icon" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12 8a.5.5 0 0 1-.5.5H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5H11.5a.5.5 0 0 1 .5.5z"/>
            </svg>
            {formatTokens(usage.totalOutputTokens)}
          </span>
          {#if usage.totalCacheReadTokens > 0}
            <span class="usage-stat cache" title="Cache read tokens (reduced cost)">
              <svg class="usage-icon" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
              </svg>
              {formatTokens(usage.totalCacheReadTokens)}
            </span>
          {/if}
          <span class="usage-stat cost" title="Total cost">
            {formatCost(usage.totalCostUsd)}
          </span>
        </div>
        <div class="context-bar-container" title="Context usage: {usage.contextUsagePercent.toFixed(1)}% of {formatTokens(usage.contextWindow)}">
          <div class="context-bar-bg">
            <div
              class="context-bar-fill"
              class:warning={usage.contextUsagePercent > 70}
              class:danger={usage.contextUsagePercent > 90}
              style="width: {Math.min(100, usage.contextUsagePercent)}%"
            ></div>
          </div>
          <span class="context-percent">{usage.contextUsagePercent.toFixed(0)}%</span>
        </div>
      </div>
    {/if}
  </div>
  <div class="messages" bind:this={messagesEl} onscroll={checkIfNearBottom}>
    {#each messages as msg (msg.timestamp)}
      <div class="message message-{msg.type}">
        {#if msg.type === 'user'}
          <div class="user-message">
            <pre class="user-content">{msg.content}</pre>
            <button
              class="copy-message-button"
              class:copied={copiedMessageId === msg.timestamp}
              onclick={() => copyMessage(msg)}
              title="Copy message"
            >
              {#if copiedMessageId === msg.timestamp}
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
        {:else if msg.type === 'text'}
          <div class="text-message-container">
            <div class="text-content markdown-body">{@html renderMarkdown(msg.content ?? '')}</div>
            <button
              class="copy-message-button"
              class:copied={copiedMessageId === msg.timestamp}
              onclick={() => copyMessage(msg)}
              title="Copy message"
            >
              {#if copiedMessageId === msg.timestamp}
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
        <span class="loading-text">{statusMessage}</span>
      </div>
    {/if}
  </div>

  <div class="input-area">
    <textarea
      bind:this={textareaEl}
      bind:value={prompt}
      oninput={autoResize}
      onkeydown={handleKeydown}
      placeholder="Enter your prompt... (Enter to send, Shift+Enter for newline)"
      rows="1"
    ></textarea>
    <div class="button-group">
      {#if isQuerying}
        <button onclick={stopQuery} class="stop-button" title="Stop current query">
          <svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      {/if}
      <!-- Record button for current session -->
      {#if $isRecording && isRecordingForCurrentSession}
        <button
          class="record-button recording"
          onclick={stopRecordingForSession}
          title="Stop recording and send"
        >
          <div class="recording-pulse"></div>
          <svg class="mic-icon" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
          </svg>
        </button>
      {:else if !$isRecording}
        <button
          class="record-button"
          onclick={startRecordingForSession}
          title="Record voice prompt"
        >
          <svg class="mic-icon" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
          </svg>
        </button>
      {/if}
      <button onclick={sendPrompt} disabled={!prompt.trim()} title={isQuerying ? "Send and interrupt" : "Send"}>
        Send
      </button>
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
    user-select: text;
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

  .session-header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 0.5rem 1rem;
    background: #1e293b;
    border-bottom: 1px solid #334155;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .header-top {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .usage-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-top: 0.25rem;
    border-top: 1px solid #334155;
    margin-top: 0.25rem;
  }

  .usage-stats {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .usage-stat {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: #94a3b8;
    font-size: 0.75rem;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .usage-stat.cache {
    color: #22c55e;
  }

  .usage-stat.cost {
    color: #f59e0b;
    font-weight: 600;
  }

  .usage-icon {
    width: 12px;
    height: 12px;
    opacity: 0.7;
  }

  .context-bar-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .context-bar-bg {
    flex: 1;
    height: 6px;
    background: #334155;
    border-radius: 3px;
    overflow: hidden;
  }

  .context-bar-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 3px;
    transition: width 0.3s ease, background 0.3s ease;
  }

  .context-bar-fill.warning {
    background: #f59e0b;
  }

  .context-bar-fill.danger {
    background: #ef4444;
  }

  .context-percent {
    font-size: 0.7rem;
    color: #64748b;
    font-weight: 500;
    min-width: 32px;
    text-align: right;
  }

  .session-time {
    color: #94a3b8;
    font-weight: 500;
    flex-shrink: 0;
    padding-right: 0.5rem;
    border-right: 1px solid #475569;
    margin-right: 0.25rem;
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
    user-select: text;
    flex: 1;
  }

  .copy-all-button {
    margin-left: auto;
    background: #374151;
    color: #9ca3af;
    border: none;
    border-radius: 4px;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
    min-width: unset;
  }

  .copy-all-button:hover:not(:disabled) {
    background: #4b5563;
    color: #e5e7eb;
  }

  .copy-all-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .copy-all-button.copied {
    background: #065f46;
    color: #10b981;
  }

  .copy-all-button .copy-icon {
    width: 14px;
    height: 14px;
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
    top: 0.5rem;
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
    align-items: flex-end;
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
    min-height: unset;
    max-height: 200px;
    overflow-y: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  textarea::-webkit-scrollbar {
    display: none;
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
    align-items: center;
    gap: 0.5rem;
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
    padding: 0.75rem;
    min-width: unset;
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

  .record-button {
    background: #374151;
    color: #9ca3af;
    border: none;
    border-radius: 6px;
    padding: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    min-width: unset;
  }

  .record-button:hover {
    background: #4b5563;
    color: #e5e7eb;
  }

  .record-button.recording {
    background: #ef4444;
    color: #fff;
  }

  .record-button.recording:hover {
    background: #dc2626;
  }

  .mic-icon {
    width: 18px;
    height: 18px;
    position: relative;
    z-index: 1;
  }

  .recording-pulse {
    position: absolute;
    inset: 0;
    background: #ef4444;
    border-radius: 6px;
    animation: pulse-recording 1.5s ease-in-out infinite;
  }

  @keyframes pulse-recording {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.05);
    }
  }
</style>
