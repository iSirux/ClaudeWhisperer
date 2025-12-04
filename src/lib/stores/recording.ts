import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
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
  });

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let visualizationAnimationId: number | null = null;
  let recordingStartTime: number | null = null;

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

        // Also emit recording state change
        emit('recording-state', { state: 'recording' });

        update((s) => ({ ...s, state: 'recording', error: null, transcript: '', stream }));
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

    cancelRecording() {
      stopVisualizationBroadcast();
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      }
      mediaRecorder = null;
      audioChunks = [];
      set({ state: 'idle', transcript: '', error: null, audioData: null, stream: null, queue: [], transcribingCount: 0 });
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
