<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { sdkSessions, type SdkMessage, type SdkSession, type SdkImageContent, type ThinkingLevel } from '$lib/stores/sdkSessions';
  import { recording, isRecording, isProcessing } from '$lib/stores/recording';
  import { settings, isAutoRepoSelected } from '$lib/stores/settings';
  import { overlay } from '$lib/stores/overlay';
  import { invoke } from '@tauri-apps/api/core';
  import SdkUsageBar from './sdk/SdkUsageBar.svelte';
  import SdkMessageComponent from './sdk/SdkMessage.svelte';
  import SdkLoadingIndicator from './sdk/SdkLoadingIndicator.svelte';
  import SdkPromptInput from './sdk/SdkPromptInput.svelte';
  import SessionRecordingHeader from './sdk/SessionRecordingHeader.svelte';
  import SdkQuickActions from './sdk/SdkQuickActions.svelte';
  import ModelSelector from './ModelSelector.svelte';
  import ThinkingSelector from './ThinkingSelector.svelte';
  import RepoSelector from './RepoSelector.svelte';
  import { recommendModel, recommendRepo, isModelRecommendationEnabled, isRepoAutoSelectEnabled, needsUserConfirmation } from '$lib/utils/llm';

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
  let showQuickActions = $derived(
    status === 'idle' &&
    messages.length > 0 &&
    !isPendingRepo &&
    !isPendingTranscription &&
    !isPendingApproval
  );
  let isNewChat = $derived(messages.length === 0 && status === 'idle');
  let autoModelRequested = $derived(session?.autoModelRequested ?? false);
  let sessionThinkingLevel = $derived(session?.thinkingLevel ?? null);
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

  // Reference to prompt input for focus
  let promptInputRef: { focus: () => void } | undefined;

  // Expose focus function for external use
  export function focusPromptInput() {
    promptInputRef?.focus();
  }

  // Repo and branch info
  let cwd = $derived(session?.cwd ?? '');
  // Return empty for auto mode (no cwd or cwd is '.')
  let repoName = $derived(!cwd || cwd === '.' ? '' : cwd.split(/[/\\]/).pop() || cwd);
  let sessionModel = $derived(session?.model ?? '');
  let branch = $state<string | null>(null);

  // Fetch git branch when session changes (skip for auto mode)
  $effect(() => {
    if (cwd && cwd !== '.') {
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
    const isFirstPrompt = messages.filter(m => m.type === 'user').length === 0;

    if (isFirstPrompt) {
      // Track recommendations to store for display
      let storedRepoRecommendation: {
        repoIndex: number;
        repoName: string;
        reasoning: string;
        confidence: string;
      } | undefined;
      let storedModelRecommendation: {
        modelId: string;
        reasoning: string;
        thinkingLevel?: string;
      } | undefined;

      // Handle auto repo selection for sessions with no cwd
      if ($isAutoRepoSelected && isRepoAutoSelectEnabled() && $settings.repos.length > 1 && (!cwd || cwd === '' || cwd === '.')) {
        try {
          // Call LLM to recommend a repo based on the prompt
          const repoRecommendation = await recommendRepo(prompt, false); // false = not transcribed

          if (!repoRecommendation || needsUserConfirmation(repoRecommendation.confidence)) {
            // Need user to select - transition to pending_repo state
            // This will show the repo selection UI
            sdkSessions.createPendingRepoFromExisting(
              sessionId,
              prompt,
              {
                transcript: prompt,
                recommendedIndex: repoRecommendation?.repoIndex ?? null,
                reasoning: repoRecommendation?.reasoning ?? 'Please select a repository for this task',
                confidence: repoRecommendation?.confidence ?? 'low',
              }
            );
            return; // Don't send yet - wait for repo selection
          }

          // High confidence - update cwd and continue
          const selectedRepo = $settings.repos[repoRecommendation.repoIndex];
          if (selectedRepo) {
            console.log('[SdkView] Auto selected repo:', selectedRepo.name, '-', repoRecommendation.reasoning);
            // Update session cwd and reinitialize backend with new cwd
            await sdkSessions.updateSessionCwd(sessionId, selectedRepo.path);
            // Store for display
            storedRepoRecommendation = {
              repoIndex: repoRecommendation.repoIndex,
              repoName: selectedRepo.name,
              reasoning: repoRecommendation.reasoning,
              confidence: repoRecommendation.confidence,
            };
          }
        } catch (error) {
          console.error('[SdkView] Repo recommendation failed:', error);
          // On error, transition to pending_repo for manual selection
          sdkSessions.createPendingRepoFromExisting(
            sessionId,
            prompt,
            {
              transcript: prompt,
              recommendedIndex: null,
              reasoning: 'Failed to get recommendation - please select manually',
              confidence: 'low',
            }
          );
          return;
        }
      }

      // Handle auto model selection (check session's autoModelRequested flag, not current settings)
      if (autoModelRequested && isModelRecommendationEnabled()) {
        try {
          const recommendation = await recommendModel(prompt);
          if (recommendation) {
            // Only use recommendation if the model is enabled
            if ($settings.enabled_models.includes(recommendation.modelId)) {
              await sdkSessions.updateSessionModel(sessionId, recommendation.modelId);
              console.log('[SdkView] Auto selected model:', recommendation.modelId, '-', recommendation.reasoning);
              // Store for display
              storedModelRecommendation = {
                modelId: recommendation.modelId,
                reasoning: recommendation.reasoning,
                thinkingLevel: recommendation.thinkingLevel ?? undefined,
              };
            } else {
              console.log('[SdkView] Recommended model not enabled, keeping current');
            }
            // Apply thinking level recommendation if provided
            if (recommendation.thinkingLevel) {
              await sdkSessions.updateSessionThinking(sessionId, recommendation.thinkingLevel as ThinkingLevel);
              console.log('[SdkView] Using recommended thinking level:', recommendation.thinkingLevel);
            }
          }
        } catch (error) {
          console.error('[SdkView] Model recommendation failed, using current model:', error);
        }
      }

      // Store recommendations for display in SessionRecordingHeader
      if (storedModelRecommendation || storedRepoRecommendation) {
        sdkSessions.setRecommendations(sessionId, {
          transcript: prompt,
          modelRecommendation: storedModelRecommendation,
          repoRecommendation: storedRepoRecommendation,
        });
      }
    }

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

  // Model and thinking change handlers
  function handleModelChange(newModel: string) {
    sdkSessions.updateSessionModel(sessionId, newModel);
  }

  function handleThinkingChange(newLevel: ThinkingLevel) {
    sdkSessions.updateSessionThinking(sessionId, newLevel);
  }

  function handleCwdChange(newCwd: string) {
    sdkSessions.updateSessionCwd(sessionId, newCwd);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sdk-view" onclick={markAsReadOnInteraction}>
  {#if hasUsageData && usage}
    <SdkUsageBar {usage} {isQuerying} />
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
      <SdkMessageComponent message={msg} {copiedMessageId} onCopy={copyMessage} sessionCwd={cwd} {sessionModel} />
    {/each}

    {#if isLoading}
      <SdkLoadingIndicator {statusMessage} />
    {/if}

    {#if showQuickActions}
      <SdkQuickActions onSendPrompt={(prompt) => handleSendPrompt(prompt)} />
    {/if}
  </div>

  {#if isNewChat}
    <div class="new-chat-selectors">
      <RepoSelector
        cwd={cwd}
        onchange={handleCwdChange}
        size="sm"
      />
      <ModelSelector
        model={sessionModel}
        onchange={handleModelChange}
        size="sm"
      />
      <ThinkingSelector
        thinkingLevel={sessionThinkingLevel}
        onchange={handleThinkingChange}
        size="sm"
      />
    </div>
  {/if}

  <SdkPromptInput
    bind:this={promptInputRef}
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

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    user-select: text;
  }

  .new-chat-selectors {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 0.5rem 1rem;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
  }
</style>
