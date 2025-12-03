<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { recording, isRecording, isProcessing, type RecordingState } from '$lib/stores/recording';
  import { settings, activeRepo } from '$lib/stores/settings';
  import { activeSessions, doneSessions, errorSessions } from '$lib/stores/sessionStats';
  import { overlay } from '$lib/stores/overlay';
  import StatusBadge from './StatusBadge.svelte';
  import Waveform from './Waveform.svelte';
  import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';

  // Track remote recording state (from main window events)
  let remoteRecordingState: RecordingState = 'idle';
  let unlistenRecordingState: UnlistenFn | null = null;

  $: showTranscript = $settings.overlay.show_transcript;
  $: transcriptLines = $settings.overlay.transcript_lines;
  $: showSettings = $settings.overlay.show_settings;
  $: showTerminals = $settings.overlay.show_terminals;

  $: truncatedTranscript = $recording.transcript
    .split('\n')
    .slice(-transcriptLines)
    .join('\n');

  // Use remote state if available, otherwise local state
  $: isRecordingActive = remoteRecordingState === 'recording' || $isRecording;
  $: isProcessingActive = remoteRecordingState === 'processing' || $isProcessing;

  // Format model name for display
  const modelLabels: Record<string, string> = {
    'claude-opus-4-5': 'Opus',
    'claude-sonnet-4-5-20250929': 'Sonnet',
    'claude-haiku-4-5': 'Haiku',
  };

  function getModelLabel(model: string | null): string {
    if (!model) return '';
    return modelLabels[model] || model;
  }

  onMount(async () => {
    // Listen for recording state changes from main window
    unlistenRecordingState = await listen<{ state: RecordingState }>('recording-state', (event) => {
      remoteRecordingState = event.payload.state;
    });
  });

  onDestroy(() => {
    if (unlistenRecordingState) {
      unlistenRecordingState();
    }
  });

  function handleClick() {
    if (isRecordingActive) {
      recording.stopRecording();
    }
  }

  function handleDiscard(event: MouseEvent) {
    event.stopPropagation();
    // Emit event to cancel recording in main window
    emit('discard-recording');
    // Also cancel locally in case this is the main window
    recording.cancelRecording();
    overlay.hide();
    overlay.clearSessionInfo();
  }
</script>

<div
  class="overlay-window p-3 h-full"
  class:clickable={isRecordingActive}
  onclick={handleClick}
  role={isRecordingActive ? 'button' : undefined}
  tabindex={isRecordingActive ? 0 : undefined}
>
  <!-- Waveform visualization when recording -->
  {#if isRecordingActive}
    <div class="mb-3">
      <Waveform height={40} barWidth={2} barGap={1} color="#ef4444" useEvents={true} />
    </div>
  {/if}

  <div class="flex items-center justify-between gap-4">
    <div class="flex items-center gap-2">
      {#if isRecordingActive}
        <div class="w-3 h-3 bg-recording rounded-full animate-pulse-recording"></div>
        {#if $overlay.mode === 'paste'}
          <span class="text-sm font-medium text-recording">Recording to Paste</span>
          <span class="text-xs text-text-muted px-1.5 py-0.5 bg-surface rounded">
            Transcription
          </span>
        {:else}
          <span class="text-sm font-medium text-recording">Recording</span>
          {#if $overlay.sessionInfo.model}
            <span class="text-xs text-text-muted px-1.5 py-0.5 bg-surface rounded">
              {getModelLabel($overlay.sessionInfo.model)}
            </span>
          {/if}
        {/if}
      {:else if isProcessingActive}
        <div class="w-3 h-3 bg-warning rounded-full animate-pulse"></div>
        {#if $overlay.mode === 'paste'}
          <span class="text-sm font-medium text-warning">Transcribing...</span>
        {:else}
          <span class="text-sm font-medium text-warning">Processing</span>
        {/if}
      {:else if $overlay.sessionInfo.creatingSession}
        <div class="w-3 h-3 bg-primary rounded-full animate-pulse"></div>
        <span class="text-sm font-medium text-primary">Opening SDK session...</span>
      {:else}
        <div class="w-3 h-3 bg-text-muted rounded-full"></div>
        <span class="text-sm text-text-secondary">Ready</span>
      {/if}
    </div>

    <div class="flex items-center gap-3">
      {#if isRecordingActive}
        <button
          class="discard-btn px-2 py-1 text-xs font-medium bg-error/20 hover:bg-error/30 text-error border border-error/30 rounded transition-colors"
          onclick={handleDiscard}
          title="Discard recording"
        >
          Discard
        </button>
      {/if}

      {#if $activeRepo && showSettings && $overlay.mode !== 'paste'}
        <div class="flex items-center gap-2 text-xs">
          <span class="text-text-secondary truncate max-w-32">{$activeRepo.name}</span>
          <StatusBadge
            createBranch={$settings.git.create_branch}
            autoMerge={$settings.git.auto_merge}
          />
        </div>
      {/if}

      {#if showTerminals && $overlay.mode !== 'paste'}
        <div class="flex items-center gap-2 text-xs">
          {#if $activeSessions > 0}
            <div class="flex items-center gap-1 text-emerald-400">
              <span class="w-2 h-2 bg-emerald-400 rounded-full"></span>
              <span>{$activeSessions}</span>
            </div>
          {/if}
          {#if $doneSessions > 0}
            <div class="flex items-center gap-1 text-blue-400">
              <span class="w-2 h-2 bg-blue-400 rounded-full"></span>
              <span>{$doneSessions}</span>
            </div>
          {/if}
          {#if $errorSessions > 0}
            <div class="flex items-center gap-1 text-red-400">
              <span class="w-2 h-2 bg-red-400 rounded-full"></span>
              <span>{$errorSessions}</span>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Show SDK session info when available (only show branch here, model is shown inline when recording) -->
  {#if $overlay.sessionInfo.branch && !isRecordingActive}
    <div class="mt-2 p-2 bg-surface rounded text-xs text-text-secondary">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1">
          <span class="text-text-muted">Branch:</span>
          <span class="font-mono text-primary">{$overlay.sessionInfo.branch}</span>
        </div>
        {#if $overlay.sessionInfo.model}
          <div class="flex items-center gap-1">
            <span class="text-text-muted">Model:</span>
            <span class="font-medium text-text-primary">{getModelLabel($overlay.sessionInfo.model)}</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if showTranscript && $recording.transcript}
    <div class="mt-2 p-2 bg-surface rounded text-sm text-text-secondary font-mono overflow-hidden">
      <p class="line-clamp-3 whitespace-pre-wrap">{truncatedTranscript}</p>
    </div>
  {/if}

  {#if $recording.error}
    <div class="mt-2 p-2 bg-error/20 border border-error/50 rounded text-sm text-error">
      {$recording.error}
    </div>
  {/if}
</div>

<style>
  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .clickable {
    cursor: pointer;
    user-select: none;
  }

  .clickable:hover {
    opacity: 0.9;
  }

  .clickable:active {
    opacity: 0.8;
  }
</style>
