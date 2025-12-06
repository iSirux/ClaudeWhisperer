import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { settings } from './settings';
import { playCompletionSound } from '$lib/utils/sound';
import { usageStats } from './usageStats';
import { saveSessionsToDisk } from './sessionPersistence';
import { analyzeSessionCompletion, generateSessionNameFromPrompt, isLlmEnabled } from '$lib/utils/llm';
import { isAutoModel, resolveModelForApi } from '$lib/utils/models';

// Debounced save to persist sessions after message updates
// This prevents data loss if the app is closed during an active query
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 2000; // Save 2 seconds after last message update

function debouncedSave(): void {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
  }
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    saveSessionsToDisk();
  }, SAVE_DEBOUNCE_MS);
}

export interface SdkImageContent {
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  base64Data: string;
  width?: number;
  height?: number;
}

export interface SdkMessage {
  type: 'user' | 'text' | 'tool_start' | 'tool_result' | 'done' | 'error' | 'subagent_start' | 'subagent_stop';
  content?: string;
  images?: SdkImageContent[]; // For user messages with images
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  // Subagent fields
  agentId?: string;
  agentType?: string;
  transcriptPath?: string;
  timestamp: number;
}

export interface SdkUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  contextWindow: number;
}

export interface SdkProgressiveUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface SdkSessionUsage {
  // Cumulative totals for the session (finalized after each query)
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalCostUsd: number;
  totalDurationMs: number;
  totalDurationApiMs: number;
  totalTurns: number;
  contextWindow: number;
  // For context usage percentage
  contextUsagePercent: number;
  // Per-query history
  queryUsage: SdkUsage[];
  // Progressive usage during active query (not yet finalized)
  progressiveInputTokens: number;
  progressiveOutputTokens: number;
  progressiveCacheReadTokens: number;
  progressiveCacheCreationTokens: number;
}

// AI-generated session metadata (from LLM)
export interface SessionAiMetadata {
  name?: string; // Generated immediately when prompt is sent
  category?: string; // feature, bugfix, refactor, research, question, other
  outcome?: string; // Generated when session completes - the result/answer
  needsInteraction?: boolean;
  interactionReason?: string;
  interactionUrgency?: string; // low, medium, high
  waitingFor?: string; // approval, clarification, input, review, decision
}

// Thinking mode: off (null) or on (31999 token budget)
export type ThinkingLevel = null | 'on';

// Settings format uses "off" string instead of null
export type SettingsThinkingLevel = 'off' | 'on';

// Convert from settings format to store format
export function settingsToStoreThinking(level: SettingsThinkingLevel): ThinkingLevel {
  return level === 'off' ? null : 'on';
}

// Convert from store format to settings format
export function storeToSettingsThinking(level: ThinkingLevel): SettingsThinkingLevel {
  return level === null ? 'off' : 'on';
}

// Token budget for thinking mode (31999 when on)
export const THINKING_BUDGET = 31999;

// Legacy support: map any thinking level to the budget
export const THINKING_BUDGETS: Record<string, number> = {
  on: 31999,
  think: 31999,
  megathink: 31999,
  ultrathink: 31999,
};

// Pending action info for sessions waiting on user input
export interface PendingRepoSelection {
  transcript: string;
  recommendedIndex: number | null;
  reasoning: string;
  confidence: string;
}

// Sub-status for pending_transcription state
export type PendingTranscriptionStatus = 'recording' | 'transcribing' | 'processing';

// Info about the recording/transcription phase
export interface PendingTranscriptionInfo {
  status: PendingTranscriptionStatus;
  // Audio visualization data (frequency array from recording)
  audioVisualizationHistory?: number[][]; // Array of frequency snapshots for waveform display
  // Recording timing
  recordingStartedAt?: number; // timestamp when recording started
  recordingDurationMs?: number; // final duration in milliseconds
  // Original audio data for retry capability
  audioData?: Uint8Array;
  // Transcription result (set when transcription completes)
  transcript?: string;
  transcriptionError?: string;
  // Vosk real-time transcript (if available)
  voskTranscript?: string;
  // LLM processing results
  cleanedTranscript?: string;
  wasCleanedUp?: boolean;
  /** List of corrections made by the cleanup */
  cleanupCorrections?: string[];
  /** Whether dual-source (Vosk + Whisper) cleanup was used */
  usedDualSource?: boolean;
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

export interface SdkSession {
  id: string;
  cwd: string;
  model: string; // Per-session model (can differ from global default_model)
  autoModelRequested?: boolean; // Whether this session was created with 'auto' model selection
  thinkingLevel: ThinkingLevel; // Per-session thinking mode (null = off)
  messages: SdkMessage[];
  // Session status:
  // - 'pending_transcription': recording/transcribing voice input
  // - 'pending_repo': waiting for user to select repository
  // - 'pending_approval': waiting for user to approve the transcribed prompt before sending
  // - 'initializing': setting up SDK session after repo selection
  // - 'idle': ready for input
  // - 'querying': LLM query in progress
  // - 'done': query completed (transitions to idle)
  // - 'error': an error occurred
  status: 'pending_transcription' | 'pending_repo' | 'pending_approval' | 'initializing' | 'idle' | 'querying' | 'done' | 'error';
  createdAt: number;
  startedAt?: number; // Timestamp when first prompt was sent (deprecated, kept for compatibility)
  // Timer-based duration tracking (survives session restore)
  accumulatedDurationMs: number; // Total accumulated work time in milliseconds
  currentWorkStartedAt?: number; // Timestamp when current work period started (undefined when idle)
  usage?: SdkSessionUsage; // Token usage tracking
  unread?: boolean; // Whether the session has completed but user hasn't viewed it yet
  // AI-generated metadata (Gemini)
  aiMetadata?: SessionAiMetadata;
  // Pending user actions
  pendingRepoSelection?: PendingRepoSelection; // Info for repo selection UI when status='pending_repo'
  pendingPrompt?: string; // The prompt waiting to be sent after initialization
  pendingApprovalPrompt?: string; // The prompt waiting for user approval (when status='pending_approval')
  // Pending transcription info (when status='pending_transcription')
  pendingTranscription?: PendingTranscriptionInfo;
}

// Message types for conversation history (sent to sidecar for restored sessions)
// These match the Rust HistoryMessage enum
export type HistoryMessage =
  | { type: 'user'; content: string }
  | { type: 'assistant'; content: string }
  | { type: 'tool_use'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: string };

/**
 * Convert SDK messages to history messages for session restoration.
 * This formats the frontend message history into a format the sidecar understands.
 */
function convertToHistoryMessages(messages: SdkMessage[]): HistoryMessage[] {
  const history: HistoryMessage[] = [];

  for (const msg of messages) {
    switch (msg.type) {
      case 'user':
        if (msg.content) {
          history.push({ type: 'user', content: msg.content });
        }
        break;
      case 'text':
        if (msg.content) {
          history.push({ type: 'assistant', content: msg.content });
        }
        break;
      case 'tool_start':
        if (msg.tool && msg.input) {
          history.push({ type: 'tool_use', tool: msg.tool, input: msg.input });
        }
        break;
      case 'tool_result':
        if (msg.tool && msg.output) {
          history.push({ type: 'tool_result', tool: msg.tool, output: msg.output });
        }
        break;
      // Skip 'done', 'error', 'subagent_start', 'subagent_stop' - they're not conversation content
    }
  }

  return history;
}

function createSdkSessionsStore() {
  const { subscribe, set, update } = writable<SdkSession[]>([]);
  const listeners = new Map<string, UnlistenFn[]>();
  // Track sessions that are live (registered with the backend and have listeners)
  const liveSessions = new Set<string>();
  let sidecarStarted = false;

  return {
    subscribe,
    set,

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

    async createSession(cwd: string, model: string, thinkingLevel: ThinkingLevel = null, systemPrompt?: string): Promise<string> {
      await this.ensureSidecarStarted();

      const id = crypto.randomUUID();

      // Track if user requested 'auto' model selection (before we resolve it)
      const autoModelRequested = isAutoModel(model);

      const session: SdkSession = {
        id,
        cwd,
        model,
        autoModelRequested,
        thinkingLevel,
        messages: [],
        status: 'idle',
        createdAt: Date.now(),
        accumulatedDurationMs: 0,
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
                      // Set startedAt on first actual response from SDK (deprecated, kept for compatibility)
                      startedAt: s.startedAt || Date.now(),
                      // Start work timer if not already started
                      currentWorkStartedAt: s.currentWorkStartedAt || Date.now(),
                      messages: [
                        ...s.messages,
                        { type: 'text' as const, content: e.payload, timestamp: Date.now() },
                      ],
                    }
                  : s
              );
            });
            debouncedSave();
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
            // Track tool usage for stats
            usageStats.trackToolCall(e.payload.tool);

            update(sessions =>
              sessions.map(s =>
                s.id === id
                  ? {
                      ...s,
                      // Set startedAt on first actual response from SDK (deprecated, kept for compatibility)
                      startedAt: s.startedAt || Date.now(),
                      // Start work timer if not already started
                      currentWorkStartedAt: s.currentWorkStartedAt || Date.now(),
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
            debouncedSave();
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
          debouncedSave();
        })
      );

      unlisteners.push(
        await listen(`sdk-done-${id}`, async () => {
          console.log('[sdkSessions] Received done event for session:', id);
          const currentSettings = get(settings);

          // Get session messages for Gemini analysis
          let sessionMessages: SdkMessage[] = [];
          let needsAiAnalysis = false;

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              // Calculate elapsed time for this work period and add to accumulated
              const now = Date.now();
              const workPeriodMs = s.currentWorkStartedAt ? now - s.currentWorkStartedAt : 0;

              const updatedMessages = [...s.messages, { type: 'done' as const, timestamp: now }];
              sessionMessages = updatedMessages;

              // Analyze completion if no outcome yet or if interaction detection is needed
              needsAiAnalysis = isLlmEnabled() && (!s.aiMetadata?.outcome || s.aiMetadata?.needsInteraction === undefined);

              return {
                ...s,
                status: 'idle' as const,
                // Accumulate the work time and reset the current work timer
                accumulatedDurationMs: s.accumulatedDurationMs + workPeriodMs,
                currentWorkStartedAt: undefined,
                messages: updatedMessages,
                // Mark as unread if the setting is enabled
                unread: currentSettings.mark_sessions_unread ? true : s.unread,
              };
            })
          );
          debouncedSave();

          // Play completion sound if enabled
          if (currentSettings.audio.play_sound_on_completion) {
            playCompletionSound();
          }

          // Run LLM analysis asynchronously to get outcome and interaction detection (don't block the UI)
          if (needsAiAnalysis && sessionMessages.length > 0) {
            analyzeSessionCompletion(sessionMessages).then(aiMetadata => {
              if (Object.keys(aiMetadata).length > 0) {
                update(sessions =>
                  sessions.map(s =>
                    s.id === id
                      ? { ...s, aiMetadata: { ...s.aiMetadata, ...aiMetadata } }
                      : s
                  )
                );
                console.log('[sdkSessions] AI completion metadata updated:', aiMetadata);
              }
            }).catch(err => {
              console.error('[sdkSessions] Failed to analyze session completion:', err);
            });
          }
        })
      );

      unlisteners.push(
        await listen<string>(`sdk-error-${id}`, (e) => {
          const currentSettings = get(settings);
          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              // Calculate elapsed time for this work period and add to accumulated
              const now = Date.now();
              const workPeriodMs = s.currentWorkStartedAt ? now - s.currentWorkStartedAt : 0;

              return {
                ...s,
                status: 'error' as const,
                // Accumulate the work time and reset the current work timer
                accumulatedDurationMs: s.accumulatedDurationMs + workPeriodMs,
                currentWorkStartedAt: undefined,
                messages: [
                  ...s.messages,
                  { type: 'error' as const, content: e.payload, timestamp: now },
                ],
                // Mark as unread if the setting is enabled
                unread: currentSettings.mark_sessions_unread ? true : s.unread,
              };
            })
          );
          debouncedSave();
        })
      );

      // Usage tracking listener
      unlisteners.push(
        await listen<SdkUsage>(`sdk-usage-${id}`, (e) => {
          console.log('[sdkSessions] Received usage event:', e.payload);
          const queryUsage = e.payload;

          // Track token usage in usage stats
          usageStats.trackTokenUsage(
            queryUsage.inputTokens,
            queryUsage.outputTokens,
            queryUsage.cacheReadTokens,
            queryUsage.cacheCreationTokens,
            queryUsage.totalCostUsd
          );

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              const prevUsage = s.usage || {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheReadTokens: 0,
                totalCacheCreationTokens: 0,
                totalCostUsd: 0,
                totalDurationMs: 0,
                totalDurationApiMs: 0,
                totalTurns: 0,
                contextWindow: queryUsage.contextWindow,
                contextUsagePercent: 0,
                queryUsage: [],
                progressiveInputTokens: 0,
                progressiveOutputTokens: 0,
                progressiveCacheReadTokens: 0,
                progressiveCacheCreationTokens: 0,
              };

              // Calculate cumulative totals (for cost/stats tracking)
              const totalInputTokens = prevUsage.totalInputTokens + queryUsage.inputTokens;
              const totalOutputTokens = prevUsage.totalOutputTokens + queryUsage.outputTokens;
              const contextWindow = queryUsage.contextWindow || prevUsage.contextWindow || 200000;
              // Context usage should be based on the CURRENT query's tokens only, not cumulative totals.
              // The input_tokens from the API already includes all conversation history (system prompt +
              // previous messages), so adding cumulative totals would double/triple count tokens.
              // The actual context usage is: current input tokens + current output tokens
              const currentContextTokens = queryUsage.inputTokens + queryUsage.outputTokens;
              const contextUsagePercent = Math.min(100, (currentContextTokens / contextWindow) * 100);

              return {
                ...s,
                usage: {
                  totalInputTokens,
                  totalOutputTokens,
                  totalCacheReadTokens: prevUsage.totalCacheReadTokens + queryUsage.cacheReadTokens,
                  totalCacheCreationTokens: prevUsage.totalCacheCreationTokens + queryUsage.cacheCreationTokens,
                  totalCostUsd: prevUsage.totalCostUsd + queryUsage.totalCostUsd,
                  totalDurationMs: prevUsage.totalDurationMs + queryUsage.durationMs,
                  totalDurationApiMs: prevUsage.totalDurationApiMs + queryUsage.durationApiMs,
                  totalTurns: prevUsage.totalTurns + queryUsage.numTurns,
                  contextWindow,
                  contextUsagePercent,
                  queryUsage: [...prevUsage.queryUsage, queryUsage],
                  // Reset progressive usage since query is done
                  progressiveInputTokens: 0,
                  progressiveOutputTokens: 0,
                  progressiveCacheReadTokens: 0,
                  progressiveCacheCreationTokens: 0,
                },
              };
            })
          );
        })
      );

      // Progressive usage listener (for live updates during query)
      unlisteners.push(
        await listen<SdkProgressiveUsage>(`sdk-progressive-usage-${id}`, (e) => {
          const progressiveUsage = e.payload;

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              const prevUsage = s.usage || {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheReadTokens: 0,
                totalCacheCreationTokens: 0,
                totalCostUsd: 0,
                totalDurationMs: 0,
                totalDurationApiMs: 0,
                totalTurns: 0,
                contextWindow: 200000,
                contextUsagePercent: 0,
                queryUsage: [],
                progressiveInputTokens: 0,
                progressiveOutputTokens: 0,
                progressiveCacheReadTokens: 0,
                progressiveCacheCreationTokens: 0,
              };

              // Progressive usage accumulates within the current query
              const progressiveInputTokens = prevUsage.progressiveInputTokens + progressiveUsage.inputTokens;
              const progressiveOutputTokens = prevUsage.progressiveOutputTokens + progressiveUsage.outputTokens;

              // Calculate live context usage for the CURRENT query only
              // Progressive tokens represent the current query's usage as it streams in
              // We don't add prevUsage.totalInputTokens because that would double-count
              // (the API's input_tokens already includes all conversation history)
              const liveCurrentTokens = progressiveInputTokens + progressiveOutputTokens;
              const contextUsagePercent = Math.min(100, (liveCurrentTokens / prevUsage.contextWindow) * 100);

              return {
                ...s,
                usage: {
                  ...prevUsage,
                  contextUsagePercent,
                  progressiveInputTokens,
                  progressiveOutputTokens,
                  progressiveCacheReadTokens: prevUsage.progressiveCacheReadTokens + progressiveUsage.cacheReadTokens,
                  progressiveCacheCreationTokens: prevUsage.progressiveCacheCreationTokens + progressiveUsage.cacheCreationTokens,
                },
              };
            })
          );
        })
      );

      // Subagent start listener
      unlisteners.push(
        await listen<{ agentId: string; agentType: string }>(`sdk-subagent-start-${id}`, (e) => {
          console.log('[sdkSessions] Subagent started:', e.payload.agentType, 'id:', e.payload.agentId);
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    messages: [
                      ...s.messages,
                      {
                        type: 'subagent_start' as const,
                        agentId: e.payload.agentId,
                        agentType: e.payload.agentType,
                        timestamp: Date.now(),
                      },
                    ],
                  }
                : s
            )
          );
          debouncedSave();
        })
      );

      // Subagent stop listener
      unlisteners.push(
        await listen<{ agentId: string; transcriptPath: string }>(`sdk-subagent-stop-${id}`, (e) => {
          console.log('[sdkSessions] Subagent stopped:', e.payload.agentId);
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    messages: [
                      ...s.messages,
                      {
                        type: 'subagent_stop' as const,
                        agentId: e.payload.agentId,
                        transcriptPath: e.payload.transcriptPath,
                        timestamp: Date.now(),
                      },
                    ],
                  }
                : s
            )
          );
          debouncedSave();
        })
      );

      listeners.set(id, unlisteners);

      // Resolve "auto" model to a valid model for the backend only
      // Keep session.model as 'auto' for UI display - it will be updated when LLM recommends on first prompt
      const currentSettings = get(settings);
      const resolvedModel = resolveModelForApi(model, currentSettings.enabled_models);
      if (resolvedModel !== model) {
        console.log('[sdkSessions] Using fallback model for backend:', resolvedModel, '(session displays:', model, ')');
      }

      // Create the session on the backend with resolved model
      console.log('[sdkSessions] Creating session with id:', id, 'cwd:', cwd, 'backendModel:', resolvedModel, 'systemPrompt:', systemPrompt ? 'yes' : 'no');
      await invoke('create_sdk_session', { id, cwd, model: resolvedModel, systemPrompt: systemPrompt ?? null });
      console.log('[sdkSessions] Session created');

      // Mark session as live (registered with backend and has listeners)
      liveSessions.add(id);

      // Apply initial thinking level if set
      if (thinkingLevel) {
        const maxThinkingTokens = THINKING_BUDGETS[thinkingLevel];
        console.log('[sdkSessions] Applying initial thinking level:', thinkingLevel, '(', maxThinkingTokens, 'tokens)');
        await invoke('update_sdk_thinking', { id, maxThinkingTokens });
      }

      // Track session creation for usage stats
      usageStats.trackSession('sdk', resolvedModel, cwd);

      return id;
    },

    /**
     * Ensure a restored session is re-registered with the backend and has listeners set up.
     * This is needed for sessions restored from persistence that don't have active connections.
     */
    async ensureSessionLive(id: string): Promise<void> {
      if (liveSessions.has(id)) {
        return; // Session is already live
      }

      // Get session data from store
      let session: SdkSession | undefined;
      subscribe(sessions => {
        session = sessions.find(s => s.id === id);
      })();

      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      console.log('[sdkSessions] Reinitializing restored session:', id);

      // Ensure sidecar is running
      await this.ensureSidecarStarted();

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
                      startedAt: s.startedAt || Date.now(),
                      // Start work timer if not already started
                      currentWorkStartedAt: s.currentWorkStartedAt || Date.now(),
                      messages: [
                        ...s.messages,
                        { type: 'text' as const, content: e.payload, timestamp: Date.now() },
                      ],
                    }
                  : s
              );
            });
            debouncedSave();
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
            usageStats.trackToolCall(e.payload.tool);
            update(sessions =>
              sessions.map(s =>
                s.id === id
                  ? {
                      ...s,
                      startedAt: s.startedAt || Date.now(),
                      // Start work timer if not already started
                      currentWorkStartedAt: s.currentWorkStartedAt || Date.now(),
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
            debouncedSave();
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
          debouncedSave();
        })
      );

      unlisteners.push(
        await listen(`sdk-done-${id}`, async () => {
          console.log('[sdkSessions] Received done event for session:', id);
          const currentSettings = get(settings);

          // Get session messages for Gemini analysis
          let sessionMessages: SdkMessage[] = [];
          let needsAiAnalysis = false;

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              // Calculate elapsed time for this work period and add to accumulated
              const now = Date.now();
              const workPeriodMs = s.currentWorkStartedAt ? now - s.currentWorkStartedAt : 0;

              const updatedMessages = [...s.messages, { type: 'done' as const, timestamp: now }];
              sessionMessages = updatedMessages;

              // Analyze completion if no outcome yet or if interaction detection is needed
              needsAiAnalysis = isLlmEnabled() && (!s.aiMetadata?.outcome || s.aiMetadata?.needsInteraction === undefined);

              return {
                ...s,
                status: 'idle' as const,
                // Accumulate the work time and reset the current work timer
                accumulatedDurationMs: s.accumulatedDurationMs + workPeriodMs,
                currentWorkStartedAt: undefined,
                messages: updatedMessages,
                // Mark as unread if the setting is enabled
                unread: currentSettings.mark_sessions_unread ? true : s.unread,
              };
            })
          );
          debouncedSave();

          if (currentSettings.audio.play_sound_on_completion) {
            playCompletionSound();
          }

          // Run LLM analysis asynchronously to get outcome and interaction detection (don't block the UI)
          if (needsAiAnalysis && sessionMessages.length > 0) {
            analyzeSessionCompletion(sessionMessages).then(aiMetadata => {
              if (Object.keys(aiMetadata).length > 0) {
                update(sessions =>
                  sessions.map(s =>
                    s.id === id
                      ? { ...s, aiMetadata: { ...s.aiMetadata, ...aiMetadata } }
                      : s
                  )
                );
                debouncedSave();
                console.log('[sdkSessions] AI completion metadata updated:', aiMetadata);
              }
            }).catch(err => {
              console.error('[sdkSessions] Failed to analyze session completion:', err);
            });
          }
        })
      );

      unlisteners.push(
        await listen<string>(`sdk-error-${id}`, (e) => {
          const currentSettings = get(settings);
          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              // Calculate elapsed time for this work period and add to accumulated
              const now = Date.now();
              const workPeriodMs = s.currentWorkStartedAt ? now - s.currentWorkStartedAt : 0;

              return {
                ...s,
                status: 'error' as const,
                // Accumulate the work time and reset the current work timer
                accumulatedDurationMs: s.accumulatedDurationMs + workPeriodMs,
                currentWorkStartedAt: undefined,
                messages: [
                  ...s.messages,
                  { type: 'error' as const, content: e.payload, timestamp: now },
                ],
                // Mark as unread if the setting is enabled
                unread: currentSettings.mark_sessions_unread ? true : s.unread,
              };
            })
          );
          debouncedSave();
        })
      );

      unlisteners.push(
        await listen<SdkUsage>(`sdk-usage-${id}`, (e) => {
          console.log('[sdkSessions] Received usage event:', e.payload);
          const queryUsage = e.payload;

          usageStats.trackTokenUsage(
            queryUsage.inputTokens,
            queryUsage.outputTokens,
            queryUsage.cacheReadTokens,
            queryUsage.cacheCreationTokens,
            queryUsage.totalCostUsd
          );

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              const prevUsage = s.usage || {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheReadTokens: 0,
                totalCacheCreationTokens: 0,
                totalCostUsd: 0,
                totalDurationMs: 0,
                totalDurationApiMs: 0,
                totalTurns: 0,
                contextWindow: queryUsage.contextWindow,
                contextUsagePercent: 0,
                queryUsage: [],
                progressiveInputTokens: 0,
                progressiveOutputTokens: 0,
                progressiveCacheReadTokens: 0,
                progressiveCacheCreationTokens: 0,
              };

              const totalInputTokens = prevUsage.totalInputTokens + queryUsage.inputTokens;
              const totalOutputTokens = prevUsage.totalOutputTokens + queryUsage.outputTokens;
              const contextWindow = queryUsage.contextWindow || prevUsage.contextWindow || 200000;
              // Context usage should be based on the CURRENT query's tokens only, not cumulative totals.
              // The input_tokens from the API already includes all conversation history.
              const currentContextTokens = queryUsage.inputTokens + queryUsage.outputTokens;
              const contextUsagePercent = Math.min(100, (currentContextTokens / contextWindow) * 100);

              return {
                ...s,
                usage: {
                  totalInputTokens,
                  totalOutputTokens,
                  totalCacheReadTokens: prevUsage.totalCacheReadTokens + queryUsage.cacheReadTokens,
                  totalCacheCreationTokens: prevUsage.totalCacheCreationTokens + queryUsage.cacheCreationTokens,
                  totalCostUsd: prevUsage.totalCostUsd + queryUsage.totalCostUsd,
                  totalDurationMs: prevUsage.totalDurationMs + queryUsage.durationMs,
                  totalDurationApiMs: prevUsage.totalDurationApiMs + queryUsage.durationApiMs,
                  totalTurns: prevUsage.totalTurns + queryUsage.numTurns,
                  contextWindow,
                  contextUsagePercent,
                  queryUsage: [...prevUsage.queryUsage, queryUsage],
                  progressiveInputTokens: 0,
                  progressiveOutputTokens: 0,
                  progressiveCacheReadTokens: 0,
                  progressiveCacheCreationTokens: 0,
                },
              };
            })
          );
        })
      );

      unlisteners.push(
        await listen<SdkProgressiveUsage>(`sdk-progressive-usage-${id}`, (e) => {
          const progressiveUsage = e.payload;

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              const prevUsage = s.usage || {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheReadTokens: 0,
                totalCacheCreationTokens: 0,
                totalCostUsd: 0,
                totalDurationMs: 0,
                totalDurationApiMs: 0,
                totalTurns: 0,
                contextWindow: 200000,
                contextUsagePercent: 0,
                queryUsage: [],
                progressiveInputTokens: 0,
                progressiveOutputTokens: 0,
                progressiveCacheReadTokens: 0,
                progressiveCacheCreationTokens: 0,
              };

              const progressiveInputTokens = prevUsage.progressiveInputTokens + progressiveUsage.inputTokens;
              const progressiveOutputTokens = prevUsage.progressiveOutputTokens + progressiveUsage.outputTokens;

              // Calculate live context usage for the CURRENT query only
              // Progressive tokens represent the current query's usage as it streams in
              const liveCurrentTokens = progressiveInputTokens + progressiveOutputTokens;
              const contextUsagePercent = Math.min(100, (liveCurrentTokens / prevUsage.contextWindow) * 100);

              return {
                ...s,
                usage: {
                  ...prevUsage,
                  contextUsagePercent,
                  progressiveInputTokens,
                  progressiveOutputTokens,
                  progressiveCacheReadTokens: prevUsage.progressiveCacheReadTokens + progressiveUsage.cacheReadTokens,
                  progressiveCacheCreationTokens: prevUsage.progressiveCacheCreationTokens + progressiveUsage.cacheCreationTokens,
                },
              };
            })
          );
        })
      );

      unlisteners.push(
        await listen<{ agentId: string; agentType: string }>(`sdk-subagent-start-${id}`, (e) => {
          console.log('[sdkSessions] Subagent started:', e.payload.agentType, 'id:', e.payload.agentId);
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    messages: [
                      ...s.messages,
                      {
                        type: 'subagent_start' as const,
                        agentId: e.payload.agentId,
                        agentType: e.payload.agentType,
                        timestamp: Date.now(),
                      },
                    ],
                  }
                : s
            )
          );
          debouncedSave();
        })
      );

      unlisteners.push(
        await listen<{ agentId: string; transcriptPath: string }>(`sdk-subagent-stop-${id}`, (e) => {
          console.log('[sdkSessions] Subagent stopped:', e.payload.agentId);
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    messages: [
                      ...s.messages,
                      {
                        type: 'subagent_stop' as const,
                        agentId: e.payload.agentId,
                        transcriptPath: e.payload.transcriptPath,
                        timestamp: Date.now(),
                      },
                    ],
                  }
                : s
            )
          );
          debouncedSave();
        })
      );

      listeners.set(id, unlisteners);

      // Convert message history to the format expected by the sidecar
      const historyMessages = convertToHistoryMessages(session.messages);
      console.log('[sdkSessions] Converted', session.messages.length, 'messages to', historyMessages.length, 'history messages');

      // Resolve "auto" model to a valid model for the backend only
      // Keep session.model as is for UI display - it will be updated when LLM recommends on first prompt
      const currentSettings = get(settings);
      const resolvedModel = resolveModelForApi(session.model, currentSettings.enabled_models);
      if (resolvedModel !== session.model) {
        console.log('[sdkSessions] Using fallback model for backend:', resolvedModel, '(session displays:', session.model, ')');
      }

      // Register session with backend, passing conversation history for restored sessions
      await invoke('create_sdk_session', {
        id,
        cwd: session.cwd,
        model: resolvedModel,
        systemPrompt: null,
        messages: historyMessages.length > 0 ? historyMessages : null,
      });

      // Mark session as live
      liveSessions.add(id);

      // Apply thinking level if set on the restored session
      if (session.thinkingLevel) {
        const maxThinkingTokens = THINKING_BUDGETS[session.thinkingLevel];
        console.log('[sdkSessions] Applying thinking level for restored session:', session.thinkingLevel, '(', maxThinkingTokens, 'tokens)');
        await invoke('update_sdk_thinking', { id, maxThinkingTokens });
      }

      console.log('[sdkSessions] Restored session reinitialized:', id, 'with', historyMessages.length, 'history messages');
    },

    async sendPrompt(id: string, prompt: string, images?: SdkImageContent[]): Promise<void> {
      console.log('[sdkSessions] sendPrompt called for session:', id, 'prompt:', prompt.slice(0, 50), 'images:', images?.length ?? 0);

      // Ensure session is live (handles restored sessions that need reinitialization)
      await this.ensureSessionLive(id);

      // Get session info for tracking and name generation
      let sessionCwd: string | undefined;
      let needsNameGeneration = false;
      subscribe(sessions => {
        const session = sessions.find(s => s.id === id);
        sessionCwd = session?.cwd;
        // Generate name if this is the first user message and no name exists
        needsNameGeneration = !session?.aiMetadata?.name && session?.messages.filter(m => m.type === 'user').length === 0;
      })();

      // Track prompt for usage stats
      usageStats.trackPrompt(sessionCwd);

      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? {
                ...s,
                status: 'querying' as const,
                // Note: startedAt is set when the SDK actually starts working (first text or tool event)
                messages: [
                  ...s.messages,
                  {
                    type: 'user' as const,
                    content: prompt,
                    images: images, // Include images in the message
                    timestamp: Date.now()
                  },
                ],
                // Clear interaction metadata when user replies - they've addressed any pending decision/clarification
                aiMetadata: s.aiMetadata ? {
                  ...s.aiMetadata,
                  needsInteraction: undefined,
                  interactionReason: undefined,
                  interactionUrgency: undefined,
                  waitingFor: undefined,
                } : s.aiMetadata,
              }
            : s
        )
      );

      // Generate session name from prompt asynchronously (don't block)
      if (needsNameGeneration && isLlmEnabled()) {
        generateSessionNameFromPrompt(prompt).then(aiMetadata => {
          if (aiMetadata.name) {
            update(sessions =>
              sessions.map(s =>
                s.id === id
                  ? { ...s, aiMetadata: { ...s.aiMetadata, ...aiMetadata } }
                  : s
              )
            );
            console.log('[sdkSessions] Session name generated:', aiMetadata.name);
          }
        }).catch(err => {
          console.error('[sdkSessions] Failed to generate session name:', err);
        });
      }

      try {
        console.log('[sdkSessions] Invoking send_sdk_prompt');
        // Pass images to the backend if present
        await invoke('send_sdk_prompt', { id, prompt, images: images ?? null });
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

      // If session isn't live, there's nothing to stop
      if (!liveSessions.has(id)) {
        console.log('[sdkSessions] Session not live, nothing to stop');
        update(sessions =>
          sessions.map(s =>
            s.id === id
              ? { ...s, status: 'idle' as const }
              : s
          )
        );
        return;
      }

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

      // Remove from live sessions
      liveSessions.delete(id);

      update(sessions => sessions.filter(s => s.id !== id));

      // Save to disk so the closed session is removed from persistence
      await saveSessionsToDisk();
    },

    getSession(id: string): SdkSession | undefined {
      let result: SdkSession | undefined;
      subscribe(sessions => {
        result = sessions.find(s => s.id === id);
      })();
      return result;
    },

    async updateSessionModel(id: string, model: string): Promise<void> {
      // Resolve "auto" model to a valid model if session is live
      // (For non-live sessions, we store "auto" and resolve on reinitialization)
      const currentSettings = get(settings);
      const shouldResolve = liveSessions.has(id) && isAutoModel(model);
      const resolvedModel = shouldResolve ? resolveModelForApi(model, currentSettings.enabled_models) : model;

      if (shouldResolve && resolvedModel !== model) {
        console.log('[sdkSessions] Resolved auto model to:', resolvedModel);
      }

      // Update the model in the local state immediately for responsive UI
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? { ...s, model: resolvedModel }
            : s
        )
      );

      // Only send to backend if session is live
      // For restored sessions, the model will be used when session is reinitialized
      if (!liveSessions.has(id)) {
        console.log('[sdkSessions] Session not live, model update stored locally:', model);
        return;
      }

      // Send the model update to the backend
      try {
        await invoke('update_sdk_model', { id, model: resolvedModel });
        console.log('[sdkSessions] Model updated to:', resolvedModel);
      } catch (error) {
        console.error('Failed to update SDK model:', error);
      }
    },

    async updateSessionThinking(id: string, thinkingLevel: ThinkingLevel): Promise<void> {
      // Update the thinking level in the local state immediately for responsive UI
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? { ...s, thinkingLevel }
            : s
        )
      );

      // Calculate the token budget (null for off)
      const maxThinkingTokens = thinkingLevel ? THINKING_BUDGETS[thinkingLevel] : null;

      // Only send to backend if session is live
      // For restored sessions, the thinking level will be used when session is reinitialized
      if (!liveSessions.has(id)) {
        console.log('[sdkSessions] Session not live, thinking update stored locally:', thinkingLevel);
        return;
      }

      // Send the thinking update to the backend
      try {
        await invoke('update_sdk_thinking', { id, maxThinkingTokens });
        console.log('[sdkSessions] Thinking updated to:', thinkingLevel, '(', maxThinkingTokens, 'tokens)');
      } catch (error) {
        console.error('Failed to update SDK thinking:', error);
      }
    },

    /**
     * Update the working directory (repository) of an existing session.
     * Only works for sessions that haven't started querying yet.
     * This also reinitializes the backend session with the new cwd.
     */
    async updateSessionCwd(id: string, cwd: string): Promise<void> {
      // Get current session state
      let session: SdkSession | undefined;
      subscribe(sessions => {
        session = sessions.find(s => s.id === id);
      })();

      if (!session || session.status !== 'idle' || session.messages.length > 0) {
        console.warn('[sdkSessions] Cannot update cwd: session not found or has messages');
        return;
      }

      // Update frontend state
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? { ...s, cwd }
            : s
        )
      );

      // If session is live (backend exists), we need to close and recreate with new cwd
      if (liveSessions.has(id)) {
        console.log('[sdkSessions] Reinitializing backend session with new cwd:', cwd);

        try {
          // Close the old backend session
          await invoke('close_sdk_session', { id });

          // Resolve model for backend (in case it's 'auto')
          const currentSettings = get(settings);
          const resolvedModel = resolveModelForApi(session.model, currentSettings.enabled_models);

          // Recreate with new cwd
          await invoke('create_sdk_session', {
            id,
            cwd,
            model: resolvedModel,
            systemPrompt: null,
          });

          // Reapply thinking level if set
          if (session.thinkingLevel) {
            const maxThinkingTokens = THINKING_BUDGETS[session.thinkingLevel];
            await invoke('update_sdk_thinking', { id, maxThinkingTokens });
          }

          console.log('[sdkSessions] Backend session reinitialized with cwd:', cwd);
        } catch (error) {
          console.error('[sdkSessions] Failed to reinitialize backend session:', error);
        }
      }
    },

    markAsRead(id: string): void {
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? { ...s, unread: false }
            : s
        )
      );
    },

    /**
     * Create a pending transcription session.
     * This session is created immediately when recording starts, before transcription.
     */
    createPendingTranscriptionSession(
      model: string,
      thinkingLevel: ThinkingLevel
    ): string {
      const id = crypto.randomUUID();

      const session: SdkSession = {
        id,
        cwd: '', // Will be set after repo determination
        model,
        thinkingLevel,
        messages: [],
        status: 'pending_transcription',
        createdAt: Date.now(),
        accumulatedDurationMs: 0,
        pendingTranscription: {
          status: 'recording',
          audioVisualizationHistory: [],
          recordingStartedAt: Date.now(),
        },
      };

      update(sessions => [...sessions, session]);

      return id;
    },

    /**
     * Update the pending transcription status and info.
     */
    updatePendingTranscription(
      id: string,
      updates: Partial<PendingTranscriptionInfo>
    ): void {
      update(sessions =>
        sessions.map(s => {
          if (s.id !== id || !s.pendingTranscription) return s;

          // If status is changing from 'recording' to something else, calculate duration
          let finalUpdates = { ...updates };
          if (
            updates.status &&
            updates.status !== 'recording' &&
            s.pendingTranscription.status === 'recording' &&
            s.pendingTranscription.recordingStartedAt
          ) {
            finalUpdates.recordingDurationMs =
              Date.now() - s.pendingTranscription.recordingStartedAt;
          }

          return {
            ...s,
            pendingTranscription: {
              ...s.pendingTranscription,
              ...finalUpdates,
            },
          };
        })
      );
    },

    /**
     * Set model/repo recommendations on a session.
     * Creates pendingTranscription if it doesn't exist (for typed prompts).
     */
    setRecommendations(
      id: string,
      options: {
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
        transcript?: string;
      }
    ): void {
      update(sessions =>
        sessions.map(s => {
          if (s.id !== id) return s;

          // Create or update pendingTranscription
          const existingPending = s.pendingTranscription;
          return {
            ...s,
            pendingTranscription: {
              status: existingPending?.status ?? 'processing' as PendingTranscriptionStatus,
              ...existingPending,
              ...(options.transcript && { transcript: options.transcript }),
              ...(options.modelRecommendation && { modelRecommendation: options.modelRecommendation }),
              ...(options.repoRecommendation && { repoRecommendation: options.repoRecommendation }),
            },
          };
        })
      );
    },

    /**
     * Add audio visualization snapshot to the session's history.
     */
    addAudioVisualizationSnapshot(id: string, data: number[]): void {
      update(sessions =>
        sessions.map(s =>
          s.id === id && s.pendingTranscription
            ? {
                ...s,
                pendingTranscription: {
                  ...s.pendingTranscription,
                  audioVisualizationHistory: [
                    ...(s.pendingTranscription.audioVisualizationHistory || []),
                    data,
                  ].slice(-100), // Keep last 100 snapshots (~10 seconds at 10fps)
                },
              }
            : s
        )
      );
    },

    /**
     * Store the audio data for retry capability.
     */
    storeAudioData(id: string, audioData: Uint8Array): void {
      update(sessions =>
        sessions.map(s =>
          s.id === id && s.pendingTranscription
            ? {
                ...s,
                pendingTranscription: {
                  ...s.pendingTranscription,
                  audioData,
                },
              }
            : s
        )
      );
    },

    /**
     * Transition from pending_transcription to the next state.
     * If repo auto-select returns low confidence, transition to pending_repo.
     * Otherwise, transition to initializing and start the SDK session.
     */
    async completePendingTranscription(
      id: string,
      cwd: string,
      transcript: string,
      systemPrompt?: string,
      pendingRepoSelection?: PendingRepoSelection
    ): Promise<void> {
      // Get session info
      let session: SdkSession | undefined;
      subscribe(sessions => {
        session = sessions.find(s => s.id === id);
      })();

      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      if (session.status !== 'pending_transcription') {
        console.warn('[sdkSessions] Session is not pending transcription:', session.status);
        return;
      }

      if (pendingRepoSelection) {
        // Need user to select repo - transition to pending_repo
        update(sessions =>
          sessions.map(s =>
            s.id === id
              ? {
                  ...s,
                  status: 'pending_repo' as const,
                  pendingRepoSelection,
                  pendingPrompt: transcript,
                  // Keep pendingTranscription for display purposes
                }
              : s
          )
        );
      } else {
        // Have repo, transition to initializing
        update(sessions =>
          sessions.map(s =>
            s.id === id
              ? {
                  ...s,
                  cwd,
                  status: 'initializing' as const,
                  pendingPrompt: transcript,
                }
              : s
          )
        );

        // Initialize the SDK session
        await this.initializeSession(id, cwd, session.model, session.thinkingLevel, systemPrompt, transcript);
      }
    },

    /**
     * Cancel a pending transcription session (e.g., user cancelled recording).
     */
    cancelPendingTranscription(id: string): void {
      update(sessions => sessions.filter(s => s.id !== id));
    },

    /**
     * Set a session to pending_approval status.
     * Used when require_transcription_approval is enabled.
     * The session waits for user to review and approve the prompt before sending.
     */
    setPendingApproval(id: string, prompt: string, cwd?: string): void {
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? {
                ...s,
                status: 'pending_approval' as const,
                pendingApprovalPrompt: prompt,
                cwd: cwd || s.cwd,
              }
            : s
        )
      );
    },

    /**
     * Cancel a pending approval (close the session).
     */
    cancelApproval(id: string): void {
      update(sessions => sessions.filter(s => s.id !== id));
    },

    /**
     * Approve and send a pending prompt.
     * Transitions from pending_approval → initializing → querying.
     * @param editedPrompt - Optional edited prompt to use instead of the original
     * @param systemPrompt - Optional system prompt to include
     */
    async approveAndSend(id: string, editedPrompt?: string, systemPrompt?: string): Promise<void> {
      // Get session info
      let session: SdkSession | undefined;
      subscribe(sessions => {
        session = sessions.find(s => s.id === id);
      })();

      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      if (session.status !== 'pending_approval') {
        console.warn('[sdkSessions] Session is not pending approval:', session.status);
        return;
      }

      const prompt = editedPrompt || session.pendingApprovalPrompt;
      if (!prompt) {
        throw new Error('No prompt to send');
      }

      // Transition to initializing
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? {
                ...s,
                status: 'initializing' as const,
                pendingPrompt: prompt,
                pendingApprovalPrompt: undefined,
              }
            : s
        )
      );

      // Initialize the SDK session and send the prompt
      await this.initializeSession(id, session.cwd, session.model, session.thinkingLevel, systemPrompt, prompt);
    },

    /**
     * Create a pending session that's waiting for repo selection.
     * The session is created immediately but the SDK isn't initialized yet.
     */
    createPendingRepoSession(
      model: string,
      thinkingLevel: ThinkingLevel,
      pendingRepoSelection: PendingRepoSelection
    ): string {
      const id = crypto.randomUUID();

      const session: SdkSession = {
        id,
        cwd: '', // Will be set after repo selection
        model,
        thinkingLevel,
        messages: [],
        status: 'pending_repo',
        createdAt: Date.now(),
        accumulatedDurationMs: 0,
        pendingRepoSelection,
        pendingPrompt: pendingRepoSelection.transcript,
      };

      update(sessions => [...sessions, session]);

      return id;
    },

    /**
     * Transition an existing session to pending_repo state.
     * Used when a manual session needs repo selection before sending first prompt.
     */
    createPendingRepoFromExisting(
      id: string,
      prompt: string,
      pendingRepoSelection: PendingRepoSelection
    ): void {
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? {
                ...s,
                status: 'pending_repo' as const,
                pendingRepoSelection,
                pendingPrompt: prompt,
              }
            : s
        )
      );
    },

    /**
     * Create an initializing session (repo already selected, SDK being set up).
     * Used when we know the repo but SDK session creation is in progress.
     */
    createInitializingSession(
      cwd: string,
      model: string,
      thinkingLevel: ThinkingLevel,
      pendingPrompt: string
    ): string {
      const id = crypto.randomUUID();

      const session: SdkSession = {
        id,
        cwd,
        model,
        thinkingLevel,
        messages: [],
        status: 'initializing',
        createdAt: Date.now(),
        accumulatedDurationMs: 0,
        pendingPrompt,
      };

      update(sessions => [...sessions, session]);

      return id;
    },

    /**
     * Complete repo selection for a pending session and initialize the SDK.
     * This transitions the session from 'pending_repo' → 'initializing' → 'querying'.
     * @param cleanedTranscript - Optional cleaned transcript to use instead of the raw pendingPrompt
     */
    async completeRepoSelection(
      id: string,
      cwd: string,
      systemPrompt?: string,
      cleanedTranscript?: string
    ): Promise<void> {
      // Get session info
      let session: SdkSession | undefined;
      subscribe(sessions => {
        session = sessions.find(s => s.id === id);
      })();

      if (!session) {
        throw new Error(`Session ${id} not found`);
      }

      if (session.status !== 'pending_repo') {
        console.warn('[sdkSessions] Session is not pending repo selection:', session.status);
        return;
      }

      // Use cleaned transcript if provided, otherwise fall back to pending prompt
      const pendingPrompt = cleanedTranscript || session.pendingPrompt;

      // Update to initializing state with the selected cwd and update pendingPrompt if cleaned
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? {
                ...s,
                cwd,
                status: 'initializing' as const,
                pendingRepoSelection: undefined,
                pendingPrompt: pendingPrompt,
              }
            : s
        )
      );

      // Now initialize the SDK session
      await this.initializeSession(id, cwd, session.model, session.thinkingLevel, systemPrompt, pendingPrompt);
    },

    /**
     * Initialize a session that was created in initializing state.
     * Sets up listeners, creates backend session, and sends the pending prompt.
     */
    async initializeSession(
      id: string,
      cwd: string,
      model: string,
      thinkingLevel: ThinkingLevel,
      systemPrompt?: string,
      pendingPrompt?: string
    ): Promise<void> {
      await this.ensureSidecarStarted();

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
                      startedAt: s.startedAt || Date.now(),
                      currentWorkStartedAt: s.currentWorkStartedAt || Date.now(),
                      messages: [
                        ...s.messages,
                        { type: 'text' as const, content: e.payload, timestamp: Date.now() },
                      ],
                    }
                  : s
              );
            });
            debouncedSave();
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
            usageStats.trackToolCall(e.payload.tool);
            update(sessions =>
              sessions.map(s =>
                s.id === id
                  ? {
                      ...s,
                      startedAt: s.startedAt || Date.now(),
                      currentWorkStartedAt: s.currentWorkStartedAt || Date.now(),
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
          debouncedSave();
        })
      );

      unlisteners.push(
        await listen(`sdk-done-${id}`, async () => {
          console.log('[sdkSessions] Received done event for session:', id);
          const currentSettings = get(settings);

          let sessionMessages: SdkMessage[] = [];
          let needsAiAnalysis = false;

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              const now = Date.now();
              const workPeriodMs = s.currentWorkStartedAt ? now - s.currentWorkStartedAt : 0;

              const updatedMessages = [...s.messages, { type: 'done' as const, timestamp: now }];
              sessionMessages = updatedMessages;

              // Analyze completion if no outcome yet or if interaction detection is needed
              needsAiAnalysis = isLlmEnabled() && (!s.aiMetadata?.outcome || s.aiMetadata?.needsInteraction === undefined);

              return {
                ...s,
                status: 'idle' as const,
                accumulatedDurationMs: s.accumulatedDurationMs + workPeriodMs,
                currentWorkStartedAt: undefined,
                messages: updatedMessages,
                unread: currentSettings.mark_sessions_unread ? true : s.unread,
              };
            })
          );
          debouncedSave();

          if (currentSettings.audio.play_sound_on_completion) {
            playCompletionSound();
          }

          // Run LLM analysis asynchronously to get outcome and interaction detection (don't block the UI)
          if (needsAiAnalysis && sessionMessages.length > 0) {
            analyzeSessionCompletion(sessionMessages).then(aiMetadata => {
              if (Object.keys(aiMetadata).length > 0) {
                update(sessions =>
                  sessions.map(s =>
                    s.id === id
                      ? { ...s, aiMetadata: { ...s.aiMetadata, ...aiMetadata } }
                      : s
                  )
                );
                debouncedSave();
                console.log('[sdkSessions] AI completion metadata updated:', aiMetadata);
              }
            }).catch(err => {
              console.error('[sdkSessions] Failed to analyze session completion:', err);
            });
          }
        })
      );

      unlisteners.push(
        await listen<string>(`sdk-error-${id}`, (e) => {
          const currentSettings = get(settings);
          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              const now = Date.now();
              const workPeriodMs = s.currentWorkStartedAt ? now - s.currentWorkStartedAt : 0;

              return {
                ...s,
                status: 'error' as const,
                accumulatedDurationMs: s.accumulatedDurationMs + workPeriodMs,
                currentWorkStartedAt: undefined,
                messages: [
                  ...s.messages,
                  { type: 'error' as const, content: e.payload, timestamp: now },
                ],
                unread: currentSettings.mark_sessions_unread ? true : s.unread,
              };
            })
          );
        })
      );

      // Usage tracking listener
      unlisteners.push(
        await listen<SdkUsage>(`sdk-usage-${id}`, (e) => {
          console.log('[sdkSessions] Received usage event:', e.payload);
          const queryUsage = e.payload;

          usageStats.trackTokenUsage(
            queryUsage.inputTokens,
            queryUsage.outputTokens,
            queryUsage.cacheReadTokens,
            queryUsage.cacheCreationTokens,
            queryUsage.totalCostUsd
          );

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              const prevUsage = s.usage || {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheReadTokens: 0,
                totalCacheCreationTokens: 0,
                totalCostUsd: 0,
                totalDurationMs: 0,
                totalDurationApiMs: 0,
                totalTurns: 0,
                contextWindow: queryUsage.contextWindow,
                contextUsagePercent: 0,
                queryUsage: [],
                progressiveInputTokens: 0,
                progressiveOutputTokens: 0,
                progressiveCacheReadTokens: 0,
                progressiveCacheCreationTokens: 0,
              };

              const totalInputTokens = prevUsage.totalInputTokens + queryUsage.inputTokens;
              const totalOutputTokens = prevUsage.totalOutputTokens + queryUsage.outputTokens;
              const contextWindow = queryUsage.contextWindow || prevUsage.contextWindow || 200000;
              const currentContextTokens = queryUsage.inputTokens + queryUsage.outputTokens;
              const contextUsagePercent = Math.min(100, (currentContextTokens / contextWindow) * 100);

              return {
                ...s,
                usage: {
                  totalInputTokens,
                  totalOutputTokens,
                  totalCacheReadTokens: prevUsage.totalCacheReadTokens + queryUsage.cacheReadTokens,
                  totalCacheCreationTokens: prevUsage.totalCacheCreationTokens + queryUsage.cacheCreationTokens,
                  totalCostUsd: prevUsage.totalCostUsd + queryUsage.totalCostUsd,
                  totalDurationMs: prevUsage.totalDurationMs + queryUsage.durationMs,
                  totalDurationApiMs: prevUsage.totalDurationApiMs + queryUsage.durationApiMs,
                  totalTurns: prevUsage.totalTurns + queryUsage.numTurns,
                  contextWindow,
                  contextUsagePercent,
                  queryUsage: [...prevUsage.queryUsage, queryUsage],
                  progressiveInputTokens: 0,
                  progressiveOutputTokens: 0,
                  progressiveCacheReadTokens: 0,
                  progressiveCacheCreationTokens: 0,
                },
              };
            })
          );
        })
      );

      // Progressive usage listener
      unlisteners.push(
        await listen<SdkProgressiveUsage>(`sdk-progressive-usage-${id}`, (e) => {
          const progressiveUsage = e.payload;

          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              const prevUsage = s.usage || {
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheReadTokens: 0,
                totalCacheCreationTokens: 0,
                totalCostUsd: 0,
                totalDurationMs: 0,
                totalDurationApiMs: 0,
                totalTurns: 0,
                contextWindow: 200000,
                contextUsagePercent: 0,
                queryUsage: [],
                progressiveInputTokens: 0,
                progressiveOutputTokens: 0,
                progressiveCacheReadTokens: 0,
                progressiveCacheCreationTokens: 0,
              };

              const progressiveInputTokens = prevUsage.progressiveInputTokens + progressiveUsage.inputTokens;
              const progressiveOutputTokens = prevUsage.progressiveOutputTokens + progressiveUsage.outputTokens;

              const liveCurrentTokens = progressiveInputTokens + progressiveOutputTokens;
              const contextUsagePercent = Math.min(100, (liveCurrentTokens / prevUsage.contextWindow) * 100);

              return {
                ...s,
                usage: {
                  ...prevUsage,
                  contextUsagePercent,
                  progressiveInputTokens,
                  progressiveOutputTokens,
                  progressiveCacheReadTokens: prevUsage.progressiveCacheReadTokens + progressiveUsage.cacheReadTokens,
                  progressiveCacheCreationTokens: prevUsage.progressiveCacheCreationTokens + progressiveUsage.cacheCreationTokens,
                },
              };
            })
          );
        })
      );

      // Subagent listeners
      unlisteners.push(
        await listen<{ agentId: string; agentType: string }>(`sdk-subagent-start-${id}`, (e) => {
          console.log('[sdkSessions] Subagent started:', e.payload.agentType, 'id:', e.payload.agentId);
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    messages: [
                      ...s.messages,
                      {
                        type: 'subagent_start' as const,
                        agentId: e.payload.agentId,
                        agentType: e.payload.agentType,
                        timestamp: Date.now(),
                      },
                    ],
                  }
                : s
            )
          );
          debouncedSave();
        })
      );

      unlisteners.push(
        await listen<{ agentId: string; transcriptPath: string }>(`sdk-subagent-stop-${id}`, (e) => {
          console.log('[sdkSessions] Subagent stopped:', e.payload.agentId);
          update(sessions =>
            sessions.map(s =>
              s.id === id
                ? {
                    ...s,
                    messages: [
                      ...s.messages,
                      {
                        type: 'subagent_stop' as const,
                        agentId: e.payload.agentId,
                        transcriptPath: e.payload.transcriptPath,
                        timestamp: Date.now(),
                      },
                    ],
                  }
                : s
            )
          );
          debouncedSave();
        })
      );

      listeners.set(id, unlisteners);

      // Resolve "auto" model to a valid model before sending to backend
      const currentSettings = get(settings);
      const resolvedModel = resolveModelForApi(model, currentSettings.enabled_models);
      if (resolvedModel !== model) {
        console.log('[sdkSessions] Resolved auto model to:', resolvedModel);
        // Update the session's model to the resolved value
        update(sessions =>
          sessions.map(s =>
            s.id === id
              ? { ...s, model: resolvedModel }
              : s
          )
        );
      }

      // Create the session on the backend
      console.log('[sdkSessions] Creating session with id:', id, 'cwd:', cwd, 'model:', resolvedModel, 'systemPrompt:', systemPrompt ? 'yes' : 'no');
      await invoke('create_sdk_session', { id, cwd, model: resolvedModel, systemPrompt: systemPrompt ?? null });
      console.log('[sdkSessions] Session created');

      // Mark session as live
      liveSessions.add(id);

      // Apply initial thinking level if set
      if (thinkingLevel) {
        const maxThinkingTokens = THINKING_BUDGETS[thinkingLevel];
        console.log('[sdkSessions] Applying initial thinking level:', thinkingLevel, '(', maxThinkingTokens, 'tokens)');
        await invoke('update_sdk_thinking', { id, maxThinkingTokens });
      }

      // Track session creation for usage stats
      usageStats.trackSession('sdk', resolvedModel, cwd);

      // If there's a pending prompt, send it
      if (pendingPrompt) {
        await this.sendPrompt(id, pendingPrompt);
      } else {
        // Just transition to idle if no pending prompt
        update(sessions =>
          sessions.map(s =>
            s.id === id
              ? { ...s, status: 'idle' as const, pendingPrompt: undefined }
              : s
          )
        );
      }
    },

    /**
     * Update session status.
     */
    updateStatus(id: string, status: SdkSession['status']): void {
      update(sessions =>
        sessions.map(s =>
          s.id === id
            ? { ...s, status }
            : s
        )
      );
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

// App session usage - cumulative usage across all SDK sessions since app launch
export const appSessionUsage = derived(
  sdkSessions,
  ($sdkSessions) => {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCostUsd = 0;
    let progressiveInputTokens = 0;
    let progressiveOutputTokens = 0;

    for (const session of $sdkSessions) {
      if (session.usage) {
        totalInputTokens += session.usage.totalInputTokens;
        totalOutputTokens += session.usage.totalOutputTokens;
        totalCacheReadTokens += session.usage.totalCacheReadTokens;
        totalCacheCreationTokens += session.usage.totalCacheCreationTokens;
        totalCostUsd += session.usage.totalCostUsd;
        progressiveInputTokens += session.usage.progressiveInputTokens;
        progressiveOutputTokens += session.usage.progressiveOutputTokens;
      }
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      totalCostUsd,
      progressiveInputTokens,
      progressiveOutputTokens,
    };
  }
);
