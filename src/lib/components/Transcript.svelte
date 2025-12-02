<script lang="ts">
  import { recording, isRecording, isProcessing } from '$lib/stores/recording';
  import { sessions } from '$lib/stores/sessions';
  import { settings } from '$lib/stores/settings';

  let isEditing = false;
  let editedTranscript = '';

  function startEditing() {
    editedTranscript = $recording.transcript;
    isEditing = true;
  }

  function cancelEditing() {
    isEditing = false;
    editedTranscript = '';
  }

  async function sendPrompt() {
    const prompt = isEditing ? editedTranscript : $recording.transcript;
    if (!prompt.trim()) return;

    try {
      await sessions.createSession(prompt);
      recording.clearTranscript();
      cancelEditing();
    } catch (error) {
      console.error('Failed to send prompt:', error);
    }
  }

  function checkVoiceCommand(text: string): boolean {
    if (!$settings.audio.use_voice_command) return false;
    const command = $settings.audio.voice_command.toLowerCase();
    return text.toLowerCase().trim().endsWith(command);
  }

  $: if (checkVoiceCommand($recording.transcript)) {
    const cleanedTranscript = $recording.transcript
      .slice(0, -$settings.audio.voice_command.length)
      .trim();
    if (cleanedTranscript) {
      sessions.createSession(cleanedTranscript);
      recording.clearTranscript();
    }
  }
</script>

<div class="transcript-panel p-4 bg-surface border-t border-border">
  <div class="flex items-center justify-between mb-3">
    <div class="flex items-center gap-2">
      {#if $isRecording}
        <div class="w-2 h-2 bg-recording rounded-full animate-pulse-recording"></div>
        <span class="text-sm text-recording font-medium">Recording...</span>
      {:else if $isProcessing}
        <div class="w-2 h-2 bg-warning rounded-full animate-pulse"></div>
        <span class="text-sm text-warning font-medium">Processing...</span>
      {:else}
        <span class="text-sm text-text-secondary">Transcript</span>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if $recording.transcript && !isEditing}
        <button
          class="px-2 py-1 text-xs bg-surface-elevated hover:bg-border rounded transition-colors"
          onclick={startEditing}
        >
          Edit
        </button>
      {/if}
      {#if isEditing}
        <button
          class="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
          onclick={cancelEditing}
        >
          Cancel
        </button>
      {/if}
      {#if $recording.transcript || editedTranscript}
        <button
          class="px-3 py-1 text-xs bg-accent hover:bg-accent-hover text-white rounded transition-colors"
          onclick={sendPrompt}
          disabled={$isRecording || $isProcessing}
        >
          Send
        </button>
      {/if}
    </div>
  </div>

  {#if isEditing}
    <textarea
      class="w-full h-32 p-3 bg-background border border-border rounded font-mono text-sm resize-none focus:outline-none focus:border-accent"
      bind:value={editedTranscript}
      placeholder="Edit your prompt..."
    ></textarea>
  {:else if $recording.transcript}
    <div class="p-3 bg-background border border-border rounded font-mono text-sm max-h-32 overflow-y-auto whitespace-pre-wrap">
      {$recording.transcript}
    </div>
  {:else}
    <div class="p-3 bg-background border border-border rounded text-sm text-text-muted text-center">
      {#if $isRecording}
        Listening...
      {:else}
        Press hotkey or use open mic to start recording
      {/if}
    </div>
  {/if}
</div>
