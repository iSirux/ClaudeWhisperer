<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { recording, isRecording, isProcessing, type RecordingState } from '$lib/stores/recording';
  import { settings, activeRepo } from '$lib/stores/settings';
  import { overlay } from '$lib/stores/overlay';
  import StatusBadge from './StatusBadge.svelte';
  import Waveform from './Waveform.svelte';
  import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
  import { getShortModelName, getModelBadgeBgColor, getModelTextColor } from '$lib/utils/modelColors';
  import type { OverlayMode } from '$lib/stores/overlay';

  // Track remote recording state (from main window events)
  let remoteRecordingState: RecordingState = 'idle';
  let unlistenRecordingState: UnlistenFn | null = null;
  let unlistenSessionInfo: UnlistenFn | null = null;
  let unlistenMode: UnlistenFn | null = null;

  $: showHotkeyHints = $settings.overlay.show_hotkey_hints ?? true;

  // Parse hotkey string into display-friendly key labels
  function parseHotkey(hotkey: string): string[] {
    return hotkey.split('+').map(key => {
      const k = key.trim();
      switch (k) {
        case 'CommandOrControl': return navigator.platform.includes('Mac') ? '⌘' : 'Ctrl';
        case 'Control': return 'Ctrl';
        case 'Command': return '⌘';
        case 'Shift': return 'Shift';
        case 'Alt': return navigator.platform.includes('Mac') ? '⌥' : 'Alt';
        case 'Space': return 'Space';
        default: return k;
      }
    });
  }

  $: sendHotkeyKeys = parseHotkey($settings.hotkeys.toggle_recording);
  $: transcribeHotkeyKeys = parseHotkey($settings.hotkeys.transcribe_to_input);

  // Use remote state if available, otherwise local state
  $: isRecordingActive = remoteRecordingState === 'recording' || $isRecording;
  $: isProcessingActive = remoteRecordingState === 'processing' || $isProcessing;

  function getModelLabel(model: string | null): string {
    if (!model) return '';
    return getShortModelName(model);
  }

  // Dispatch resize event to notify parent page
  function notifyResize() {
    console.log('[Overlay] notifyResize dispatching event');
    window.dispatchEvent(new CustomEvent('overlay-content-changed'));
  }

  onMount(async () => {
    console.log('[Overlay] onMount - setting up listeners');

    // Listen for recording state changes from main window
    unlistenRecordingState = await listen<{ state: RecordingState }>('recording-state', (event) => {
      console.log('[Overlay] recording-state event received:', event.payload.state);
      remoteRecordingState = event.payload.state;
      // Notify parent to resize after state change renders
      setTimeout(notifyResize, 10);
      setTimeout(notifyResize, 50);
      setTimeout(notifyResize, 150);
    });

    // Listen for session info changes from main window (for model display)
    unlistenSessionInfo = await listen<{ branch: string | null; model: string | null; creatingSession: boolean }>('overlay-session-info', (event) => {
      overlay.updateSessionInfoLocal(event.payload.branch, event.payload.model, event.payload.creatingSession);
      setTimeout(notifyResize, 10);
    });

    // Listen for mode changes from main window
    unlistenMode = await listen<{ mode: OverlayMode }>('overlay-mode', (event) => {
      overlay.updateModeLocal(event.payload.mode);
      setTimeout(notifyResize, 10);
    });
  });

  onDestroy(() => {
    if (unlistenRecordingState) {
      unlistenRecordingState();
    }
    if (unlistenSessionInfo) {
      unlistenSessionInfo();
    }
    if (unlistenMode) {
      unlistenMode();
    }
  });

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
  class="overlay-window px-3 pt-3 pb-2"
>
  <!-- Waveform visualization when recording -->
  {#if isRecordingActive}
    <div class="mb-2">
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
            <span class="text-xs px-1.5 py-0.5 rounded {getModelBadgeBgColor($overlay.sessionInfo.model)} {getModelTextColor($overlay.sessionInfo.model)}">
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
      {#if $activeRepo && $overlay.mode !== 'paste'}
        <div class="flex items-center gap-2 text-xs">
          <span class="text-text-secondary truncate max-w-32">{$activeRepo.name}</span>
          <StatusBadge
            createBranch={$settings.git.create_branch}
            autoMerge={$settings.git.auto_merge}
          />
        </div>
      {/if}

      {#if isRecordingActive}
        <button
          class="discard-btn px-2 py-1 text-xs font-medium bg-error/20 hover:bg-error/30 text-error border border-error/30 rounded transition-colors"
          onclick={handleDiscard}
          title="Discard recording"
        >
          Discard
        </button>
      {/if}
    </div>
  </div>

  <!-- Show SDK session info when available (only show branch here, model is shown inline when recording) -->
  {#if $overlay.sessionInfo.branch && !isRecordingActive && $overlay.mode !== 'paste'}
    <div class="mt-2 p-2 bg-surface rounded text-xs text-text-secondary">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1">
          <span class="text-text-muted">Branch:</span>
          <span class="font-mono text-primary">{$overlay.sessionInfo.branch}</span>
        </div>
        {#if $overlay.sessionInfo.model}
          <div class="flex items-center gap-1">
            <span class="text-text-muted">Model:</span>
            <span class="font-medium px-1.5 py-0.5 rounded {getModelBadgeBgColor($overlay.sessionInfo.model)} {getModelTextColor($overlay.sessionInfo.model)}">{getModelLabel($overlay.sessionInfo.model)}</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if $recording.error}
    <div class="mt-2 p-2 bg-error/20 border border-error/50 rounded text-sm text-error">
      {$recording.error}
    </div>
  {/if}

  <!-- Hotkey hints at bottom -->
  {#if isRecordingActive && showHotkeyHints}
    <div class="hotkey-hints mt-3 pt-2 border-t border-border/50 flex gap-4 justify-center">
      <div class="hotkey-hint flex items-center gap-2">
        <div class="keys flex items-center gap-0.5">
          {#each sendHotkeyKeys as key}
            <kbd class="key">{key}</kbd>
          {/each}
        </div>
        <span class="action text-xs text-text-secondary">Claude</span>
      </div>
      <div class="hotkey-hint flex items-center gap-2">
        <div class="keys flex items-center gap-0.5">
          {#each transcribeHotkeyKeys as key}
            <kbd class="key">{key}</kbd>
          {/each}
        </div>
        <span class="action text-xs text-text-secondary">Transcribe</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .overlay-window {
    width: 380px;
    display: inline-block;
    background: var(--color-surface);
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .line-clamp-3 {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Keyboard key styling */
  .key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.5rem;
    padding: 0.125rem 0.375rem;
    font-size: 0.65rem;
    font-weight: 500;
    font-family: system-ui, -apple-system, sans-serif;
    color: var(--color-text-primary);
    background: linear-gradient(180deg, var(--color-surface-elevated) 0%, var(--color-surface) 100%);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  .hotkey-hint {
    opacity: 0.9;
  }

  .hotkey-hint .action {
    opacity: 0.8;
  }
</style>
