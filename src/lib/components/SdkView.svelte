<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { sdkSessions, type SdkMessage, type SdkSession, type SdkImageContent } from '$lib/stores/sdkSessions';
  import { recording, isRecording, isProcessing } from '$lib/stores/recording';
  import { settings } from '$lib/stores/settings';
  import { overlay } from '$lib/stores/overlay';
  import { invoke } from '@tauri-apps/api/core';
  import SdkUsageBar from './sdk/SdkUsageBar.svelte';
  import SdkMessageComponent from './sdk/SdkMessage.svelte';
  import SdkLoadingIndicator from './sdk/SdkLoadingIndicator.svelte';
  import SdkPromptInput from './sdk/SdkPromptInput.svelte';
  import SessionRecordingHeader from './sdk/SessionRecordingHeader.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let copiedMessageId = $state<number | null>(null);
  let messagesEl: HTMLDivElement;
  let session = $state<SdkSession | null>(null);
  let unsubscribe: (() => void) | undefined;

  let messages = $derived(session?.messages ?? []);
  let status = $derived(session?.status ?? 'idle');
  let isQuerying = $derived(status === 'querying');
  let isPendingRepo = $derived(status === 'pending_repo');
  let isInitializing = $derived(status === 'initializing');
  let isPendingTranscription = $derived(status === 'pending_transcription');
  let isPendingApproval = $derived(status === 'pending_approval');
  let isLoading = $derived(isQuerying || isInitializing);
  let pendingApprovalPrompt = $derived(session?.pendingApprovalPrompt);
  let usage = $derived(session?.usage);
  let hasUsageData = $derived(!!usage && (
    usage.totalInputTokens > 0 ||
    usage.totalOutputTokens > 0 ||
    usage.progressiveInputTokens > 0 ||
    usage.progressiveOutputTokens > 0
  ));
  let pendingRepoSelection = $derived(session?.pendingRepoSelection);
  let pendingTranscription = $derived(session?.pendingTranscription);

  // Show completed recording header when we have recording data but session is no longer pending
  let hasCompletedRecordingData = $derived(
    !isPendingTranscription &&
    pendingTranscription &&
    (pendingTranscription.audioVisualizationHistory?.length ||
     pendingTranscription.transcript ||
     pendingTranscription.modelRecommendation ||
     pendingTranscription.repoRecommendation)
  );

  // Repo and branch info
  let cwd = $derived(session?.cwd ?? '');
  let repoName = $derived(cwd.split(/[/\\]/).pop() || cwd);
  let branch = $state<string | null>(null);

  // Fetch git branch when session changes
  $effect(() => {
    if (cwd) {
      invoke<string>('get_git_branch', { repoPath: cwd })
        .then(b => { branch = b; })
        .catch(() => { branch = null; });
    } else {
      branch = null;
    }
  });

  // Get the first user prompt to display as session identifier
  const PROMPT_PREVIEW_LENGTH = 80;
  let firstPrompt = $derived(() => {
    const firstUserMessage = messages.find(m => m.type === 'user');
    if (!firstUserMessage?.content) return null;
    const content = firstUserMessage.content.trim();
    if (content.length <= PROMPT_PREVIEW_LENGTH) return content;
    return content.slice(0, PROMPT_PREVIEW_LENGTH) + '…';
  });

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
    const threshold = 100;
    const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    userIsNearBottom = distanceFromBottom < threshold;
  }

  // Mark session as read when user interacts with the view
  function markAsReadOnInteraction() {
    if (session?.unread) {
      sdkSessions.markAsRead(sessionId);
    }
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

  // Smart status based on recent messages and session state
  function getSmartStatus(): { status: string; detail?: string } {
    const msgs = messages;

    if (status === 'error') {
      return { status: 'error' };
    }

    if (status === 'pending_transcription') {
      return { status: 'pending_transcription', detail: pendingTranscription?.status };
    }

    if (status === 'pending_repo') {
      return { status: 'pending_repo' };
    }

    if (status === 'pending_approval') {
      return { status: 'pending_approval' };
    }

    if (status === 'initializing') {
      return { status: 'initializing' };
    }

    if (status === 'querying') {
      // Check if we have any response content yet
      const hasAnyResponse = msgs.some(m => m.type === 'text' || m.type === 'tool_start');

      if (!hasAnyResponse) {
        // No response yet - waiting for LLM
        return { status: 'waiting_llm' };
      }

      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i];
        if (msg.type === 'tool_start') {
          let count = 1;
          const currentTool = msg.tool;

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
      case 'waiting_llm':
        return 'Waiting for response...';
      case 'initializing':
        return 'Starting session...';
      default:
        return 'Working...';
    }
  }

  let smartStatus = $derived(getSmartStatus());
  let statusMessage = $derived(getStatusMessage(smartStatus));

  // Copy functionality
  function formatInput(input: Record<string, unknown> | undefined): string {
    if (!input) return '';
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }

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

  async function copyMessage(msg: SdkMessage) {
    const text = msg.type === 'user' ? msg.content ?? '' : getMessageText(msg);
    await navigator.clipboard.writeText(text);
    copiedMessageId = msg.timestamp;
    setTimeout(() => {
      copiedMessageId = null;
    }, 2000);
  }

  // Prompt handling
  async function handleSendPrompt(prompt: string, images?: SdkImageContent[]) {
    await sdkSessions.sendPrompt(sessionId, prompt, images);
  }

  async function handleStopQuery() {
    if (!isQuerying) return;
    await sdkSessions.stopQuery(sessionId);
  }

  // Recording for current session
  let isRecordingForCurrentSession = $state(false);

  async function handleStartRecording() {
    if ($isRecording) return;
    isRecordingForCurrentSession = true;

    // Set overlay mode to inline and show session info
    overlay.setMode('inline');
    overlay.setInlineSessionInfo({
      repoName: repoName,
      branch: branch,
      model: session?.model ?? null,
      promptPreview: firstPrompt() ?? null,
    });
    await overlay.show();

    await recording.startRecording($settings.audio.device_id || undefined);
  }

  async function handleStopRecording() {
    if (!$isRecording) return;
    const transcript = await recording.stopRecording(true);
    if (transcript && isRecordingForCurrentSession) {
      await sdkSessions.sendPrompt(sessionId, transcript);
      recording.clearTranscript();
    }
    isRecordingForCurrentSession = false;

    // Hide overlay and clear inline session info
    overlay.clearInlineSessionInfo();
    overlay.hide();
  }

  // Handlers for pending transcription sessions
  function handleRetryTranscription() {
    // Dispatch event to parent to retry transcription
    window.dispatchEvent(new CustomEvent('retry-transcription', { detail: { sessionId } }));
  }

  function handleCancelPendingTranscription() {
    // Cancel recording if still recording
    if ($isRecording) {
      recording.cancelRecording();
    }
    // Remove the pending session
    sdkSessions.cancelPendingTranscription(sessionId);
  }

  // Handlers for pending approval sessions
  function handleApprove(editedPrompt?: string) {
    // Dispatch event to parent to complete the approval
    // The parent (+page.svelte) will handle building system prompt and calling approveAndSend
    window.dispatchEvent(new CustomEvent('approve-transcription', {
      detail: { sessionId, editedPrompt }
    }));
  }

  function handleCancelApproval() {
    sdkSessions.cancelApproval(sessionId);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sdk-view" onclick={markAsReadOnInteraction}>
  {#if hasUsageData && usage}
    <SdkUsageBar {usage} {isQuerying} />
  {/if}

  <!-- Repo and branch info bar (hide when pending repo selection) -->
  {#if !isPendingRepo}
    <div class="repo-info">
      <div class="repo-info-content">
        <svg class="repo-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span class="repo-name">{repoName}</span>
        {#if branch}
          <span class="separator">·</span>
          <svg class="branch-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span class="branch-name">{branch}</span>
        {/if}
      </div>
    </div>
  {/if}

  {#if firstPrompt()}
    <div class="prompt-preview">{firstPrompt()}</div>
  {/if}

  <div class="messages" bind:this={messagesEl} onscroll={() => { checkIfNearBottom(); markAsReadOnInteraction(); }}>
    <!-- Recording/transcription header for pending sessions -->
    {#if isPendingTranscription && pendingTranscription}
      <SessionRecordingHeader
        {pendingTranscription}
        {sessionId}
        onRetry={handleRetryTranscription}
        onCancel={handleCancelPendingTranscription}
      />
    {/if}

    <!-- Approval UI for pending_approval sessions -->
    {#if isPendingApproval && pendingTranscription && pendingApprovalPrompt}
      <SessionRecordingHeader
        {pendingTranscription}
        {sessionId}
        showApproval={true}
        approvalPrompt={pendingApprovalPrompt}
        {repoName}
        onApprove={handleApprove}
        onCancelApproval={handleCancelApproval}
      />
    {/if}

    <!-- Completed recording context shown at the top of active sessions -->
    {#if hasCompletedRecordingData && pendingTranscription && !isPendingApproval}
      <SessionRecordingHeader
        {pendingTranscription}
        {sessionId}
        completed={true}
      />
    {/if}

    {#each messages as msg (msg.timestamp)}
      <SdkMessageComponent message={msg} {copiedMessageId} onCopy={copyMessage} />
    {/each}

    {#if isLoading}
      <SdkLoadingIndicator {statusMessage} />
    {/if}
  </div>

  <SdkPromptInput
    {isQuerying}
    isRecording={$isRecording}
    isTranscribing={$isProcessing && isRecordingForCurrentSession}
    {isRecordingForCurrentSession}
    onSendPrompt={handleSendPrompt}
    onStopQuery={handleStopQuery}
    onStartRecording={handleStartRecording}
    onStopRecording={handleStopRecording}
  />
</div>

<style>
  .sdk-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-background);
    color: var(--color-text-primary);
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .repo-info {
    padding: 0.5rem 1rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }

  .repo-info-content {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .repo-icon {
    width: 0.875rem;
    height: 0.875rem;
    color: var(--color-text-muted);
    flex-shrink: 0;
  }

  .repo-name {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    font-weight: 500;
  }

  .separator {
    color: var(--color-text-muted);
    font-size: 0.8rem;
  }

  .branch-icon {
    width: 0.75rem;
    height: 0.75rem;
    color: rgb(96, 165, 250);
    flex-shrink: 0;
  }

  .branch-name {
    font-size: 0.8rem;
    color: rgb(96, 165, 250);
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .prompt-preview {
    padding: 0.5rem 1rem;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    font-size: 0.8rem;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
</style>
