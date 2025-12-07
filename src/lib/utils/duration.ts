// Duration formatting utilities

/**
 * Format elapsed time in seconds to human-readable string
 * @param elapsedSeconds - Number of seconds elapsed
 * @returns Formatted string like "5s", "2m 30s", "1h 15m"
 */
export function formatDuration(elapsedSeconds: number): string {
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;

  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}h ${remainingMins}m`;
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Get elapsed time for SDK sessions using timer-based tracking
 * @param accumulatedDurationMs - Total accumulated work time in milliseconds
 * @param currentWorkStartedAt - Timestamp when current work period started (if working)
 * @param isFinished - Whether the session is finished working
 * @param nowSeconds - Current time in seconds (for live updates)
 * @returns Formatted duration string, or null if session hasn't started working yet
 */
export function getElapsedTime(
  accumulatedDurationMs: number,
  currentWorkStartedAt: number | undefined,
  isFinished: boolean,
  nowSeconds: number
): string | null {
  // If no work has been done yet (no accumulated time and not currently working)
  if (accumulatedDurationMs === 0 && !currentWorkStartedAt) {
    return null;
  }

  let totalMs = accumulatedDurationMs;

  // If currently working, add the live elapsed time
  if (currentWorkStartedAt && !isFinished) {
    const liveElapsedMs = (nowSeconds * 1000) - currentWorkStartedAt;
    totalMs += Math.max(0, liveElapsedMs);
  }

  const elapsedSeconds = Math.floor(totalMs / 1000);
  return formatDuration(elapsedSeconds);
}

/**
 * Get elapsed time for PTY sessions using legacy timestamp-based tracking
 * @param startedAt - When the session started (seconds)
 * @param endedAt - When the session ended (seconds), or undefined if still running
 * @param nowSeconds - Current time in seconds (for live updates)
 * @returns Formatted duration string, or null if session hasn't started yet
 */
export function getLegacyElapsedTime(
  startedAt: number | undefined,
  endedAt: number | undefined,
  nowSeconds: number
): string | null {
  if (startedAt === undefined) {
    return null; // Timer not started yet
  }
  const endTime = endedAt ?? nowSeconds;
  const elapsed = Math.max(0, endTime - startedAt);
  return formatDuration(elapsed);
}

/**
 * Extract repository name from a path
 * @param path - Full repository path
 * @returns The last segment of the path (repo name)
 */
export function getRepoName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}
