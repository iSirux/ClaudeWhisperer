import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { settings } from './settings';
import { sdkSessions, activeSdkSessionId, type SdkSession, type SdkMessage } from './sdkSessions';
import { sessions, activeSessionId, type TerminalSession } from './sessions';

// Persisted session types that match Rust backend
export interface PersistedSdkMessage {
  type: string;
  content?: string;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  timestamp: number;
}

export interface PersistedSdkSession {
  id: string;
  cwd: string;
  model: string;
  messages: PersistedSdkMessage[];
  status: string;
  createdAt: number;
  startedAt?: number;
}

export interface PersistedTerminalSession {
  id: string;
  repo_path: string;
  prompt: string;
  status: string;
  created_at: number;
  output_buffer?: string;
}

export interface PersistedSessions {
  sdk_sessions: PersistedSdkSession[];
  terminal_sessions: PersistedTerminalSession[];
  active_sdk_session_id: string | null;
  active_terminal_session_id: string | null;
  saved_at: number;
}

/**
 * Convert frontend SDK session to persisted format
 */
function sdkSessionToPersisted(session: SdkSession): PersistedSdkSession {
  return {
    id: session.id,
    cwd: session.cwd,
    model: session.model,
    messages: session.messages.map(msg => ({
      type: msg.type,
      content: msg.content,
      tool: msg.tool,
      input: msg.input,
      output: msg.output,
      timestamp: msg.timestamp,
    })),
    status: session.status,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
  };
}

/**
 * Convert persisted SDK session to frontend format
 */
function persistedToSdkSession(persisted: PersistedSdkSession): SdkSession {
  return {
    id: persisted.id,
    cwd: persisted.cwd,
    model: persisted.model,
    messages: persisted.messages.map(msg => ({
      type: msg.type as SdkMessage['type'],
      content: msg.content,
      tool: msg.tool,
      input: msg.input,
      output: msg.output,
      timestamp: msg.timestamp,
    })),
    // Restored sessions should be in 'done' or 'idle' state, never 'querying'
    status: persisted.status === 'querying' ? 'idle' : (persisted.status as SdkSession['status']),
    createdAt: persisted.createdAt,
    startedAt: persisted.startedAt,
  };
}

/**
 * Convert frontend terminal session to persisted format
 */
function terminalSessionToPersisted(session: TerminalSession, outputBuffer?: string): PersistedTerminalSession {
  return {
    id: session.id,
    repo_path: session.repo_path,
    prompt: session.prompt,
    // Persisted terminal sessions are always 'Completed' since we can't restore PTY
    status: 'Completed',
    created_at: session.created_at,
    output_buffer: outputBuffer,
  };
}

/**
 * Convert persisted terminal session to frontend format
 */
function persistedToTerminalSession(persisted: PersistedTerminalSession): TerminalSession {
  return {
    id: persisted.id,
    repo_path: persisted.repo_path,
    prompt: persisted.prompt,
    status: 'Completed', // Always completed since PTY can't be restored
    created_at: persisted.created_at,
  };
}

/**
 * Save current sessions to disk
 */
export async function saveSessionsToDisk(): Promise<void> {
  const currentSettings = get(settings);

  if (!currentSettings.session_persistence.enabled) {
    return;
  }

  const currentSdkSessions = get(sdkSessions);
  const currentTerminalSessions = get(sessions);
  const currentActiveSdkId = get(activeSdkSessionId);
  const currentActiveTerminalId = get(activeSessionId);

  const persistedData: PersistedSessions = {
    sdk_sessions: currentSdkSessions.map(sdkSessionToPersisted),
    terminal_sessions: currentTerminalSessions.map(s => terminalSessionToPersisted(s)),
    active_sdk_session_id: currentActiveSdkId,
    active_terminal_session_id: currentActiveTerminalId,
    saved_at: Date.now(),
  };

  try {
    await invoke('save_persisted_sessions', {
      sessions: persistedData,
      maxSessions: currentSettings.session_persistence.max_sessions,
    });
    console.log('[sessionPersistence] Sessions saved to disk');
  } catch (error) {
    console.error('[sessionPersistence] Failed to save sessions:', error);
  }
}

/**
 * Load sessions from disk and restore state
 */
export async function loadSessionsFromDisk(): Promise<void> {
  const currentSettings = get(settings);

  if (!currentSettings.session_persistence.enabled) {
    return;
  }

  try {
    const persistedData = await invoke<PersistedSessions>('get_persisted_sessions');

    if (!persistedData || (!persistedData.sdk_sessions.length && !persistedData.terminal_sessions.length)) {
      console.log('[sessionPersistence] No persisted sessions found');
      return;
    }

    console.log('[sessionPersistence] Restoring', persistedData.sdk_sessions.length, 'SDK sessions and', persistedData.terminal_sessions.length, 'terminal sessions');

    // Restore SDK sessions
    if (persistedData.sdk_sessions.length > 0) {
      const restoredSdkSessions = persistedData.sdk_sessions.map(persistedToSdkSession);
      sdkSessions.set(restoredSdkSessions);

      // Restore active SDK session selection if it exists
      if (persistedData.active_sdk_session_id) {
        const exists = restoredSdkSessions.some(s => s.id === persistedData.active_sdk_session_id);
        if (exists) {
          activeSdkSessionId.set(persistedData.active_sdk_session_id);
        }
      }
    }

    // Restore terminal sessions (as completed/read-only)
    if (persistedData.terminal_sessions.length > 0) {
      const restoredTerminalSessions = persistedData.terminal_sessions.map(persistedToTerminalSession);
      sessions.set(restoredTerminalSessions);

      // Restore active terminal session selection if it exists
      if (persistedData.active_terminal_session_id) {
        const exists = restoredTerminalSessions.some(s => s.id === persistedData.active_terminal_session_id);
        if (exists) {
          activeSessionId.set(persistedData.active_terminal_session_id);
        }
      }
    }

    console.log('[sessionPersistence] Sessions restored successfully');
  } catch (error) {
    console.error('[sessionPersistence] Failed to load sessions:', error);
  }
}

/**
 * Clear all persisted sessions
 */
export async function clearPersistedSessions(): Promise<void> {
  try {
    await invoke('clear_persisted_sessions');
    console.log('[sessionPersistence] Persisted sessions cleared');
  } catch (error) {
    console.error('[sessionPersistence] Failed to clear sessions:', error);
  }
}

/**
 * Setup auto-save on visibility change (when user switches away from app)
 */
export function setupAutoSave(): () => void {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      saveSessionsToDisk();
    }
  };

  const handleBeforeUnload = () => {
    // Note: This is a best-effort save. The invoke might not complete before the page unloads.
    saveSessionsToDisk();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', handleBeforeUnload);

  // Return cleanup function
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
}

/**
 * Setup periodic auto-save (every 5 minutes)
 */
export function setupPeriodicAutoSave(intervalMs: number = 5 * 60 * 1000): () => void {
  const intervalId = setInterval(() => {
    const currentSettings = get(settings);
    if (currentSettings.session_persistence.enabled) {
      saveSessionsToDisk();
    }
  }, intervalMs);

  return () => clearInterval(intervalId);
}
