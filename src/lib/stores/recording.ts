import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export type RecordingState = 'idle' | 'recording' | 'recorded' | 'processing' | 'error';

interface RecordingStore {
  state: RecordingState;
  transcript: string;
  error: string | null;
  audioData: Uint8Array | null;
}

function createRecordingStore() {
  const { subscribe, set, update } = writable<RecordingStore>({
    state: 'idle',
    transcript: '',
    error: null,
    audioData: null,
  });

  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];

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
        update((s) => ({ ...s, state: 'recording', error: null, transcript: '' }));
      } catch (error) {
        console.error('Failed to start recording:', error);
        update((s) => ({
          ...s,
          state: 'error',
          error: error instanceof Error ? error.message : 'Failed to start recording',
        }));
      }
    },

    async stopRecording(autoTranscribe: boolean = true): Promise<string | null> {
      return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
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

              const transcript = await invoke<string>('transcribe_audio', {
                audioData: Array.from(audioData),
              });

              update((s) => ({
                ...s,
                state: 'idle',
                transcript,
                audioData,
              }));

              mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
              mediaRecorder = null;
              audioChunks = [];

              resolve(transcript);
            } else {
              update((s) => ({ ...s, state: 'recorded', audioData }));

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
            reject(error);
          }
        };

        mediaRecorder.stop();
      });
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
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      }
      mediaRecorder = null;
      audioChunks = [];
      set({ state: 'idle', transcript: '', error: null, audioData: null });
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
