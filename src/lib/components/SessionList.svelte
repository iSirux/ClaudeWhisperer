<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { sessions, activeSessionId, type TerminalSession } from '$lib/stores/sessions';
  import { sdkSessions, activeSdkSessionId } from '$lib/stores/sdkSessions';
  import { settings, activeRepo } from '$lib/stores/settings';

  async function createNewSession() {
    try {
      if ($settings.terminal_mode === 'Sdk') {
        // SDK mode: create SDK session
        const repoPath = $activeRepo?.path || '.';
        const sessionId = await sdkSessions.createSession(repoPath);
        activeSdkSessionId.set(sessionId);
        activeSessionId.set(null); // Clear PTY selection
      } else {
        // PTY mode: create interactive session
        const sessionId = await sessions.createInteractiveSession();
        activeSessionId.set(sessionId);
        activeSdkSessionId.set(null); // Clear SDK selection
      }
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }

  let now = $state(Math.floor(Date.now() / 1000));
  let interval: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    interval = setInterval(() => {
      now = Math.floor(Date.now() / 1000);
    }, 1000);
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  // Reactive elapsed time formatter that depends on `now`
  function getElapsedTime(createdAt: number): string {
    const elapsed = Math.max(0, now - createdAt);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;

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

  // Unified session type for display
  interface DisplaySession {
    id: string;
    type: 'pty' | 'sdk';
    status: string;
    prompt: string;
    repoPath: string;
    createdAt: number;
  }

  function selectPtySession(id: string) {
    activeSessionId.set(id);
    activeSdkSessionId.set(null);
  }

  function selectSdkSession(id: string) {
    activeSdkSessionId.set(id);
    activeSessionId.set(null);
  }

  function closePtySession(id: string, event: MouseEvent) {
    event.stopPropagation();
    sessions.closeSession(id);
    if ($activeSessionId === id) {
      activeSessionId.set(null);
    }
  }

  function closeSdkSession(id: string, event: MouseEvent) {
    event.stopPropagation();
    sdkSessions.closeSession(id);
    if ($activeSdkSessionId === id) {
      activeSdkSessionId.set(null);
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'Starting': return 'text-yellow-400';
      case 'Running': case 'querying': return 'text-emerald-400';
      case 'Completed': case 'idle': case 'done': return 'text-blue-400';
      case 'Failed': case 'error': return 'text-red-400';
      default: return 'text-text-muted';
    }
  }

  function getStatusBg(status: string): string {
    switch (status) {
      case 'Starting': return 'bg-yellow-400';
      case 'Running': case 'querying': return 'bg-emerald-400';
      case 'Completed': case 'idle': case 'done': return 'bg-blue-400';
      case 'Failed': case 'error': return 'bg-red-400';
      default: return 'bg-text-muted';
    }
  }

  function getStatusLabel(status: string): string {
    switch (status) {
      case 'Running': case 'querying': return 'Active';
      case 'idle': return 'Ready';
      case 'done': return 'Done';
      default: return status;
    }
  }

  function truncatePrompt(prompt: string, maxLength: number = 60): string {
    if (prompt.length <= maxLength) return prompt;
    return prompt.slice(0, maxLength) + '...';
  }

  function getRepoName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  // Combine PTY and SDK sessions into unified list
  let allSessions = $derived((): DisplaySession[] => {
    const ptySessions: DisplaySession[] = $sessions.map(s => ({
      id: s.id,
      type: 'pty' as const,
      status: s.status,
      prompt: s.prompt,
      repoPath: s.repo_path,
      createdAt: s.created_at,
    }));

    const sdkSessionsList: DisplaySession[] = $sdkSessions.map(s => ({
      id: s.id,
      type: 'sdk' as const,
      status: s.status,
      prompt: s.messages.find(m => m.type === 'text')?.content?.slice(0, 100) || 'SDK Session',
      repoPath: s.cwd,
      createdAt: Math.floor(s.createdAt / 1000),
    }));

    return [...ptySessions, ...sdkSessionsList].sort((a, b) => {
      const statusOrder: Record<string, number> = {
        Starting: 0, Running: 0, querying: 0,
        idle: 1, Completed: 2, done: 2,
        Failed: 3, error: 3
      };
      const statusDiff = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
      if (statusDiff !== 0) return statusDiff;
      return b.createdAt - a.createdAt;
    });
  });

  function isSessionActive(session: DisplaySession): boolean {
    if (session.type === 'pty') {
      return $activeSessionId === session.id;
    } else {
      return $activeSdkSessionId === session.id;
    }
  }
</script>

<div class="session-list h-full overflow-y-auto">
  <!-- New Session Button -->
  <button
    class="w-full p-3 border-b border-border text-left hover:bg-surface-elevated transition-colors flex items-center gap-2 text-accent"
    onclick={createNewSession}
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
    </svg>
    <span class="text-sm font-medium">
      {$settings.terminal_mode === 'Sdk' ? 'New SDK Session' : 'New Terminal'}
    </span>
  </button>

  {#if allSessions().length === 0}
    <div class="p-4 text-center text-text-muted text-sm">
      <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      No sessions yet
    </div>
  {:else}
    {#each allSessions() as session (session.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="session-item p-3 border-b border-border/50 hover:bg-surface-elevated/50 transition-all cursor-pointer"
        class:active={isSessionActive(session)}
        onclick={() => session.type === 'pty' ? selectPtySession(session.id) : selectSdkSession(session.id)}
      >
        <!-- Header row: type badge, status dot, time, close button -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            {#if session.type === 'sdk'}
              <span class="px-1.5 py-0.5 text-[10px] font-medium bg-accent/20 text-accent rounded">SDK</span>
            {/if}
            <div class="relative">
              <div class="w-2 h-2 rounded-full {getStatusBg(session.status)}"></div>
              {#if session.status === 'Running' || session.status === 'Starting' || session.status === 'querying'}
                <div class="absolute inset-0 w-2 h-2 rounded-full {getStatusBg(session.status)} animate-ping opacity-75"></div>
              {/if}
            </div>
            <span class="text-xs font-medium {getStatusColor(session.status)}">{getStatusLabel(session.status)}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-text-muted font-mono tabular-nums">{getElapsedTime(session.createdAt)}</span>
            <button
              class="text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded p-0.5 transition-colors"
              onclick={(e) => session.type === 'pty' ? closePtySession(session.id, e) : closeSdkSession(session.id, e)}
              title="Close session"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Prompt text -->
        <p class="text-sm text-text-primary leading-snug mb-1.5" title={session.prompt || 'Interactive session'}>
          {#if session.prompt}
            {truncatePrompt(session.prompt)}
          {:else}
            <span class="text-text-muted italic">{session.type === 'sdk' ? 'SDK Session' : 'Interactive session'}</span>
          {/if}
        </p>

        <!-- Repo name -->
        <div class="flex items-center gap-1.5 text-text-muted">
          <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span class="text-xs truncate">{getRepoName(session.repoPath)}</span>
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .session-list {
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }

  .session-item {
    border-left: 2px solid transparent;
  }

  .session-item.active {
    background-color: rgba(99, 102, 241, 0.05);
    border-left: 2px solid var(--color-accent);
  }
</style>
