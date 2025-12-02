import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

export type RecordingState = 'idle' | 'recording' | 'recorded' | 'processing' | 'error';

interface RecordingStore {
  state: RecordingState;
  transcript: string;
  error: string | null;
  audioData: Uint8Array | null;
  stream: MediaStream | null;
}

function createRecordingStore() {
  const { subscribe, set, update } = writable<RecordingStore>({
    state: 'idle',
    transcript: '',
    error: null,
    audioData: null,
    stream: null,
  });

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let visualizationAnimationId: number | null = null;

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
      // Stop visualization broadcast immediately
      stopVisualizationBroadcast();

      return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
          emit('recording-state', { state: 'idle' });
          resolve(null);
          return;
        }

        mediaRecorder.onstop = async () => {
          try {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioData = new Uint8Array(arrayBuffer);

            if (autoTranscribe) {
              update((s) => ({ ...s, state: 'processing' }));
              emit('recording-state', { state: 'processing' });

              const transcript = await invoke<string>('transcribe_audio', {
                audioData: Array.from(audioData),
              });

              update((s) => ({
                ...s,
                state: 'idle',
                transcript,
                audioData,
                stream: null,
              }));
              emit('recording-state', { state: 'idle' });

              mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
              mediaRecorder = null;
              audioChunks = [];

              resolve(transcript);
            } else {
              update((s) => ({ ...s, state: 'recorded', audioData, stream: null }));
              emit('recording-state', { state: 'recorded' });

              mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
              mediaRecorder = null;
              audioChunks = [];

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

        mediaRecorder.stop();
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
      set({ state: 'idle', transcript: '', error: null, audioData: null, stream: null });
      emit('recording-state', { state: 'idle' });
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
