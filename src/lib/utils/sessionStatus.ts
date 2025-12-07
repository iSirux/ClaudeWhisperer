// Session status utilities for consistent status styling across the app

/**
 * Status categories for grouping related statuses
 */
export type StatusCategory = 'pending' | 'active' | 'ready' | 'error';

/**
 * Get the status category for sorting and grouping
 */
export function getStatusCategory(status: string): StatusCategory {
  switch (status) {
    case 'setup':
    case 'pending_transcription':
    case 'transcription_error':
    case 'pending_repo':
    case 'initializing':
    case 'Starting':
      return 'pending';

    case 'Running':
    case 'querying':
    case 'tool':
    case 'thinking':
    case 'responding':
    case 'subagent':
      return 'active';

    case 'Failed':
    case 'error':
      return 'error';

    default:
      return 'ready';
  }
}

/**
 * Get the text color class for a status
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'setup':
      return 'text-text-muted';
    case 'Starting':
    case 'initializing':
      return 'text-yellow-400';
    case 'pending_transcription':
      return 'text-violet-400';
    case 'pending_repo':
      return 'text-amber-400';
    case 'Running':
    case 'querying':
    case 'tool':
    case 'thinking':
    case 'responding':
    case 'subagent':
      return 'text-emerald-400';
    case 'Completed':
    case 'idle':
    case 'done':
      return 'text-blue-400';
    case 'new':
      return 'text-text-muted';
    case 'Failed':
    case 'error':
    case 'transcription_error':
      return 'text-red-400';
    default:
      return 'text-text-muted';
  }
}

/**
 * Get the background color class for a status indicator dot
 */
export function getStatusBgColor(status: string): string {
  switch (status) {
    case 'setup':
      return 'bg-slate-400';
    case 'Starting':
    case 'initializing':
      return 'bg-yellow-400';
    case 'pending_transcription':
      return 'bg-violet-400';
    case 'pending_repo':
      return 'bg-amber-400';
    case 'Running':
    case 'querying':
    case 'tool':
    case 'thinking':
    case 'responding':
    case 'subagent':
      return 'bg-emerald-400';
    case 'Completed':
    case 'idle':
    case 'done':
      return 'bg-blue-400';
    case 'new':
      return 'bg-slate-400';
    case 'Failed':
    case 'error':
    case 'transcription_error':
      return 'bg-red-400';
    default:
      return 'bg-text-muted';
  }
}

/**
 * Get the human-readable label for a status
 */
export function getStatusLabel(status: string, detail?: string): string {
  switch (status) {
    case 'setup':
      return 'New Session';
    case 'pending_transcription':
      // detail contains the sub-status: 'recording', 'transcribing', 'processing'
      if (detail === 'recording') return 'Recording';
      if (detail === 'transcribing') return 'Transcribing';
      if (detail === 'processing') return 'Processing';
      return 'Pending';
    case 'transcription_error':
      return 'Retry?';
    case 'pending_repo':
      return 'Select Repo';
    case 'initializing':
    case 'Starting':
      return 'Starting';
    case 'Running':
    case 'querying':
      return 'Active';
    case 'tool':
      return detail || 'Tool';
    case 'subagent':
      return detail || 'Agent';
    case 'thinking':
      return 'Thinking';
    case 'responding':
      return 'Responding';
    case 'idle':
      return 'Ready';
    case 'done':
    case 'Completed':
      return 'Done';
    case 'new':
      return 'New';
    case 'Failed':
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

/**
 * Check if a status should show an animation (pulsing dot)
 */
export function isStatusAnimating(status: string): boolean {
  return [
    'Running',
    'Starting',
    'querying',
    'tool',
    'thinking',
    'responding',
    'subagent'
  ].includes(status);
}

/**
 * Check if a session is actively working based on its status
 */
export function isActivelyWorking(status: string): boolean {
  return [
    'Starting',
    'Running',
    'querying',
    'tool',
    'thinking',
    'responding',
    'subagent'
  ].includes(status);
}

/**
 * Check if a status indicates the session is finished
 */
export function isFinishedStatus(status: string): boolean {
  return ['done', 'idle', 'error', 'new', 'Completed', 'Failed'].includes(status);
}

/**
 * Status sort order for StatusThenChronological sorting
 * Lower numbers appear first
 */
export function getStatusSortOrder(status: string): number {
  switch (status) {
    // Setup and pending at top (user action needed or in progress)
    case 'setup':
      return -2;
    case 'pending_transcription':
    case 'transcription_error':
      return -1;
    case 'pending_repo':
    case 'initializing':
    case 'Starting':
    case 'Running':
    case 'querying':
    case 'tool':
    case 'thinking':
    case 'responding':
    case 'subagent':
      return 0;
    case 'idle':
    case 'new':
      return 1;
    case 'Completed':
    case 'done':
      return 2;
    case 'Failed':
    case 'error':
      return 3;
    default:
      return 4;
  }
}
