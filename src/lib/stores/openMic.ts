import { writable, derived, get } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { settings, OPEN_MIC_PRESETS } from "./settings";

export type OpenMicState =
  | "disabled"
  | "initializing"
  | "listening"
  | "triggered"
  | "error";

interface OpenMicStore {
  state: OpenMicState;
  error: string | null;
  lastTranscript: string;
  detectedCommand: string | null;
}

function createOpenMicStore() {
  const { subscribe, set, update } = writable<OpenMicStore>({
    state: "disabled",
    error: null,
    lastTranscript: "",
    detectedCommand: null,
  });

  const OPEN_MIC_SESSION_ID = "open_mic_passive";

  // Audio context and processor for passive listening
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let unlistenPartial: UnlistenFn | null = null;
  let unlistenFinal: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;

  // Convert Float32 audio samples to Int16 for Vosk
  function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return int16Array;
  }

  // Check if a transcript contains any wake command
  function detectWakeCommand(transcript: string): string | null {
    const currentSettings = get(settings);
    const wakeCommands = currentSettings.audio.open_mic.wake_commands;

    if (wakeCommands.length === 0) return null;

    const lowerTranscript = transcript.toLowerCase().trim();

    // Check for each wake command (exact match or at the end)
    for (const command of wakeCommands) {
      const lowerCommand = command.toLowerCase();

      // Check if transcript ends with the command
      if (lowerTranscript.endsWith(lowerCommand)) {
        return command;
      }

      // Check if transcript equals the command exactly
      if (lowerTranscript === lowerCommand) {
        return command;
      }

      // Check with common punctuation variations at the end
      const punctuationVariants = [
        `. ${lowerCommand}`,
        `, ${lowerCommand}`,
        `! ${lowerCommand}`,
        `? ${lowerCommand}`,
      ];

      for (const variant of punctuationVariants) {
        if (lowerTranscript.endsWith(variant)) {
          return command;
        }
      }
    }

    return null;
  }

  async function start() {
    const currentSettings = get(settings);

    // Check prerequisites
    if (!currentSettings.vosk?.enabled) {
      update((s) => ({
        ...s,
        state: "error",
        error: "Vosk must be enabled for open mic mode",
      }));
      return;
    }

    if (!currentSettings.audio.open_mic.enabled) {
      update((s) => ({
        ...s,
        state: "disabled",
        error: null,
      }));
      return;
    }

    if (currentSettings.audio.open_mic.wake_commands.length === 0) {
      update((s) => ({
        ...s,
        state: "error",
        error: "No wake commands configured",
      }));
      return;
    }

    update((s) => ({
      ...s,
      state: "initializing",
      error: null,
      detectedCommand: null,
    }));

    try {
      // Request microphone access
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: currentSettings.audio.device_id || undefined,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Create audio context at Vosk's required sample rate (16kHz)
      audioContext = new AudioContext({
        sampleRate: currentSettings.vosk.sample_rate || 16000,
      });
      const source = audioContext.createMediaStreamSource(mediaStream);

      // ScriptProcessor to extract PCM samples
      processor = audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = async (event) => {
        const currentState = get({ subscribe });
        if (currentState.state !== "listening") return;

        const float32Data = event.inputBuffer.getChannelData(0);
        const int16Data = convertFloat32ToInt16(float32Data);

        try {
          await invoke("send_vosk_audio", {
            sessionId: OPEN_MIC_SESSION_ID,
            samples: Array.from(int16Data),
          });
        } catch (error) {
          // Silently handle errors to avoid console spam
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Listen for Vosk partial events (real-time)
      unlistenPartial = await listen(
        `vosk-partial-${OPEN_MIC_SESSION_ID}`,
        (event: any) => {
          const partial = event.payload?.partial || "";
          if (!partial) return;

          update((s) => ({ ...s, lastTranscript: partial }));

          // Check for wake command in partial transcript
          const detectedCommand = detectWakeCommand(partial);
          if (detectedCommand) {
            handleWakeCommandDetected(detectedCommand);
          }
        }
      );

      // Listen for Vosk final events
      unlistenFinal = await listen(
        `vosk-final-${OPEN_MIC_SESSION_ID}`,
        (event: any) => {
          const text = event.payload?.text || "";
          if (!text) return;

          update((s) => ({ ...s, lastTranscript: text }));

          // Check for wake command in final transcript
          const detectedCommand = detectWakeCommand(text);
          if (detectedCommand) {
            handleWakeCommandDetected(detectedCommand);
          }
        }
      );

      // Listen for Vosk errors
      unlistenError = await listen(
        `vosk-error-${OPEN_MIC_SESSION_ID}`,
        (event: any) => {
          console.error("[open-mic] Vosk error:", event.payload?.error);
        }
      );

      // Start the Vosk session on the backend
      await invoke("start_vosk_session", { sessionId: OPEN_MIC_SESSION_ID });

      update((s) => ({ ...s, state: "listening" }));
      console.log("[open-mic] Started passive listening");
    } catch (error) {
      console.error("[open-mic] Failed to start:", error);
      update((s) => ({
        ...s,
        state: "error",
        error: error instanceof Error ? error.message : "Failed to start",
      }));
      await cleanup();
    }
  }

  function handleWakeCommandDetected(command: string) {
    const currentState = get({ subscribe });
    if (currentState.state !== "listening") return;

    console.log("[open-mic] Wake command detected:", command);

    update((s) => ({
      ...s,
      state: "triggered",
      detectedCommand: command,
    }));

    // Emit event to trigger recording in main app
    emit("open-mic-triggered", { command });

    // After a short delay, return to listening state
    // (The main app will handle starting the actual recording)
    setTimeout(() => {
      const state = get({ subscribe });
      if (state.state === "triggered") {
        update((s) => ({
          ...s,
          state: "listening",
          detectedCommand: null,
          lastTranscript: "",
        }));
      }
    }, 1000);
  }

  async function stop() {
    console.log("[open-mic] Stopping passive listening");
    await cleanup();
    update((s) => ({
      ...s,
      state: "disabled",
      error: null,
      lastTranscript: "",
      detectedCommand: null,
    }));
  }

  async function cleanup() {
    // Clean up event listeners
    if (unlistenPartial) {
      unlistenPartial();
      unlistenPartial = null;
    }
    if (unlistenFinal) {
      unlistenFinal();
      unlistenFinal = null;
    }
    if (unlistenError) {
      unlistenError();
      unlistenError = null;
    }

    // Clean up audio processing
    if (processor) {
      processor.disconnect();
      processor = null;
    }
    if (audioContext) {
      try {
        await audioContext.close();
      } catch (e) {
        // Ignore errors closing audio context
      }
      audioContext = null;
    }

    // Stop media stream
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    // Stop the backend Vosk session
    try {
      await invoke("stop_vosk_session", { sessionId: OPEN_MIC_SESSION_ID });
    } catch (error) {
      // Ignore errors stopping session (may not exist)
    }
  }

  // Restart listening (useful after settings change)
  async function restart() {
    await stop();
    const currentSettings = get(settings);
    if (
      currentSettings.audio.open_mic.enabled &&
      currentSettings.vosk?.enabled
    ) {
      await start();
    }
  }

  return {
    subscribe,
    start,
    stop,
    restart,
  };
}

export const openMic = createOpenMicStore();

// Derived stores for easier access
export const openMicState = derived(openMic, ($openMic) => $openMic.state);
export const isOpenMicListening = derived(
  openMic,
  ($openMic) => $openMic.state === "listening"
);
export const openMicError = derived(openMic, ($openMic) => $openMic.error);

// Helper to check if open mic is enabled in settings
export function isOpenMicEnabled(): boolean {
  const currentSettings = get(settings);
  return (
    currentSettings.audio.open_mic.enabled &&
    (currentSettings.vosk?.enabled ?? false)
  );
}

// Helper to get active wake commands
export function getActiveWakeCommands(): string[] {
  const currentSettings = get(settings);
  return currentSettings.audio.open_mic.wake_commands;
}

// Helper to get all wake command presets
export function getWakeCommandPresets(): readonly string[] {
  return OPEN_MIC_PRESETS;
}

// Helper to validate a wake command
export function isValidWakeCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed.length >= 2 && trimmed.length <= 30;
}
