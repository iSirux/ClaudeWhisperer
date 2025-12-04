<script lang="ts">
  import { getShortModelName, getModelBadgeBgColor, getModelTextColor } from '$lib/utils/modelColors';
  import type { SessionsGridSize } from '$lib/stores/settings';
  import type { SessionAiMetadata } from '$lib/stores/sdkSessions';

  interface DisplaySession {
    id: string;
    type: 'pty' | 'sdk';
    status: string;
    statusDetail?: string;
    prompt: string;
    repoPath: string;
    model?: string;
    createdAt: number;
    accumulatedDurationMs: number;
    currentWorkStartedAt?: number;
    isFinished: boolean;
    unread?: boolean;
    latestMessage?: string;
    aiMetadata?: SessionAiMetadata;
    branch?: string;
  }

  interface Props {
    session: DisplaySession;
    size: SessionsGridSize;
    isActive: boolean;
    now: number;
    showBranch: boolean;
    showLatestMessage: boolean;
    promptRows: number;
    responseRows: number;
    onselect: () => void;
    onclose: (event: MouseEvent) => void;
  }

  let {
    session,
    size,
    isActive,
    now,
    showBranch,
    showLatestMessage,
    promptRows,
    responseRows,
    onselect,
    onclose
  }: Props = $props();

  // Format elapsed time in seconds to human-readable string
  function formatDuration(elapsedSeconds: number): string {
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

  function getElapsedTime(): string | null {
    if (session.accumulatedDurationMs === 0 && !session.currentWorkStartedAt) {
      return null;
    }

    let totalMs = session.accumulatedDurationMs;

    if (session.currentWorkStartedAt && !session.isFinished) {
      const liveElapsedMs = (now * 1000) - session.currentWorkStartedAt;
      totalMs += Math.max(0, liveElapsedMs);
    }

    const elapsedSeconds = Math.floor(totalMs / 1000);
    return formatDuration(elapsedSeconds);
  }

  function getRepoName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'Starting': return 'text-yellow-400';
      case 'pending_transcription': return 'text-violet-400';
      case 'pending_repo': return 'text-amber-400';
      case 'initializing': return 'text-yellow-400';
      case 'Running': case 'querying': case 'tool': case 'thinking': case 'responding': case 'subagent': return 'text-emerald-400';
      case 'Completed': case 'idle': case 'done': return 'text-blue-400';
      case 'new': return 'text-text-muted';
      case 'Failed': case 'error': case 'transcription_error': return 'text-red-400';
      default: return 'text-text-muted';
    }
  }

  function getStatusBg(status: string): string {
    switch (status) {
      case 'Starting': return 'bg-yellow-400';
      case 'pending_transcription': return 'bg-violet-400';
      case 'pending_repo': return 'bg-amber-400';
      case 'initializing': return 'bg-yellow-400';
      case 'Running': case 'querying': case 'tool': case 'thinking': case 'responding': case 'subagent': return 'bg-emerald-400';
      case 'Completed': case 'idle': case 'done': return 'bg-blue-400';
      case 'new': return 'bg-slate-400';
      case 'Failed': case 'error': case 'transcription_error': return 'bg-red-400';
      default: return 'bg-text-muted';
    }
  }

  function getStatusLabel(status: string, detail?: string): string {
    switch (status) {
      case 'pending_transcription':
        if (detail === 'recording') return 'Recording';
        if (detail === 'transcribing') return 'Transcribing';
        if (detail === 'processing') return 'Processing';
        return 'Pending';
      case 'transcription_error': return 'Retry?';
      case 'pending_repo': return 'Select Repo';
      case 'initializing': return 'Starting';
      case 'Running': case 'querying': return 'Active';
      case 'tool': return detail || 'Tool';
      case 'subagent': return detail || 'Agent';
      case 'thinking': return 'Thinking';
      case 'responding': return 'Responding';
      case 'idle': return 'Ready';
      case 'done': return 'Done';
      case 'new': return 'New';
      default: return status;
    }
  }

  function isAnimating(status: string): boolean {
    return ['Running', 'Starting', 'querying', 'tool', 'thinking', 'responding', 'subagent'].includes(status);
  }

  // Size-based styling
  let sizeClasses = $derived.by(() => {
    switch (size) {
      case 'small':
        return {
          padding: 'p-2',
          title: 'text-xs',
          text: 'text-[10px]',
          badge: 'text-[8px] px-1 py-0.5',
          dot: 'w-1.5 h-1.5',
          icon: 'w-3 h-3',
          gap: 'gap-1',
        };
      case 'large':
        return {
          padding: 'p-4',
          title: 'text-base',
          text: 'text-sm',
          badge: 'text-xs px-2 py-1',
          dot: 'w-2.5 h-2.5',
          icon: 'w-4 h-4',
          gap: 'gap-3',
        };
      default: // medium
        return {
          padding: 'p-3',
          title: 'text-sm',
          text: 'text-xs',
          badge: 'text-[10px] px-1.5 py-0.5',
          dot: 'w-2 h-2',
          icon: 'w-3.5 h-3.5',
          gap: 'gap-2',
        };
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="session-card {sizeClasses.padding} rounded-lg border transition-all cursor-pointer hover:shadow-md {isActive ? 'active border-accent bg-accent-subtle' : 'border-border bg-surface-elevated hover:bg-surface-elevated hover:border-accent-muted'}"
  class:unread={session.unread}
  onmousedown={(e) => {
    if (e.button === 1) {
      e.preventDefault();
      onclose(e);
    }
  }}
  onclick={onselect}
>
  <!-- Header row -->
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center {sizeClasses.gap}">
      {#if session.type === 'sdk' && session.model}
        <span class="{sizeClasses.badge} font-medium {getModelBadgeBgColor(session.model)} {getModelTextColor(session.model)} rounded">{getShortModelName(session.model)}</span>
      {/if}
      <div class="relative">
        <div class="{sizeClasses.dot} rounded-full {getStatusBg(session.status)}"></div>
        {#if isAnimating(session.status)}
          <div class="absolute inset-0 {sizeClasses.dot} rounded-full {getStatusBg(session.status)} animate-ping opacity-75"></div>
        {/if}
      </div>
      {#if session.aiMetadata?.needsInteraction}
        {@const urgency = session.aiMetadata.interactionUrgency || 'low'}
        <span
          class="{sizeClasses.text} font-medium flex items-center gap-0.5 {urgency === 'high' ? 'text-orange-400' : urgency === 'medium' ? 'text-yellow-400' : 'text-blue-400'}"
          title={session.aiMetadata.interactionReason || 'Needs your input'}
        >
          <svg class="{sizeClasses.icon}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {session.aiMetadata.waitingFor || 'Input needed'}
        </span>
      {:else}
        <span class="{sizeClasses.text} font-medium {getStatusColor(session.status)}">{getStatusLabel(session.status, session.statusDetail)}</span>
      {/if}
    </div>
    <div class="flex items-center {sizeClasses.gap}">
      {#if getElapsedTime() !== null}
        <span class="{sizeClasses.text} text-text-muted font-mono tabular-nums">{getElapsedTime()}</span>
      {/if}
      <button
        class="text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded p-0.5 transition-colors"
        onclick={(e) => { e.stopPropagation(); onclose(e); }}
        title="Close session"
      >
        <svg class="{sizeClasses.icon}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Session name or prompt text -->
  {#if session.aiMetadata?.name}
    <div class="mb-1">
      <span class="{sizeClasses.title} font-medium text-text-primary">{session.aiMetadata.name}</span>
    </div>
    {#if session.aiMetadata.outcome && size !== 'small'}
      <p class="{sizeClasses.text} text-text-muted leading-snug mb-1.5" title={session.aiMetadata.outcome}>
        {session.aiMetadata.outcome}
      </p>
    {/if}
  {:else}
    <p
      class="{sizeClasses.title} text-text-primary leading-snug mb-1.5 select-text overflow-hidden"
      style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: {promptRows};"
      title={session.prompt || 'Interactive session'}
    >
      {#if session.prompt}
        {session.prompt}
      {:else}
        <span class="text-text-muted italic">{session.type === 'sdk' ? 'SDK Session' : 'Interactive session'}</span>
      {/if}
    </p>
  {/if}

  <!-- Latest message preview (SDK sessions only, hide when showing outcome) -->
  {#if showLatestMessage && session.type === 'sdk' && session.latestMessage && size !== 'small' && !session.aiMetadata?.outcome}
    <p
      class="{sizeClasses.text} text-text-muted leading-snug mb-1.5 italic overflow-hidden"
      style="display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: {responseRows};"
      title={session.latestMessage}
    >
      {session.latestMessage}
    </p>
  {/if}

  <!-- Repo name, branch -->
  <div class="flex items-center gap-1.5 text-text-muted">
    <svg class="{sizeClasses.icon} flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
    <span class="{sizeClasses.text} truncate">{getRepoName(session.repoPath)}</span>
    {#if showBranch && session.branch}
      <span class="{sizeClasses.text} text-text-muted">·</span>
      <span class="{sizeClasses.text} text-blue-400/70" title="Git branch: {session.branch}">{session.branch}</span>
    {/if}
  </div>
</div>

<style>
  .session-card {
    position: relative;
  }

  /* Active session - purple/accent styling */
  .session-card.active {
    background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }

  .session-card:not(.active):hover {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
  }

  /* Unread session - blue border with subtle tint */
  .session-card.unread:not(.active) {
    background-color: rgba(59, 130, 246, 0.08);
    border-color: rgb(59, 130, 246);
  }

  .session-card.unread:not(.active):hover {
    border-color: rgb(59, 130, 246);
    background-color: rgba(59, 130, 246, 0.12);
  }

  /* Active + unread - active takes visual precedence, add blue inner glow */
  .session-card.unread.active {
    box-shadow: inset 0 0 0 2px rgba(59, 130, 246, 0.5);
  }

  /* Custom classes for accent colors with opacity */
  :global(.bg-accent-subtle) {
    background-color: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }

  :global(.border-accent-muted) {
    border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
  }
</style>
