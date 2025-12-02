import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

export type RecordingState = 'idle' | 'recording' | 'processing' | 'error';

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

    async stopRecording(): Promise<string | null> {
      return new Promise((resolve, reject) => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
          resolve(null);
          return;
        }

        mediaRecorder.onstop = async () => {
          try {
            update((s) => ({ ...s, state: 'processing' }));

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioData = new Uint8Array(arrayBuffer);

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
export const hasError = derived(recording, ($recording) => $recording.state === 'error');
