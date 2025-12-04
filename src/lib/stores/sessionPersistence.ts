import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import { settings } from './settings';
import { sdkSessions, activeSdkSessionId, type SdkSession, type SdkMessage, type ThinkingLevel, type SessionAiMetadata, type PendingRepoSelection } from './sdkSessions';
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

// Serializable version of PendingTranscriptionInfo (no Uint8Array, no MediaStream)
export interface PersistedPendingTranscriptionInfo {
  status: 'recording' | 'transcribing' | 'processing';
  // Audio visualization data (frequency array from recording)
  audioVisualizationHistory?: number[][];
  // Recording timing
  recordingStartedAt?: number;
  recordingDurationMs?: number;
  // Note: audioData (Uint8Array) is NOT persisted - it's transient
  // Transcription result
  transcript?: string;
  transcriptionError?: string;
  // LLM processing results
  cleanedTranscript?: string;
  wasCleanedUp?: boolean;
  modelRecommendation?: {
    modelId: string;
    reasoning: string;
    thinkingLevel?: string;
  };
  repoRecommendation?: {
    repoIndex: number;
    repoName: string;
    reasoning: string;
    confidence: string;
  };
}

export interface PersistedSdkSession {
  id: string;
  cwd: string;
  model: string;
  thinkingLevel?: ThinkingLevel; // Now persisted
  messages: PersistedSdkMessage[];
  status: string;
  createdAt: number;
  startedAt?: number;
  // Timer-based duration tracking
  accumulatedDurationMs?: number;
  // AI-generated metadata
  aiMetadata?: SessionAiMetadata;
  // Pending transcription state (for sessions in pending_transcription status)
  pendingTranscription?: PersistedPendingTranscriptionInfo;
  // Pending repo selection (for sessions in pending_repo status)
  pendingRepoSelection?: PendingRepoSelection;
  // Pending prompt (waiting to be sent after initialization)
  pendingPrompt?: string;
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
 * Convert pending transcription info to persisted format (strips non-serializable data)
 */
function pendingTranscriptionToPersisted(
  info: SdkSession['pendingTranscription']
): PersistedPendingTranscriptionInfo | undefined {
  if (!info) return undefined;

  return {
    status: info.status,
    audioVisualizationHistory: info.audioVisualizationHistory,
    recordingStartedAt: info.recordingStartedAt,
    recordingDurationMs: info.recordingDurationMs,
    // Note: audioData (Uint8Array) is intentionally NOT persisted
    transcript: info.transcript,
    transcriptionError: info.transcriptionError,
    cleanedTranscript: info.cleanedTranscript,
    wasCleanedUp: info.wasCleanedUp,
    modelRecommendation: info.modelRecommendation,
    repoRecommendation: info.repoRecommendation,
  };
}

/**
 * Convert frontend SDK session to persisted format
 */
function sdkSessionToPersisted(session: SdkSession): PersistedSdkSession {
  // When saving, calculate the final accumulated duration
  // If session is currently working, include that time too
  let accumulatedDurationMs = session.accumulatedDurationMs || 0;
  if (session.currentWorkStartedAt) {
    accumulatedDurationMs += Date.now() - session.currentWorkStartedAt;
  }

  return {
    id: session.id,
    cwd: session.cwd,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
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
    accumulatedDurationMs,
    aiMetadata: session.aiMetadata,
    pendingTranscription: pendingTranscriptionToPersisted(session.pendingTranscription),
    pendingRepoSelection: session.pendingRepoSelection,
    pendingPrompt: session.pendingPrompt,
  };
}

/**
 * Convert persisted pending transcription to frontend format
 */
function persistedToPendingTranscription(
  persisted: PersistedPendingTranscriptionInfo | undefined
): SdkSession['pendingTranscription'] {
  if (!persisted) return undefined;

  return {
    status: persisted.status,
    audioVisualizationHistory: persisted.audioVisualizationHistory,
    recordingStartedAt: persisted.recordingStartedAt,
    recordingDurationMs: persisted.recordingDurationMs,
    // audioData is not restored - it was not persisted
    transcript: persisted.transcript,
    transcriptionError: persisted.transcriptionError,
    cleanedTranscript: persisted.cleanedTranscript,
    wasCleanedUp: persisted.wasCleanedUp,
    modelRecommendation: persisted.modelRecommendation,
    repoRecommendation: persisted.repoRecommendation,
  };
}

/**
 * Convert persisted SDK session to frontend format
 */
function persistedToSdkSession(persisted: PersistedSdkSession): SdkSession {
  // For pending_transcription sessions that were persisted mid-flow,
  // we restore them in a 'processing' state so the UI shows the LLM reasoning
  // but the user knows they need to re-record or continue manually
  const isPending = persisted.status === 'pending_transcription' || persisted.status === 'pending_repo';

  return {
    id: persisted.id,
    cwd: persisted.cwd,
    model: persisted.model,
    thinkingLevel: persisted.thinkingLevel ?? null, // Restore thinking level
    messages: persisted.messages.map(msg => ({
      type: msg.type as SdkMessage['type'],
      content: msg.content,
      tool: msg.tool,
      input: msg.input,
      output: msg.output,
      timestamp: msg.timestamp,
    })),
    // Restored sessions should be in 'done' or 'idle' state, never 'querying'
    // But pending sessions retain their status
    status: isPending
      ? (persisted.status as SdkSession['status'])
      : (persisted.status === 'querying' ? 'idle' : (persisted.status as SdkSession['status'])),
    createdAt: persisted.createdAt,
    startedAt: persisted.startedAt,
    // Restore accumulated duration, reset current work timer (not working when restored)
    accumulatedDurationMs: persisted.accumulatedDurationMs || 0,
    currentWorkStartedAt: undefined, // Session is idle when restored
    // Restore AI metadata
    aiMetadata: persisted.aiMetadata,
    // Restore pending transcription info (for display of LLM reasoning)
    pendingTranscription: persistedToPendingTranscription(persisted.pendingTranscription),
    // Restore pending repo selection
    pendingRepoSelection: persisted.pendingRepoSelection,
    // Restore pending prompt
    pendingPrompt: persisted.pendingPrompt,
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

  // Filter out sessions that are still actively recording (no useful data yet).
  // Sessions with transcription data, LLM reasoning, etc. are now persisted so
  // users can see the processing state and resume or restart.
  const persistableSdkSessions = currentSdkSessions.filter(s => {
    if (s.status !== 'pending_transcription') {
      return true; // Not pending, include it
    }
    // For pending_transcription sessions, only exclude if still recording with no transcript
    const hasTranscript = s.pendingTranscription?.transcript;
    const hasLlmReasoning = s.pendingTranscription?.modelRecommendation ||
                           s.pendingTranscription?.repoRecommendation ||
                           s.pendingTranscription?.cleanedTranscript;
    // Include if we have meaningful data to restore
    return hasTranscript || hasLlmReasoning;
  });

  const persistedData: PersistedSessions = {
    sdk_sessions: persistableSdkSessions.map(sdkSessionToPersisted),
    terminal_sessions: currentTerminalSessions.map(s => terminalSessionToPersisted(s)),
    active_sdk_session_id: currentActiveSdkId && persistableSdkSessions.some(s => s.id === currentActiveSdkId)
      ? currentActiveSdkId
      : null,
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

  const restoreLimit = currentSettings.session_persistence.restore_sessions;

  try {
    const persistedData = await invoke<PersistedSessions>('get_persisted_sessions');

    if (!persistedData || (!persistedData.sdk_sessions.length && !persistedData.terminal_sessions.length)) {
      console.log('[sessionPersistence] No persisted sessions found');
      return;
    }

    // Limit the number of sessions to restore based on setting
    // Sessions are already sorted by created_at descending from the backend
    const limitedSdkSessions = persistedData.sdk_sessions.slice(0, restoreLimit);
    const limitedTerminalSessions = persistedData.terminal_sessions.slice(0, restoreLimit);

    console.log('[sessionPersistence] Restoring', limitedSdkSessions.length, 'of', persistedData.sdk_sessions.length, 'SDK sessions and', limitedTerminalSessions.length, 'of', persistedData.terminal_sessions.length, 'terminal sessions (limit:', restoreLimit + ')');

    // Restore SDK sessions
    if (limitedSdkSessions.length > 0) {
      const restoredSdkSessions = limitedSdkSessions.map(persistedToSdkSession);
      sdkSessions.set(restoredSdkSessions);

      // Restore active SDK session selection if it exists and is within the restored sessions
      if (persistedData.active_sdk_session_id) {
        const exists = restoredSdkSessions.some(s => s.id === persistedData.active_sdk_session_id);
        if (exists) {
          activeSdkSessionId.set(persistedData.active_sdk_session_id);
        }
      }
    }

    // Restore terminal sessions (as completed/read-only)
    if (limitedTerminalSessions.length > 0) {
      const restoredTerminalSessions = limitedTerminalSessions.map(persistedToTerminalSession);
      sessions.set(restoredTerminalSessions);

      // Restore active terminal session selection if it exists and is within the restored sessions
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
