<script lang="ts">
  import { onDestroy } from 'svelte';
  import { recording, isRecording, isProcessing, hasRecorded } from '$lib/stores/recording';
  import { sessions, activeSessionId } from '$lib/stores/sessions';
  import { sdkSessions, activeSdkSessionId } from '$lib/stores/sdkSessions';
  import { settings, activeRepo } from '$lib/stores/settings';

  onDestroy(() => {
    if (audioElement) {
      audioElement.pause();
      audioElement = null;
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
  });

  let isEditing = false;
  let editedTranscript = '';
  let isPlaying = false;
  let audioElement: HTMLAudioElement | null = null;
  let audioUrl: string | null = null;

  function playAudio() {
    if (!$recording.audioData) return;

    if (isPlaying && audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
      isPlaying = false;
      return;
    }

    // Clean up previous audio URL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    const blob = new Blob([$recording.audioData], { type: 'audio/webm' });
    audioUrl = URL.createObjectURL(blob);

    audioElement = new Audio(audioUrl);
    audioElement.onended = () => {
      isPlaying = false;
    };
    audioElement.onerror = () => {
      isPlaying = false;
      console.error('Failed to play audio');
    };

    audioElement.play();
    isPlaying = true;
  }

  function stopAudio() {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
      isPlaying = false;
    }
  }

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

  async function transcribeOnly() {
    stopAudio();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    try {
      await recording.transcribeAndSend();
    } catch (error) {
      console.error('Failed to transcribe:', error);
    }
  }

  async function transcribeAndSend() {
    stopAudio();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    try {
      const transcript = await recording.transcribeAndSend();
      if (transcript) {
        if ($settings.terminal_mode === 'Sdk') {
          // SDK mode: create or reuse SDK session
          const repoPath = $activeRepo?.path || '.';
          const model = $settings.default_model;
          let sessionId = $activeSdkSessionId;
          if (!sessionId) {
            sessionId = await sdkSessions.createSession(repoPath, model);
            activeSdkSessionId.set(sessionId);
          }
          await sdkSessions.sendPrompt(sessionId, transcript);
          activeSessionId.set(null);
        } else {
          // PTY mode
          const sessionId = await sessions.createSession(transcript);
          activeSessionId.set(sessionId);
          activeSdkSessionId.set(null);
        }
        recording.clearTranscript();
      }
    } catch (error) {
      console.error('Failed to send prompt:', error);
    }
  }

  function stopAndClear() {
    stopAudio();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    recording.cancelRecording();
  }

  async function sendPrompt() {
    const prompt = isEditing ? editedTranscript : $recording.transcript;
    if (!prompt.trim()) return;

    try {
      if ($settings.terminal_mode === 'Sdk') {
        // SDK mode: create or reuse SDK session
        const repoPath = $activeRepo?.path || '.';
        const model = $settings.default_model;
        let sessionId = $activeSdkSessionId;
        if (!sessionId) {
          sessionId = await sdkSessions.createSession(repoPath, model);
          activeSdkSessionId.set(sessionId);
        }
        await sdkSessions.sendPrompt(sessionId, prompt);
        activeSessionId.set(null);
      } else {
        // PTY mode
        const sessionId = await sessions.createSession(prompt);
        activeSessionId.set(sessionId);
        activeSdkSessionId.set(null);
      }
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
      if ($settings.terminal_mode === 'Sdk') {
        // SDK mode
        const repoPath = $activeRepo?.path || '.';
        const model = $settings.default_model;
        const existingId = $activeSdkSessionId;
        if (existingId) {
          sdkSessions.sendPrompt(existingId, cleanedTranscript);
        } else {
          sdkSessions.createSession(repoPath, model).then((sessionId) => {
            activeSdkSessionId.set(sessionId);
            sdkSessions.sendPrompt(sessionId, cleanedTranscript);
          });
        }
        activeSessionId.set(null);
      } else {
        // PTY mode
        sessions.createSession(cleanedTranscript).then((sessionId) => {
          activeSessionId.set(sessionId);
          activeSdkSessionId.set(null);
        });
      }
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
          class="px-3 py-1.5 text-sm bg-surface-elevated hover:bg-border text-text-primary rounded transition-colors flex items-center gap-1.5"
          onclick={playAudio}
        >
          {#if isPlaying}
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clip-rule="evenodd" />
            </svg>
            Stop
          {:else}
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
            </svg>
            Play
          {/if}
        </button>
        <button
          class="px-3 py-1.5 text-sm bg-surface-elevated hover:bg-border text-text-primary rounded transition-colors"
          onclick={transcribeOnly}
        >
          Transcribe
        </button>
        <button
          class="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded transition-colors"
          onclick={transcribeAndSend}
        >
          Transcribe & Send
        </button>
      {/if}

      {#if $recording.transcript || isEditing}
        <button
          class="px-2 py-1 text-xs bg-surface-elevated hover:bg-border rounded transition-colors"
          onclick={() => { cancelEditing(); recording.clearTranscript(); }}
        >
          Clear
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
        Audio recorded. Click "Transcribe" to preview, "Transcribe & Send" to send immediately, or "Clear" to discard.
      {:else}
        Press hotkey, click Record button, or use open mic to start recording
      {/if}
    </div>
  {/if}
</div>
