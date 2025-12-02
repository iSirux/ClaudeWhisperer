<script lang="ts">
  import { recording, isRecording, isProcessing, hasRecorded } from '$lib/stores/recording';
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

  async function startRecording() {
    await recording.startRecording($settings.audio.device_id || undefined);
  }

  async function stopRecording() {
    await recording.stopRecording(false);
  }

  async function stopAndSend() {
    try {
      const transcript = await recording.transcribeAndSend();
      if (transcript) {
        await sessions.createSession(transcript);
        recording.clearTranscript();
      }
    } catch (error) {
      console.error('Failed to send prompt:', error);
    }
  }

  function stopAndClear() {
    recording.cancelRecording();
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
      {:else if $hasRecorded}
        <span class="text-sm text-accent font-medium">Audio recorded</span>
      {:else}
        <span class="text-sm text-text-secondary">Transcript</span>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if !$isRecording && !$isProcessing && !$hasRecorded && !$recording.transcript}
        <button
          class="px-3 py-1.5 text-sm bg-recording hover:bg-recording/90 text-white rounded transition-colors flex items-center gap-2"
          onclick={startRecording}
        >
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clip-rule="evenodd" />
          </svg>
          Record
        </button>
      {/if}

      {#if $isRecording}
        <button
          class="px-3 py-1.5 text-sm bg-surface-elevated hover:bg-border rounded transition-colors"
          onclick={stopRecording}
        >
          Stop
        </button>
      {/if}

      {#if $hasRecorded}
        <button
          class="px-3 py-1.5 text-sm bg-surface-elevated hover:bg-border text-text-primary rounded transition-colors"
          onclick={stopAndClear}
        >
          Clear
        </button>
        <button
          class="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded transition-colors"
          onclick={stopAndSend}
        >
          Transcribe & Send
        </button>
      {/if}

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
      {:else if $hasRecorded}
        Audio recorded. Click "Transcribe & Send" to process or "Clear" to discard.
      {:else}
        Press hotkey, click Record button, or use open mic to start recording
      {/if}
    </div>
  {/if}
</div>
