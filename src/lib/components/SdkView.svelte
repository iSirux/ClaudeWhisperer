<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { sdkSessions, type SdkMessage, type SdkSession, type SdkImageContent } from '$lib/stores/sdkSessions';
  import { recording, isRecording } from '$lib/stores/recording';
  import { settings } from '$lib/stores/settings';
  import SdkUsageBar from './sdk/SdkUsageBar.svelte';
  import SdkMessageComponent from './sdk/SdkMessage.svelte';
  import SdkLoadingIndicator from './sdk/SdkLoadingIndicator.svelte';
  import SdkPromptInput from './sdk/SdkPromptInput.svelte';

  let { sessionId }: { sessionId: string } = $props();

  let copiedMessageId = $state<number | null>(null);
  let messagesEl: HTMLDivElement;
  let session = $state<SdkSession | null>(null);
  let unsubscribe: (() => void) | undefined;

  let messages = $derived(session?.messages ?? []);
  let status = $derived(session?.status ?? 'idle');
  let isQuerying = $derived(status === 'querying');
  let usage = $derived(session?.usage);
  let hasUsageData = $derived(!!usage && (
    usage.totalInputTokens > 0 ||
    usage.totalOutputTokens > 0 ||
    usage.progressiveInputTokens > 0 ||
    usage.progressiveOutputTokens > 0
  ));

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

  // Smart status based on recent messages
  function getSmartStatus(): { status: string; detail?: string } {
    const msgs = messages;

    if (status === 'error') {
      return { status: 'error' };
    }

    if (status === 'querying') {
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
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sdk-view" onclick={markAsReadOnInteraction}>
  {#if hasUsageData && usage}
    <SdkUsageBar {usage} {isQuerying} />
  {/if}

  {#if firstPrompt()}
    <div class="prompt-preview">{firstPrompt()}</div>
  {/if}

  <div class="messages" bind:this={messagesEl} onscroll={() => { checkIfNearBottom(); markAsReadOnInteraction(); }}>
    {#each messages as msg (msg.timestamp)}
      <SdkMessageComponent message={msg} {copiedMessageId} onCopy={copyMessage} />
    {/each}

    {#if isQuerying}
      <SdkLoadingIndicator {statusMessage} />
    {/if}
  </div>

  <SdkPromptInput
    {isQuerying}
    isRecording={$isRecording}
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
    background: #0f0f0f;
    color: #e0e0e0;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .prompt-preview {
    padding: 0.5rem 1rem;
    background: #1a1a1a;
    border-bottom: 1px solid #2a2a2a;
    font-size: 0.8rem;
    color: #888;
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
