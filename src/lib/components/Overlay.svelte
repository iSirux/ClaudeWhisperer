<script lang="ts">
  import { recording, isRecording, isProcessing } from '$lib/stores/recording';
  import { settings, activeRepo } from '$lib/stores/settings';
  import { runningSessions } from '$lib/stores/sessions';
  import StatusBadge from './StatusBadge.svelte';

  $: showTranscript = $settings.overlay.show_transcript;
  $: transcriptLines = $settings.overlay.transcript_lines;
  $: showSettings = $settings.overlay.show_settings;
  $: showTerminals = $settings.overlay.show_terminals;

  $: truncatedTranscript = $recording.transcript
    .split('\n')
    .slice(-transcriptLines)
    .join('\n');
</script>

<div class="overlay-window p-3">
  <div class="flex items-center justify-between gap-4">
    <div class="flex items-center gap-2">
      {#if $isRecording}
        <div class="w-3 h-3 bg-recording rounded-full animate-pulse-recording"></div>
        <span class="text-sm font-medium text-recording">Recording</span>
      {:else if $isProcessing}
        <div class="w-3 h-3 bg-warning rounded-full animate-pulse"></div>
        <span class="text-sm font-medium text-warning">Processing</span>
      {:else}
        <div class="w-3 h-3 bg-text-muted rounded-full"></div>
        <span class="text-sm text-text-secondary">Ready</span>
      {/if}
    </div>

    {#if $activeRepo && showSettings}
      <div class="flex items-center gap-2 text-xs">
        <span class="text-text-secondary truncate max-w-32">{$activeRepo.name}</span>
        <StatusBadge 
          createBranch={$settings.git.create_branch}
          autoMerge={$settings.git.auto_merge}
        />
      </div>
    {/if}

    {#if showTerminals && $runningSessions.length > 0}
      <div class="flex items-center gap-1 text-xs text-text-secondary">
        <span class="w-2 h-2 bg-success rounded-full"></span>
        <span>{$runningSessions.length} active</span>
      </div>
    {/if}
  </div>

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
</style>
