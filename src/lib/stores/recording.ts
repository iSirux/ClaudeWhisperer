import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usageStats } from './usageStats';
import { settings } from './settings';

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
  let visualizationAnimationId: number | null = null;
  let recordingStartTime: number | null = null;

  // Vosk real-time transcription state
  let voskAudioContext: AudioContext | null = null;
  let voskProcessor: ScriptProcessorNode | null = null;
  let voskUnlistenPartial: UnlistenFn | null = null;
  let voskUnlistenFinal: UnlistenFn | null = null;
  let voskUnlistenError: UnlistenFn | null = null;
  // Accumulated final text from Vosk (when accumulate_transcript is enabled)
  let voskAccumulatedText: string = '';

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
    if (!currentSettings.vosk?.enabled) return;

    try {
      // Create audio context at Vosk's required sample rate (16kHz)
      voskAudioContext = new AudioContext({ sampleRate: currentSettings.vosk.sample_rate || 16000 });
      const source = voskAudioContext.createMediaStreamSource(stream);

      // ScriptProcessor to extract PCM samples (4096 samples per buffer)
      voskProcessor = voskAudioContext.createScriptProcessor(4096, 1, 1);

      voskProcessor.onaudioprocess = async (event) => {
        const float32Data = event.inputBuffer.getChannelData(0);
        const int16Data = convertFloat32ToInt16(float32Data);

        try {
          await invoke('send_vosk_audio', {
            sessionId,
            samples: Array.from(int16Data),
          });
        } catch (error) {
          console.error('Failed to send audio to Vosk:', error);
        }
      };

      source.connect(voskProcessor);
      // Connect to destination to keep processing active (required by ScriptProcessorNode)
      voskProcessor.connect(voskAudioContext.destination);

      // Listen for Vosk events
      voskUnlistenPartial = await listen(`vosk-partial-${sessionId}`, (event: any) => {
        const partial = event.payload?.partial || '';
        const shouldAccumulate = currentSettings.vosk?.accumulate_transcript ?? false;
        // When accumulating, prepend accumulated text to partial
        const displayText = shouldAccumulate && voskAccumulatedText
          ? `${voskAccumulatedText} ${partial}`.trim()
          : partial;
        update((s) => ({ ...s, realtimeTranscript: displayText }));
        emit('vosk-realtime-transcript', { text: displayText });
      });

      voskUnlistenFinal = await listen(`vosk-final-${sessionId}`, (event: any) => {
        const text = event.payload?.text || '';
        if (text) {
          const shouldAccumulate = currentSettings.vosk?.accumulate_transcript ?? false;
          if (shouldAccumulate) {
            // Append this final text to accumulated text
            voskAccumulatedText = voskAccumulatedText
              ? `${voskAccumulatedText} ${text}`.trim()
              : text;
          }
          const displayText = shouldAccumulate ? voskAccumulatedText : text;
          update((s) => ({ ...s, realtimeTranscript: displayText }));
          emit('vosk-realtime-transcript', { text: displayText });
        }
      });

      voskUnlistenError = await listen(`vosk-error-${sessionId}`, (event: any) => {
        console.error('Vosk error:', event.payload?.error);
      });

      // Start the Vosk session on the backend
      await invoke('start_vosk_session', { sessionId });

      update((s) => ({ ...s, voskSessionId: sessionId }));
    } catch (error) {
      console.error('Failed to start Vosk session:', error);
      // Clean up on error
      await stopVoskSession();
    }
  }

  // Stop Vosk real-time transcription session
  async function stopVoskSession() {
    const currentState = get({ subscribe });
    const sessionId = currentState.voskSessionId;

    // Clean up event listeners
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

    // Clean up audio processing
    if (voskProcessor) {
      voskProcessor.disconnect();
      voskProcessor = null;
    }
    if (voskAudioContext) {
      await voskAudioContext.close();
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
    try {
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function broadcastVisualization() {
        if (!analyser) return;

        analyser.getByteFrequencyData(dataArray);

        // Emit audio data to all windows
        emit('audio-visualization', { data: Array.from(dataArray) });

        visualizationAnimationId = requestAnimationFrame(broadcastVisualization);
      }

      broadcastVisualization();
    } catch (error) {
      console.error('Failed to start visualization broadcast:', error);
    }
  }

  function stopVisualizationBroadcast() {
    if (visualizationAnimationId !== null) {
      cancelAnimationFrame(visualizationAnimationId);
      visualizationAnimationId = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    analyser = null;

    // Emit empty data to signal recording stopped
    emit('audio-visualization', { data: null });
  }

  // Generate a unique ID for queued recordings
  function generateId(): string {
    return `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Process the next item in the transcription queue
  async function processQueue() {
    const currentState = get({ subscribe });

    // Find the next pending recording
    const pendingRecording = currentState.queue.find(r => r.status === 'pending');
    if (!pendingRecording) return;

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

    // Process the next item in the queue
    processQueue();
  }

  return {
    subscribe,

    async startRecording(deviceId?: string) {
      try {
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
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

        // Start Vosk real-time transcription if enabled
        const voskSessionId = `vosk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await startVoskSession(stream, voskSessionId);

        // Also emit recording state change
        emit('recording-state', { state: 'recording' });

        update((s) => ({ ...s, state: 'recording', error: null, transcript: '', realtimeTranscript: '', stream }));
      } catch (error) {
        console.error('Failed to start recording:', error);
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
          stopVisualizationBroadcast();
          emit('recording-state', { state: 'idle' });
          resolve(null);
          return;
        }

        mediaRecorder.onstop = async () => {
          // Stop visualization broadcast after recording has stopped
          stopVisualizationBroadcast();

          // Stop Vosk real-time transcription
          await stopVoskSession();

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
