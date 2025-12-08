import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usageStats } from './usageStats';
import { settings } from './settings';
import { processVoiceCommand } from '$lib/utils/voiceCommands';

export type RecordingState = 'idle' | 'recording' | 'recorded' | 'processing' | 'error';

interface QueuedRecording {
  id: string;
  audioData: Uint8Array;
  status: 'pending' | 'transcribing' | 'done' | 'error';
  transcript?: string;
  error?: string;
  onComplete?: (transcript: string) => void;
}

interface RecordingStore {
  state: RecordingState;
  transcript: string;
  error: string | null;
  audioData: Uint8Array | null;
  stream: MediaStream | null;
  // Queue for pending transcriptions
  queue: QueuedRecording[];
  // Number of recordings currently being transcribed
  transcribingCount: number;
  // Vosk real-time transcription
  realtimeTranscript: string;
  voskSessionId: string | null;
}

function createRecordingStore() {
  const { subscribe, set, update } = writable<RecordingStore>({
    state: 'idle',
    transcript: '',
    error: null,
    audioData: null,
    stream: null,
    queue: [],
    transcribingCount: 0,
    realtimeTranscript: '',
    voskSessionId: null,
  });

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let audioSource: MediaStreamAudioSourceNode | null = null; // Store source for proper cleanup
  let visualizationAnimationId: number | null = null;
  let recordingStartTime: number | null = null;

  // Vosk real-time transcription state
  let voskAudioContext: AudioContext | null = null;
  let voskProcessor: ScriptProcessorNode | null = null;
  let voskSource: MediaStreamAudioSourceNode | null = null; // Store source for proper cleanup
  let voskUnlistenPartial: UnlistenFn | null = null;
  let voskUnlistenFinal: UnlistenFn | null = null;
  let voskUnlistenError: UnlistenFn | null = null;
  // Accumulated final text from Vosk (when accumulate_transcript is enabled)
  let voskAccumulatedText: string = '';
  // Flag to prevent double-triggering of voice commands
  let voiceCommandTriggered: boolean = false;
  // Flag to prevent concurrent Vosk session starts
  let voskSessionStarting: boolean = false;

  // Convert Float32 audio samples to Int16 for Vosk
  function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  // Start Vosk real-time transcription session
  async function startVoskSession(stream: MediaStream, sessionId: string) {
    const currentSettings = get(settings);
    console.log('[recording] startVoskSession called', {
      sessionId,
      voskEnabled: currentSettings.vosk?.enabled,
    });
    if (!currentSettings.vosk?.enabled) {
      console.log('[recording] Vosk disabled, skipping');
      return;
    }

    // Prevent concurrent session starts
    if (voskSessionStarting) {
      console.log('[recording] Vosk session already starting, skipping');
      return;
    }
    voskSessionStarting = true;

    // Clean up any existing session first (guard against listener leaks)
    await stopVoskSession();

    // Reset voice command flag for new session
    voiceCommandTriggered = false;

    // Clear accumulated text FIRST before anything else
    voskAccumulatedText = '';
    // Emit clear event immediately
    emit('vosk-realtime-transcript', { text: '' });

    try {
      // Create audio context at Vosk's required sample rate (16kHz)
      voskAudioContext = new AudioContext({ sampleRate: currentSettings.vosk.sample_rate || 16000 });
      voskSource = voskAudioContext.createMediaStreamSource(stream);

      // ScriptProcessor to extract PCM samples (4096 samples per buffer)
      voskProcessor = voskAudioContext.createScriptProcessor(4096, 1, 1);

      // Store sessionId in closure, but check if context is still valid before sending
      const contextRef = voskAudioContext;
      voskProcessor.onaudioprocess = (event) => {
        // Skip if context was closed (prevents zombie callbacks)
        if (contextRef.state === 'closed' || !voskProcessor) return;

        const float32Data = event.inputBuffer.getChannelData(0);
        const int16Data = convertFloat32ToInt16(float32Data);

        // Use non-blocking invoke with catch (don't await to prevent backpressure)
        invoke('send_vosk_audio', {
          sessionId,
          samples: Array.from(int16Data),
        }).catch((error) => {
          // Only log if context is still active
          if (contextRef.state !== 'closed') {
            console.error('Failed to send audio to Vosk:', error);
          }
        });
      };

      voskSource.connect(voskProcessor);
      // Connect to destination to keep processing active (required by ScriptProcessorNode)
      voskProcessor.connect(voskAudioContext.destination);

      // Listen for Vosk events
      let lastPartialTime = Date.now();
      let lastPartialText = '';
      voskUnlistenPartial = await listen(`vosk-partial-${sessionId}`, (event: any) => {
        const partial = event.payload?.partial || '';

        const shouldAccumulate = currentSettings.vosk?.accumulate_transcript ?? false;
        // When accumulating, prepend accumulated text to partial
        const displayText = shouldAccumulate && voskAccumulatedText
          ? `${voskAccumulatedText} ${partial}`.trim()
          : partial;

        // Skip if displayText hasn't changed (avoid duplicate updates)
        if (displayText === lastPartialText) {
          return;
        }
        lastPartialText = displayText;

        const now = Date.now();
        const delta = now - lastPartialTime;
        lastPartialTime = now;

        console.log('[recording][partial]', {
          partial,
          deltaMs: delta,
          displayText,
        });

        update((s) => ({ ...s, realtimeTranscript: displayText }));
        emit('vosk-realtime-transcript', { text: displayText });

        // Check for voice commands in partial transcript for instant detection
        if (displayText && !voiceCommandTriggered) {
          const voiceCommandResult = processVoiceCommand(displayText);
          if (voiceCommandResult.commandDetected) {
            voiceCommandTriggered = true;
            console.log('[vosk] Voice command detected in partial:', voiceCommandResult.detectedCommand, 'type:', voiceCommandResult.commandType);
            emit('voice-command-triggered', {
              command: voiceCommandResult.detectedCommand,
              cleanedTranscript: voiceCommandResult.cleanedTranscript,
              originalTranscript: displayText,
              commandType: voiceCommandResult.commandType,
            });
          }
        }
      });

      voskUnlistenFinal = await listen(`vosk-final-${sessionId}`, (event: any) => {
        const text = event.payload?.text || '';
        console.log('[recording][final]', {
          raw: event.payload?.text,
          text,
          hasText: !!text,
        });
        if (text) {
          const shouldAccumulate = currentSettings.vosk?.accumulate_transcript ?? false;
          const prevAccumulated = voskAccumulatedText;
          if (shouldAccumulate) {
            // Append this final text to accumulated text
            voskAccumulatedText = voskAccumulatedText
              ? `${voskAccumulatedText} ${text}`.trim()
              : text;
          }
          const displayText = shouldAccumulate ? voskAccumulatedText : text;

          console.log('[recording][final] processed', {
            shouldAccumulate,
            prevAccumulated,
            newAccumulated: voskAccumulatedText,
            displayText,
          });

          update((s) => ({ ...s, realtimeTranscript: displayText }));
          emit('vosk-realtime-transcript', { text: displayText });

          // Check for voice commands in the accumulated/final transcript
          if (!voiceCommandTriggered) {
            const voiceCommandResult = processVoiceCommand(displayText);
            if (voiceCommandResult.commandDetected) {
              voiceCommandTriggered = true;
              console.log('[vosk] Voice command detected:', voiceCommandResult.detectedCommand, 'type:', voiceCommandResult.commandType);
              console.log('[vosk] Cleaned transcript:', voiceCommandResult.cleanedTranscript);
              // Emit event to trigger action (will be handled by +page.svelte)
              emit('voice-command-triggered', {
                command: voiceCommandResult.detectedCommand,
                cleanedTranscript: voiceCommandResult.cleanedTranscript,
                originalTranscript: displayText,
                commandType: voiceCommandResult.commandType,
              });
            }
          }
        }
      });

      voskUnlistenError = await listen(`vosk-error-${sessionId}`, (event: any) => {
        console.error('Vosk error:', event.payload?.error);
      });

      // Start the Vosk session on the backend
      console.log('[recording] Starting Vosk backend session...');
      await invoke('start_vosk_session', { sessionId });
      console.log('[recording] Vosk backend session started, listening for events on:', `vosk-partial-${sessionId}`);

      update((s) => ({ ...s, voskSessionId: sessionId }));
    } catch (error) {
      console.error('Failed to start Vosk session:', error);
      // Clean up on error
      await stopVoskSession();
    } finally {
      voskSessionStarting = false;
    }
  }

  // Stop Vosk real-time transcription session
  async function stopVoskSession() {
    const currentState = get({ subscribe });
    const sessionId = currentState.voskSessionId;

    // Clean up event listeners first (before any async operations)
    if (voskUnlistenPartial) {
      voskUnlistenPartial();
      voskUnlistenPartial = null;
    }
    if (voskUnlistenFinal) {
      voskUnlistenFinal();
      voskUnlistenFinal = null;
    }
    if (voskUnlistenError) {
      voskUnlistenError();
      voskUnlistenError = null;
    }

    // Clean up audio processing - disconnect source first, then processor
    if (voskSource) {
      try {
        voskSource.disconnect();
      } catch (e) {
        // Ignore - may already be disconnected
      }
      voskSource = null;
    }
    if (voskProcessor) {
      try {
        voskProcessor.disconnect();
      } catch (e) {
        // Ignore - may already be disconnected
      }
      voskProcessor = null;
    }
    if (voskAudioContext) {
      try {
        // Check state before closing to avoid errors on already closed contexts
        if (voskAudioContext.state !== 'closed') {
          await voskAudioContext.close();
        }
      } catch (e) {
        console.warn('[recording] Error closing Vosk audio context:', e);
      }
      voskAudioContext = null;
    }

    // Stop the backend session
    if (sessionId) {
      try {
        await invoke('stop_vosk_session', { sessionId });
      } catch (error) {
        console.error('Failed to stop Vosk session:', error);
      }
    }

    // Clear accumulated text when session ends
    voskAccumulatedText = '';
    update((s) => ({ ...s, voskSessionId: null, realtimeTranscript: '' }));
  }

  function startVisualizationBroadcast(stream: MediaStream) {
    // Clean up any existing visualization first
    stopVisualizationBroadcastSync();

    try {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      audioSource = audioContext.createMediaStreamSource(stream);
      audioSource.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function broadcastVisualization() {
        if (!analyser) return;

        analyser.getByteFrequencyData(dataArray);

        emit('audio-visualization', { data: Array.from(dataArray) });

        visualizationAnimationId = requestAnimationFrame(broadcastVisualization);
      }

      broadcastVisualization();
    } catch (error) {
      console.error('Failed to start visualization broadcast:', error);
    }
  }

  // Synchronous cleanup for visualization (used internally)
  function stopVisualizationBroadcastSync() {
    if (visualizationAnimationId !== null) {
      cancelAnimationFrame(visualizationAnimationId);
      visualizationAnimationId = null;
    }
    // Disconnect source before closing context
    if (audioSource) {
      try {
        audioSource.disconnect();
      } catch (e) {
        // Ignore - may already be disconnected
      }
      audioSource = null;
    }
    analyser = null;
  }

  async function stopVisualizationBroadcast() {
    stopVisualizationBroadcastSync();

    if (audioContext) {
      try {
        // Check state before closing to avoid errors on already closed contexts
        if (audioContext.state !== 'closed') {
          await audioContext.close();
        }
      } catch (e) {
        console.warn('[recording] Error closing visualization audio context:', e);
      }
      audioContext = null;
    }

    // Emit empty data to signal recording stopped
    emit('audio-visualization', { data: null });
  }

  // Generate a unique ID for queued recordings
  function generateId(): string {
    return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Flag to track if queue processing is active
  let queueProcessing = false;

  // Process the next item in the transcription queue
  async function processQueue() {
    // Prevent concurrent processing
    if (queueProcessing) return;

    const currentState = get({ subscribe });

    // Find the next pending recording
    const pendingRecording = currentState.queue.find(r => r.status === 'pending');
    if (!pendingRecording) return;

    queueProcessing = true;

    // Mark it as transcribing
    update((s) => ({
      ...s,
      transcribingCount: s.transcribingCount + 1,
      queue: s.queue.map(r =>
        r.id === pendingRecording.id ? { ...r, status: 'transcribing' as const } : r
      ),
    }));

    try {
      const transcript = await invoke<string>('transcribe_audio', {
        audioData: Array.from(pendingRecording.audioData),
      });

      // Track transcription
      usageStats.trackTranscription();

      // Update the queue item as done
      update((s) => ({
        ...s,
        transcribingCount: s.transcribingCount - 1,
        queue: s.queue.map(r =>
          r.id === pendingRecording.id ? { ...r, status: 'done' as const, transcript } : r
        ),
      }));

      // Call the completion callback if provided
      if (pendingRecording.onComplete) {
        pendingRecording.onComplete(transcript);
      }

      // Emit event for the completed transcription
      emit('transcription-complete', { id: pendingRecording.id, transcript });

    } catch (error) {
      console.error('Failed to transcribe queued recording:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to transcribe';

      update((s) => ({
        ...s,
        transcribingCount: s.transcribingCount - 1,
        queue: s.queue.map(r =>
          r.id === pendingRecording.id ? { ...r, status: 'error' as const, error: errorMessage } : r
        ),
      }));

      // Emit error event
      emit('transcription-error', { id: pendingRecording.id, error: errorMessage });
    }

    queueProcessing = false;

    // Process the next item in the queue using queueMicrotask to avoid stack overflow
    queueMicrotask(() => processQueue());
  }

  return {
    subscribe,

    async startRecording(deviceId?: string) {
      let stream: MediaStream | null = null;

      try {
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus',
        });
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };

        mediaRecorder.start(100);
        recordingStartTime = Date.now();

        // Start broadcasting audio visualization data to all windows
        startVisualizationBroadcast(stream);

        // Start Vosk real-time transcription if enabled (wrapped in try-catch to not fail recording)
        const voskSessionId = `vosk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        try {
          await startVoskSession(stream, voskSessionId);
        } catch (voskError) {
          // Log but don't fail recording if Vosk fails
          console.warn('[recording] Vosk session failed to start, continuing without real-time transcription:', voskError);
        }

        // Also emit recording state change
        emit('recording-state', { state: 'recording' });

        update((s) => ({ ...s, state: 'recording', error: null, transcript: '', realtimeTranscript: '', stream }));
      } catch (error) {
        console.error('Failed to start recording:', error);

        // Clean up any resources that were allocated before the error
        await stopVisualizationBroadcast();
        await stopVoskSession();

        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          try {
            mediaRecorder.stop();
          } catch (e) {
            // Ignore
          }
        }
        mediaRecorder = null;
        audioChunks = [];

        update((s) => ({
          ...s,
          state: 'error',
          error: error instanceof Error ? error.message : 'Failed to start recording',
          stream: null,
        }));
      }
    },

    async stopRecording(autoTranscribe: boolean = true): Promise<string | null> {
      return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
          // Still need to clean up visualization and Vosk even if mediaRecorder is inactive
          stopVisualizationBroadcast().catch(console.error);
          stopVoskSession().catch(console.error);
          emit('recording-state', { state: 'idle' });
          resolve(null);
          return;
        }

        mediaRecorder.onstop = async () => {
          try {
            // Stop visualization broadcast after recording has stopped
            await stopVisualizationBroadcast();
          } catch (vizError) {
            console.warn('[recording] Error stopping visualization:', vizError);
          }

          try {
            // Stop Vosk real-time transcription (wrapped in try-catch to ensure promise resolves)
            await stopVoskSession();
          } catch (voskError) {
            console.warn('[recording] Error stopping Vosk session:', voskError);
          }

          try {
            // Track recording duration
            if (recordingStartTime) {
              const duration = Date.now() - recordingStartTime;
              usageStats.trackRecording(duration);
              recordingStartTime = null;
            }

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioData = new Uint8Array(arrayBuffer);

            // Clean up media resources immediately
            mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
            mediaRecorder = null;
            audioChunks = [];

            if (autoTranscribe) {
              // Queue the transcription instead of blocking
              const recordingId = generateId();

              // Add to queue with a callback that will resolve the promise
              update((s) => ({
                ...s,
                state: 'idle', // Go back to idle so new recordings can start
                audioData,
                stream: null,
                queue: [
                  ...s.queue,
                  {
                    id: recordingId,
                    audioData,
                    status: 'pending',
                    onComplete: (transcript: string) => {
                      // Update the store with the transcript when done
                      update((s2) => ({ ...s2, transcript }));
                      resolve(transcript);
                    },
                  },
                ],
              }));

              // Emit that we're processing (for UI feedback)
              emit('recording-state', { state: 'processing' });

              // Start processing the queue if not already running
              processQueue();
            } else {
              update((s) => ({ ...s, state: 'recorded', audioData, stream: null }));
              emit('recording-state', { state: 'recorded' });
              resolve(null);
            }
          } catch (error) {
            console.error('Failed to process recording:', error);
            update((s) => ({
              ...s,
              state: 'error',
              error: error instanceof Error ? error.message : 'Failed to process recording',
            }));
            emit('recording-state', { state: 'error' });
            reject(error);
          }
        };

        // Add a small delay before stopping to prevent audio cutoff
        const lingerMs = get(settings).audio.recording_linger_ms;
        if (lingerMs > 0) {
          setTimeout(() => {
            mediaRecorder?.stop();
          }, lingerMs);
        } else {
          mediaRecorder.stop();
        }
      });
    },

    async stopAndTranscribe(): Promise<string | null> {
      return this.stopRecording(true);
    },

    async stopOnly(): Promise<void> {
      await this.stopRecording(false);
    },

    async transcribeAndSend() {
      try {
        update((s) => ({ ...s, state: 'processing' }));

        let currentAudioData: Uint8Array | null = null;
        recording.subscribe((s) => {
          currentAudioData = s.audioData;
        })();

        if (!currentAudioData) {
          throw new Error('No audio data available');
        }

        const transcript = await invoke<string>('transcribe_audio', {
          audioData: Array.from(currentAudioData),
        });

        // Track transcription
        usageStats.trackTranscription();

        update((s) => ({
          ...s,
          state: 'idle',
          transcript,
          stream: null,
        }));

        return transcript;
      } catch (error) {
        console.error('Failed to transcribe:', error);
        update((s) => ({
          ...s,
          state: 'error',
          error: error instanceof Error ? error.message : 'Failed to transcribe audio',
        }));
        throw error;
      }
    },

    async cancelRecording() {
      stopVisualizationBroadcast();
      await stopVoskSession();
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      }
      mediaRecorder = null;
      audioChunks = [];
      set({ state: 'idle', transcript: '', error: null, audioData: null, stream: null, queue: [], transcribingCount: 0, realtimeTranscript: '', voskSessionId: null });
      emit('recording-state', { state: 'idle' });
    },

    // Clear completed/errored items from the queue
    clearCompletedFromQueue() {
      update((s) => ({
        ...s,
        queue: s.queue.filter(r => r.status === 'pending' || r.status === 'transcribing'),
      }));
    },

    // Get the current queue length (pending + transcribing)
    getQueueLength(): number {
      const state = get({ subscribe });
      return state.queue.filter(r => r.status === 'pending' || r.status === 'transcribing').length;
    },

    clearTranscript() {
      update((s) => ({ ...s, transcript: '' }));
    },

    clearError() {
      update((s) => ({ ...s, error: null }));
    },
  };
}

export const recording = createRecordingStore();

export const isRecording = derived(recording, ($recording) => $recording.state === 'recording');
export const isProcessing = derived(recording, ($recording) => $recording.state === 'processing');
export const hasRecorded = derived(recording, ($recording) => $recording.state === 'recorded');
export const hasError = derived(recording, ($recording) => $recording.state === 'error');

// Queue-related derived stores
export const transcriptionQueue = derived(recording, ($recording) => $recording.queue);
export const pendingTranscriptions = derived(recording, ($recording) =>
  $recording.queue.filter(r => r.status === 'pending' || r.status === 'transcribing').length
);
export const isTranscribing = derived(recording, ($recording) => $recording.transcribingCount > 0);
export const hasQueuedTranscriptions = derived(recording, ($recording) =>
  $recording.queue.some(r => r.status === 'pending' || r.status === 'transcribing')
);

// Vosk real-time transcription
export const realtimeTranscript = derived(recording, ($recording) => $recording.realtimeTranscript);
export const hasVoskSession = derived(recording, ($recording) => $recording.voskSessionId !== null);
