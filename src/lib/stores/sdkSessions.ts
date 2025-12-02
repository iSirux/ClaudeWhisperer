import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { settings } from './settings';
import { playCompletionSound } from '$lib/utils/sound';

export interface SdkMessage {
  type: 'user' | 'text' | 'tool_start' | 'tool_result' | 'done' | 'error';
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  timestamp: number;
}

export interface SdkSession {
  id: string;
  cwd: string;
  model: string; // Per-session model (can differ from global default_model)
  messages: SdkMessage[];
  status: 'idle' | 'querying' | 'done' | 'error';
  createdAt: number;
  startedAt?: number; // Timestamp when first prompt was sent
}

function createSdkSessionsStore() {
  const { subscribe, set, update } = writable<SdkSession[]>([]);
  const listeners = new Map<string, UnlistenFn[]>();
  let sidecarStarted = false;

  return {
    subscribe,

    async ensureSidecarStarted(): Promise<void> {
      if (sidecarStarted) return;

      try {
        await invoke('start_sidecar');
        sidecarStarted = true;
      } catch (error) {
        console.error('Failed to start sidecar:', error);
        throw error;
      }
    },

    async createSession(cwd: string, model: string): Promise<string> {
      await this.ensureSidecarStarted();

      const id = crypto.randomUUID();

      const session: SdkSession = {
        id,
        cwd,
        model,
        messages: [],
        status: 'idle',
        createdAt: Date.now(),
      };

      update(sessions => [...sessions, session]);

      // Set up event listeners for this session
      const unlisteners: UnlistenFn[] = [];

      const textEventName = `sdk-text-${id}`;
      console.log('[sdkSessions] Setting up listener for:', textEventName);
      unlisteners.push(
        await listen<string>(textEventName, (e) => {
          console.log('[sdkSessions] Text event callback invoked for:', textEventName);
          console.log('[sdkSessions] Payload:', e.payload?.substring(0, 100));
          try {
            update(sessions => {
              console.log('[sdkSessions] Running update, current sessions:', sessions.length);
              return sessions.map(s =>
                s.id === id
                  ? {
                      ...s,
                      // Set startedAt on first actual response from SDK
                      startedAt: s.startedAt || Date.now(),
                      messages: [
                        ...s.messages,
                        { type: 'text' as const, content: e.payload, timestamp: Date.now() },
                      ],
                    }
                  : s
              );
            });
            console.log('[sdkSessions] Update completed');
          } catch (err) {
            console.error('[sdkSessions] Error in update:', err);
          }
        })
      );

      unlisteners.push(
        await listen<{ tool: string; input: Record<string, unknown> }>(
          `sdk-tool-start-${id}`,
          (e) => {
            update(sessions =>
              sessions.map(s =>
                s.id === id
                  ? {
                      ...s,
                      // Set startedAt on first actual response from SDK
                      startedAt: s.startedAt || Date.now(),
                      messages: [
                        ...s.messages,
                        {
                          type: 'tool_start' as const,
                          tool: e.payload.tool,
                          input: e.payload.input,
                          timestamp: Date.now(),
                        },
                      ],
                    }
                  : s
              )
            );
          }
        )
      );

      unlisteners.push(
        await listen<{ tool: string; output: string }>(`sdk-tool-result-${id}`, (e) => {
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    messages: [
                      ...s.messages,
                      {
                        type: 'tool_result' as const,
                        tool: e.payload.tool,
                        output: e.payload.output,
                        timestamp: Date.now(),
                      },
                    ],
                  }
                : s
            )
          );
        })
      );

      unlisteners.push(
        await listen(`sdk-done-${id}`, () => {
          console.log('[sdkSessions] Received done event for session:', id);
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    status: 'idle' as const,
                    messages: [...s.messages, { type: 'done' as const, timestamp: Date.now() }],
                  }
                : s
            )
          );

          // Play completion sound if enabled
          const currentSettings = get(settings);
          if (currentSettings.audio.play_sound_on_completion) {
            playCompletionSound();
          }
        })
      );

      unlisteners.push(
        await listen<string>(`sdk-error-${id}`, (e) => {
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    status: 'error' as const,
                    messages: [
                      ...s.messages,
                      { type: 'error' as const, content: e.payload, timestamp: Date.now() },
                    ],
                  }
                : s
            )
          );
        })
      );

      listeners.set(id, unlisteners);

      // Create the session on the backend
      console.log('[sdkSessions] Creating session with id:', id, 'cwd:', cwd, 'model:', model);
      await invoke('create_sdk_session', { id, cwd, model });
      console.log('[sdkSessions] Session created');

      return id;
    },

    async sendPrompt(id: string, prompt: string): Promise<void> {
      console.log('[sdkSessions] sendPrompt called for session:', id, 'prompt:', prompt.slice(0, 50));
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? {
                ...s,
                status: 'querying' as const,
                // Note: startedAt is set when the SDK actually starts working (first text or tool event)
                messages: [
                  ...s.messages,
                  { type: 'user' as const, content: prompt, timestamp: Date.now() },
                ],
              }
            : s
        )
      );

      try {
        console.log('[sdkSessions] Invoking send_sdk_prompt');
        await invoke('send_sdk_prompt', { id, prompt });
        console.log('[sdkSessions] send_sdk_prompt invoke returned');
      } catch (error) {
        update(sessions =>
          sessions.map(s =>
            s.id === id
              ? {
                  ...s,
                  status: 'error' as const,
                  messages: [
                    ...s.messages,
                    {
                      type: 'error' as const,
                      content: String(error),
                      timestamp: Date.now(),
                    },
                  ],
                }
              : s
          )
        );
        throw error;
      }
    },

    async stopQuery(id: string): Promise<void> {
      console.log('[sdkSessions] stopQuery called for session:', id);
      try {
        await invoke('stop_sdk_query', { id });
        update(sessions =>
          sessions.map(s =>
            s.id === id
              ? {
                  ...s,
                  status: 'idle' as const,
                }
              : s
          )
        );
      } catch (error) {
        console.error('Failed to stop SDK query:', error);
        throw error;
      }
    },

    async closeSession(id: string): Promise<void> {
      try {
        await invoke('close_sdk_session', { id });
      } catch (error) {
        console.error('Failed to close SDK session:', error);
      }

      // Clean up listeners
      const unlisteners = listeners.get(id);
      if (unlisteners) {
        for (const unlisten of unlisteners) {
          unlisten();
        }
        listeners.delete(id);
      }

      update(sessions => sessions.filter(s => s.id !== id));
    },

    getSession(id: string): SdkSession | undefined {
      let result: SdkSession | undefined;
      subscribe(sessions => {
        result = sessions.find(s => s.id === id);
      })();
      return result;
    },

    async updateSessionModel(id: string, model: string): Promise<void> {
      // Update the model in the local state immediately for responsive UI
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? { ...s, model }
            : s
        )
      );

      // Send the model update to the backend
      try {
        await invoke('update_sdk_model', { id, model });
        console.log('[sdkSessions] Model updated to:', model);
      } catch (error) {
        console.error('Failed to update SDK model:', error);
        // Optionally revert the change or show an error
      }
    },
  };
}

export const sdkSessions = createSdkSessionsStore();

export const activeSdkSessionId = writable<string | null>(null);

export const activeSdkSession = derived(
  [sdkSessions, activeSdkSessionId],
  ([$sdkSessions, $activeSdkSessionId]) => {
    return $sdkSessions.find(s => s.id === $activeSdkSessionId) || null;
  }
);
