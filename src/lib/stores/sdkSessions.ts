import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { settings } from './settings';
import { playCompletionSound } from '$lib/utils/sound';
import { usageStats } from './usageStats';

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

export interface SdkSession {
  id: string;
  cwd: string;
  model: string; // Per-session model (can differ from global default_model)
  messages: SdkMessage[];
  status: 'idle' | 'querying' | 'done' | 'error';
  createdAt: number;
  startedAt?: number; // Timestamp when first prompt was sent (deprecated, kept for compatibility)
  // Timer-based duration tracking (survives session restore)
  accumulatedDurationMs: number; // Total accumulated work time in milliseconds
  currentWorkStartedAt?: number; // Timestamp when current work period started (undefined when idle)
  usage?: SdkSessionUsage; // Token usage tracking
  unread?: boolean; // Whether the session has completed but user hasn't viewed it yet
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

    async createSession(cwd: string, model: string, systemPrompt?: string): Promise<string> {
      await this.ensureSidecarStarted();

      const id = crypto.randomUUID();

      const session: SdkSession = {
        id,
        cwd,
        model,
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
          const currentSettings = get(settings);
          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              // Calculate elapsed time for this work period and add to accumulated
              const now = Date.now();
              const workPeriodMs = s.currentWorkStartedAt ? now - s.currentWorkStartedAt : 0;

              return {
                ...s,
                status: 'idle' as const,
                // Accumulate the work time and reset the current work timer
                accumulatedDurationMs: s.accumulatedDurationMs + workPeriodMs,
                currentWorkStartedAt: undefined,
                messages: [...s.messages, { type: 'done' as const, timestamp: now }],
                // Mark as unread if the setting is enabled
                unread: currentSettings.mark_sessions_unread ? true : s.unread,
              };
            })
          );

          // Play completion sound if enabled
          if (currentSettings.audio.play_sound_on_completion) {
            playCompletionSound();
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

              // Calculate cumulative totals
              const totalInputTokens = prevUsage.totalInputTokens + queryUsage.inputTokens;
              const totalOutputTokens = prevUsage.totalOutputTokens + queryUsage.outputTokens;
              const totalTokens = totalInputTokens + totalOutputTokens;
              const contextWindow = queryUsage.contextWindow || prevUsage.contextWindow || 200000;
              const contextUsagePercent = Math.min(100, (totalTokens / contextWindow) * 100);

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

              // Calculate live context usage (cumulative + progressive)
              const liveInputTokens = prevUsage.totalInputTokens + progressiveInputTokens;
              const liveOutputTokens = prevUsage.totalOutputTokens + progressiveOutputTokens;
              const liveTotalTokens = liveInputTokens + liveOutputTokens;
              const contextUsagePercent = Math.min(100, (liveTotalTokens / prevUsage.contextWindow) * 100);

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
        })
      );

      listeners.set(id, unlisteners);

      // Create the session on the backend
      console.log('[sdkSessions] Creating session with id:', id, 'cwd:', cwd, 'model:', model, 'systemPrompt:', systemPrompt ? 'yes' : 'no');
      await invoke('create_sdk_session', { id, cwd, model, systemPrompt: systemPrompt ?? null });
      console.log('[sdkSessions] Session created');

      // Mark session as live (registered with backend and has listeners)
      liveSessions.add(id);

      // Track session creation for usage stats
      usageStats.trackSession('sdk', model, cwd);

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
          const currentSettings = get(settings);
          update(sessions =>
            sessions.map(s => {
              if (s.id !== id) return s;

              // Calculate elapsed time for this work period and add to accumulated
              const now = Date.now();
              const workPeriodMs = s.currentWorkStartedAt ? now - s.currentWorkStartedAt : 0;

              return {
                ...s,
                status: 'idle' as const,
                // Accumulate the work time and reset the current work timer
                accumulatedDurationMs: s.accumulatedDurationMs + workPeriodMs,
                currentWorkStartedAt: undefined,
                messages: [...s.messages, { type: 'done' as const, timestamp: now }],
                // Mark as unread if the setting is enabled
                unread: currentSettings.mark_sessions_unread ? true : s.unread,
              };
            })
          );

          if (currentSettings.audio.play_sound_on_completion) {
            playCompletionSound();
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
              const totalTokens = totalInputTokens + totalOutputTokens;
              const contextWindow = queryUsage.contextWindow || prevUsage.contextWindow || 200000;
              const contextUsagePercent = Math.min(100, (totalTokens / contextWindow) * 100);

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

              const liveInputTokens = prevUsage.totalInputTokens + progressiveInputTokens;
              const liveOutputTokens = prevUsage.totalOutputTokens + progressiveOutputTokens;
              const liveTotalTokens = liveInputTokens + liveOutputTokens;
              const contextUsagePercent = Math.min(100, (liveTotalTokens / prevUsage.contextWindow) * 100);

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
        })
      );

      listeners.set(id, unlisteners);

      // Convert message history to the format expected by the sidecar
      const historyMessages = convertToHistoryMessages(session.messages);
      console.log('[sdkSessions] Converted', session.messages.length, 'messages to', historyMessages.length, 'history messages');

      // Register session with backend, passing conversation history for restored sessions
      await invoke('create_sdk_session', {
        id,
        cwd: session.cwd,
        model: session.model,
        systemPrompt: null,
        messages: historyMessages.length > 0 ? historyMessages : null,
      });

      // Mark session as live
      liveSessions.add(id);

      console.log('[sdkSessions] Restored session reinitialized:', id, 'with', historyMessages.length, 'history messages');
    },

    async sendPrompt(id: string, prompt: string, images?: SdkImageContent[]): Promise<void> {
      console.log('[sdkSessions] sendPrompt called for session:', id, 'prompt:', prompt.slice(0, 50), 'images:', images?.length ?? 0);

      // Ensure session is live (handles restored sessions that need reinitialization)
      await this.ensureSessionLive(id);

      // Check if there's already a query in progress - if so, stop it first
      // This prevents race conditions where the old query's 'done' event overwrites our new 'querying' status
      let isCurrentlyQuerying = false;
      subscribe(sessions => {
        const session = sessions.find(s => s.id === id);
        if (session && session.status === 'querying') {
          isCurrentlyQuerying = true;
        }
      })();

      if (isCurrentlyQuerying) {
        console.log('[sdkSessions] Previous query still in progress, stopping it first');
        try {
          await invoke('stop_sdk_query', { id });
          console.log('[sdkSessions] Previous query stopped');
        } catch (error) {
          console.warn('[sdkSessions] Failed to stop previous query:', error);
          // Continue anyway - the new query will proceed
        }
      }

      // Get session cwd for tracking
      let sessionCwd: string | undefined;
      subscribe(sessions => {
        const session = sessions.find(s => s.id === id);
        sessionCwd = session?.cwd;
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
              }
            : s
        )
      );

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

      // Only send to backend if session is live
      // For restored sessions, the model will be used when session is reinitialized
      if (!liveSessions.has(id)) {
        console.log('[sdkSessions] Session not live, model update stored locally:', model);
        return;
      }

      // Send the model update to the backend
      try {
        await invoke('update_sdk_model', { id, model });
        console.log('[sdkSessions] Model updated to:', model);
      } catch (error) {
        console.error('Failed to update SDK model:', error);
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
