import { writable, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type SessionStatus = 'Starting' | 'Running' | 'Completed' | 'Failed';

export interface TerminalSession {
  id: string;
  repo_path: string;
  prompt: string;
  status: SessionStatus;
  created_at: number;
}

function createSessionsStore() {
  const { subscribe, set, update } = writable<TerminalSession[]>([]);

  return {
    subscribe,
    set,
    update,

    async load() {
      try {
        const sessions = await invoke<TerminalSession[]>('get_terminal_sessions');
        set(sessions);
      } catch (error) {
        console.error('Failed to load sessions:', error);
      }
    },

    async createSession(prompt: string): Promise<string> {
      try {
        console.log('sessions.createSession called with prompt:', prompt);
        const sessionId = await invoke<string>('create_terminal_session', { prompt });
        console.log('Backend returned session ID:', sessionId);
        await this.load();
        console.log('Sessions reloaded');
        return sessionId;
      } catch (error) {
        console.error('Failed to create session:', error);
        throw error;
      }
    },

    async closeSession(sessionId: string) {
      try {
        await invoke('close_terminal', { sessionId });
        update((sessions) => sessions.filter((s) => s.id !== sessionId));
      } catch (error) {
        console.error('Failed to close session:', error);
        throw error;
      }
    },

    async writeToSession(sessionId: string, data: string) {
      try {
        await invoke('write_to_terminal', { sessionId, data });
      } catch (error) {
        console.error('Failed to write to session:', error);
        throw error;
      }
    },

    async resizeSession(sessionId: string, rows: number, cols: number) {
      try {
        await invoke('resize_terminal', { sessionId, rows, cols });
      } catch (error) {
        console.error('Failed to resize session:', error);
        throw error;
      }
    },

    updateSession(sessionId: string, updates: Partial<TerminalSession>) {
      update((sessions) =>
        sessions.map((s) => (s.id === sessionId ? { ...s, ...updates } : s))
      );
    },

    setupListeners() {
      listen<TerminalSession>('session-created', (event) => {
        update((sessions) => [...sessions, event.payload]);
      });
    },
  };
}

export const sessions = createSessionsStore();

export const activeSessionId = writable<string | null>(null);

export const activeSession = derived(
  [sessions, activeSessionId],
  ([$sessions, $activeSessionId]) => {
    return $sessions.find((s) => s.id === $activeSessionId) || null;
  }
);

export const runningSessions = derived(sessions, ($sessions) => {
  return $sessions.filter((s) => s.status === 'Running');
});
