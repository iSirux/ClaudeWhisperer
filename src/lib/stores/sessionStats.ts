import { derived, writable } from 'svelte/store';
import { sessions } from './sessions';
import { sdkSessions, type SdkSession } from './sdkSessions';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';

// Session stats that get broadcast across windows
export interface SessionStatsData {
  active: number;
  done: number;
  error: number;
  total: number;
}

// Helper to determine if SDK session is in active state
function isSdkSessionActive(session: SdkSession): boolean {
  const messages = session.messages;
  if (session.status === 'querying') {
    // Check if it's actively working (has tool_start or text messages)
    const hasActivity = messages.some(m =>
      m.type === 'tool_start' || m.type === 'text'
    );
    return hasActivity;
  }
  return false;
}

// Helper to determine if SDK session is done/idle
function isSdkSessionDone(session: SdkSession): boolean {
  const messages = session.messages;
  const lastMsg = messages.at(-1);

  if (session.status === 'idle' && messages.length > 0) {
    return lastMsg?.type === 'done' || lastMsg?.type === 'tool_result';
  }

  return false;
}

// Helper to determine if SDK session has error
function isSdkSessionError(session: SdkSession): boolean {
  return session.status === 'error';
}

// Derived store for active sessions count (PTY + SDK)
export const activeSessions = derived(
  [sessions, sdkSessions],
  ([$sessions, $sdkSessions]) => {
    const activePty = $sessions.filter(s =>
      s.status === 'Starting' || s.status === 'Running'
    ).length;

    const activeSdk = $sdkSessions.filter(isSdkSessionActive).length;

    return activePty + activeSdk;
  }
);

// Derived store for completed/done sessions count (PTY + SDK)
export const doneSessions = derived(
  [sessions, sdkSessions],
  ([$sessions, $sdkSessions]) => {
    const completedPty = $sessions.filter(s =>
      s.status === 'Completed'
    ).length;

    const doneSdk = $sdkSessions.filter(isSdkSessionDone).length;

    return completedPty + doneSdk;
  }
);

// Derived store for error/failed sessions count (PTY + SDK)
export const errorSessions = derived(
  [sessions, sdkSessions],
  ([$sessions, $sdkSessions]) => {
    const failedPty = $sessions.filter(s =>
      s.status === 'Failed'
    ).length;

    const errorSdk = $sdkSessions.filter(isSdkSessionError).length;

    return failedPty + errorSdk;
  }
);

// Total sessions count
export const totalSessions = derived(
  [sessions, sdkSessions],
  ([$sessions, $sdkSessions]) => {
    return $sessions.length + $sdkSessions.length;
  }
);

// Combined stats for broadcasting
export const sessionStats = derived(
  [activeSessions, doneSessions, errorSessions, totalSessions],
  ([$active, $done, $error, $total]) => ({
    active: $active,
    done: $done,
    error: $error,
    total: $total,
  })
);

// Broadcast session stats to other windows
let lastBroadcast: SessionStatsData = { active: 0, done: 0, error: 0, total: 0 };

export function setupSessionStatsBroadcast() {
  sessionStats.subscribe((stats) => {
    // Only broadcast if changed
    if (
      stats.active !== lastBroadcast.active ||
      stats.done !== lastBroadcast.done ||
      stats.error !== lastBroadcast.error ||
      stats.total !== lastBroadcast.total
    ) {
      lastBroadcast = stats;
      emit('session-stats-update', stats).catch(console.error);
    }
  });
}

// Store for receiving session stats (used by overlay windows)
function createRemoteSessionStats() {
  const { subscribe, set } = writable<SessionStatsData>({
    active: 0,
    done: 0,
    error: 0,
    total: 0,
  });

  let unlisten: UnlistenFn | null = null;

  return {
    subscribe,
    async init() {
      unlisten = await listen<SessionStatsData>('session-stats-update', (event) => {
        set(event.payload);
      });
    },
    cleanup() {
      unlisten?.();
      unlisten = null;
    },
  };
}

export const remoteSessionStats = createRemoteSessionStats();
