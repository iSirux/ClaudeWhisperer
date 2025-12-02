<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { sessions, activeSessionId, type TerminalSession } from '$lib/stores/sessions';

  async function createNewTerminal() {
    try {
      const sessionId = await sessions.createInteractiveSession();
      activeSessionId.set(sessionId);
    } catch (error) {
      console.error('Failed to create interactive session:', error);
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

  function selectSession(id: string) {
    activeSessionId.set(id);
  }

  function closeSession(id: string, event: MouseEvent) {
    event.stopPropagation();
    sessions.closeSession(id);
    if ($activeSessionId === id) {
      const remaining = $sessions.filter((s) => s.id !== id);
      activeSessionId.set(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  function getStatusColor(status: TerminalSession['status']): string {
    switch (status) {
      case 'Starting': return 'text-yellow-400';
      case 'Running': return 'text-emerald-400';
      case 'Completed': return 'text-blue-400';
      case 'Failed': return 'text-red-400';
      default: return 'text-text-muted';
    }
  }

  function getStatusBg(status: TerminalSession['status']): string {
    switch (status) {
      case 'Starting': return 'bg-yellow-400';
      case 'Running': return 'bg-emerald-400';
      case 'Completed': return 'bg-blue-400';
      case 'Failed': return 'bg-red-400';
      default: return 'bg-text-muted';
    }
  }

  function getStatusLabel(status: TerminalSession['status']): string {
    return status === 'Running' ? 'Active' : status;
  }


  function truncatePrompt(prompt: string, maxLength: number = 60): string {
    if (prompt.length <= maxLength) return prompt;
    return prompt.slice(0, maxLength) + '...';
  }

  function getRepoName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  // Sort sessions: Running first, then by created_at descending
  let sortedSessions = $derived([...$sessions].sort((a, b) => {
    const statusOrder: Record<string, number> = { Starting: 0, Running: 1, Completed: 2, Failed: 3 };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.created_at - a.created_at;
  }));
</script>

<div class="session-list h-full overflow-y-auto">
  <!-- New Terminal Button -->
  <button
    class="w-full p-3 border-b border-border text-left hover:bg-surface-elevated transition-colors flex items-center gap-2 text-accent"
    onclick={createNewTerminal}
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
    </svg>
    <span class="text-sm font-medium">New Terminal</span>
  </button>

  {#if sortedSessions.length === 0}
    <div class="p-4 text-center text-text-muted text-sm">
      <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      No sessions yet
    </div>
  {:else}
    {#each sortedSessions as session (session.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="session-item p-3 border-b border-border/50 hover:bg-surface-elevated/50 transition-all cursor-pointer"
        class:active={$activeSessionId === session.id}
        onclick={() => selectSession(session.id)}
      >
        <!-- Header row: status dot, time, close button -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <div class="relative">
              <div class="w-2 h-2 rounded-full {getStatusBg(session.status)}"></div>
              {#if session.status === 'Running' || session.status === 'Starting'}
                <div class="absolute inset-0 w-2 h-2 rounded-full {getStatusBg(session.status)} animate-ping opacity-75"></div>
              {/if}
            </div>
            <span class="text-xs font-medium {getStatusColor(session.status)}">{getStatusLabel(session.status)}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-text-muted font-mono tabular-nums">{getElapsedTime(session.created_at)}</span>
            <button
              class="text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded p-0.5 transition-colors"
              onclick={(e) => closeSession(session.id, e)}
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
            <span class="text-text-muted italic">Interactive session</span>
          {/if}
        </p>

        <!-- Repo name -->
        <div class="flex items-center gap-1.5 text-text-muted">
          <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span class="text-xs truncate">{getRepoName(session.repo_path)}</span>
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
