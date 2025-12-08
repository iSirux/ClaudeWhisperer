<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import {
    recording,
    isRecording,
    isProcessing,
    type RecordingState,
  } from "$lib/stores/recording";
  import {
    settings,
    activeRepo,
    isAutoRepoSelected,
  } from "$lib/stores/settings";
  import { isRepoAutoSelectEnabled } from "$lib/utils/llm";
  import { overlay } from "$lib/stores/overlay";
  import StatusBadge from "./StatusBadge.svelte";
  import Waveform from "./Waveform.svelte";
  import TranscriptMarquee from "./TranscriptMarquee.svelte";
  import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
  import {
    getShortModelName,
    getModelBadgeBgColor,
    getModelTextColor,
  } from "$lib/utils/modelColors";
  import type { OverlayMode } from "$lib/stores/overlay";

  // Check if Vosk real-time transcription should be shown
  $: showRealtimeTranscript = $settings.vosk?.enabled ?? false;

  // Track remote recording state (from main window events)
  let remoteRecordingState: RecordingState = "idle";
  let unlistenRecordingState: UnlistenFn | null = null;
  let unlistenSessionInfo: UnlistenFn | null = null;
  let unlistenMode: UnlistenFn | null = null;
  let unlistenInlineSessionInfo: UnlistenFn | null = null;

  // Use remote state if available, otherwise local state
  $: isRecordingActive = remoteRecordingState === "recording" || $isRecording;
  $: isProcessingActive =
    remoteRecordingState === "processing" || $isProcessing;

  function getModelLabel(model: string | null): string {
    if (!model) return "";
    return getShortModelName(model);
  }

  // Dispatch resize event to notify parent page
  function notifyResize() {
    console.log("[Overlay] notifyResize dispatching event");
    window.dispatchEvent(new CustomEvent("overlay-content-changed"));
  }

  onMount(async () => {
    console.log("[Overlay] onMount - setting up listeners");

    // Listen for recording state changes from main window
    unlistenRecordingState = await listen<{ state: RecordingState }>(
      "recording-state",
      (event) => {
        console.log(
          "[Overlay] recording-state event received:",
          event.payload.state
        );
        remoteRecordingState = event.payload.state;
        // Notify parent to resize after state change renders
        setTimeout(notifyResize, 10);
        setTimeout(notifyResize, 50);
        setTimeout(notifyResize, 150);
      }
    );

    // Listen for session info changes from main window (for model display)
    unlistenSessionInfo = await listen<{
      branch: string | null;
      model: string | null;
      creatingSession: boolean;
    }>("overlay-session-info", (event) => {
      overlay.updateSessionInfoLocal(
        event.payload.branch,
        event.payload.model,
        event.payload.creatingSession
      );
      setTimeout(notifyResize, 10);
    });

    // Listen for mode changes from main window
    unlistenMode = await listen<{ mode: OverlayMode }>(
      "overlay-mode",
      (event) => {
        overlay.updateModeLocal(event.payload.mode);
        setTimeout(notifyResize, 10);
      }
    );

    // Listen for inline session info changes from main window
    unlistenInlineSessionInfo = await listen<{
      repoName: string | null;
      branch: string | null;
      model: string | null;
      promptPreview: string | null;
    } | null>("overlay-inline-session-info", (event) => {
      overlay.updateInlineSessionInfoLocal(event.payload);
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
    if (unlistenInlineSessionInfo) {
      unlistenInlineSessionInfo();
    }
  });

  function handleDiscard(event: MouseEvent) {
    event.stopPropagation();
    // Emit event to cancel recording in main window
    emit("discard-recording");
    // Also cancel locally in case this is the main window
    recording.cancelRecording();
    overlay.hide();
    overlay.clearSessionInfo();
  }
</script>

<div class="overlay-window px-3 pt-3 pb-2">
  <!-- Waveform visualization when recording -->
  {#if isRecordingActive}
    <div class="mb-2">
      <Waveform
        height={40}
        barWidth={2}
        barGap={1}
        color="#ef4444"
        useEvents={true}
      />
    </div>

    <!-- Real-time transcript from Vosk -->
    {#if showRealtimeTranscript}
      <div class="mb-2">
        <TranscriptMarquee />
      </div>
    {/if}
  {/if}

  <div class="flex items-center justify-between gap-4">
    <div class="flex items-center gap-2">
      {#if isRecordingActive}
        {#if $overlay.mode === "paste"}
          <span
            class="text-xs text-text-muted px-1.5 py-0.5 bg-surface rounded"
          >
            Transcription
          </span>
        {:else if $overlay.mode === "inline"}
          {#if $overlay.inlineSessionInfo?.model}
            <span
              class="text-xs px-1.5 py-0.5 rounded {getModelBadgeBgColor(
                $overlay.inlineSessionInfo.model
              )} {getModelTextColor($overlay.inlineSessionInfo.model)}"
            >
              {getModelLabel($overlay.inlineSessionInfo.model)}
            </span>
          {/if}
        {:else}
          {#if $overlay.sessionInfo.model}
            <span
              class="text-xs px-1.5 py-0.5 rounded {getModelBadgeBgColor(
                $overlay.sessionInfo.model
              )} {getModelTextColor($overlay.sessionInfo.model)}"
            >
              {getModelLabel($overlay.sessionInfo.model)}
            </span>
          {/if}
        {/if}
      {:else if isProcessingActive}
        <div class="w-3 h-3 bg-warning rounded-full animate-pulse"></div>
        {#if $overlay.mode === "paste"}
          <span class="text-sm font-medium text-warning">Transcribing...</span>
        {:else}
          <span class="text-sm font-medium text-warning">Processing</span>
        {/if}
      {:else if $overlay.sessionInfo.creatingSession}
        <div class="w-3 h-3 bg-primary rounded-full animate-pulse"></div>
        <span class="text-sm font-medium text-primary"
          >Opening SDK session...</span
        >
      {:else}
        <div class="w-3 h-3 bg-text-muted rounded-full"></div>
        <span class="text-sm text-text-secondary">Ready</span>
      {/if}
    </div>

    <div class="flex items-center gap-3">
      {#if $overlay.mode === "inline" && $overlay.inlineSessionInfo}
        <div class="flex items-center gap-2 text-xs">
          {#if $overlay.inlineSessionInfo.repoName}
            <span class="text-text-secondary truncate max-w-32"
              >{$overlay.inlineSessionInfo.repoName}</span
            >
          {/if}
          {#if $overlay.inlineSessionInfo.branch}
            <span class="text-text-muted">·</span>
            <span class="font-mono text-primary truncate max-w-24"
              >{$overlay.inlineSessionInfo.branch}</span
            >
          {/if}
        </div>
      {:else if $overlay.mode !== "paste"}
        <div class="flex items-center gap-2 text-xs">
          {#if $isAutoRepoSelected && isRepoAutoSelectEnabled()}
            <span
              class="px-2 py-0.5 rounded bg-gradient-to-r from-purple-500 to-amber-500 text-white font-medium shadow-sm"
              >Auto</span
            >
          {:else if $activeRepo}
            <span class="text-text-secondary truncate max-w-32"
              >{$activeRepo.name}</span
            >
          {/if}
          {#if $activeRepo && !($isAutoRepoSelected && isRepoAutoSelectEnabled())}
            <StatusBadge
              createBranch={$settings.git.create_branch}
              autoMerge={$settings.git.auto_merge}
            />
          {/if}
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
  {#if $overlay.sessionInfo.branch && !isRecordingActive && $overlay.mode !== "paste" && $overlay.mode !== "inline"}
    <div class="mt-2 p-2 bg-surface rounded text-xs text-text-secondary">
      <div class="flex items-center gap-3">
        <div class="flex items-center gap-1">
          <span class="text-text-muted">Branch:</span>
          <span class="font-mono text-primary"
            >{$overlay.sessionInfo.branch}</span
          >
        </div>
        {#if $overlay.sessionInfo.model}
          <div class="flex items-center gap-1">
            <span class="text-text-muted">Model:</span>
            <span
              class="font-medium px-1.5 py-0.5 rounded {getModelBadgeBgColor(
                $overlay.sessionInfo.model
              )} {getModelTextColor($overlay.sessionInfo.model)}"
              >{getModelLabel($overlay.sessionInfo.model)}</span
            >
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if $recording.error}
    <div
      class="mt-2 p-2 bg-error/20 border border-error/50 rounded text-sm text-error"
    >
      {$recording.error}
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
</style>
