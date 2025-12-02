<script lang="ts">
  import { sessions, activeSessionId, type TerminalSession } from '$lib/stores/sessions';

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
      case 'Starting':
        return 'bg-warning';
      case 'Running':
        return 'bg-success';
      case 'Completed':
        return 'bg-text-muted';
      case 'Failed':
        return 'bg-error';
      default:
        return 'bg-text-muted';
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function truncatePrompt(prompt: string, maxLength: number = 50): string {
    if (prompt.length <= maxLength) return prompt;
    return prompt.slice(0, maxLength) + '...';
  }

  function getRepoName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }
</script>

<div class="session-list h-full overflow-y-auto">
  {#if $sessions.length === 0}
    <div class="p-4 text-center text-text-muted text-sm">
      No active sessions
    </div>
  {:else}
    {#each $sessions as session (session.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="session-item w-full p-3 text-left border-b border-border hover:bg-surface-elevated transition-colors cursor-pointer"
        class:bg-surface-elevated={$activeSessionId === session.id}
        onclick={() => selectSession(session.id)}
      >
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full {getStatusColor(session.status)}"></div>
            <span class="text-xs text-text-muted">{formatTime(session.created_at)}</span>
          </div>
          <button
            class="text-text-muted hover:text-error transition-colors p-1"
            onclick={(e) => closeSession(session.id, e)}
            title="Close session"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p class="text-sm text-text-primary truncate" title={session.prompt}>
          {truncatePrompt(session.prompt)}
        </p>
        <p class="text-xs text-text-muted truncate mt-1" title={session.repo_path}>
          {getRepoName(session.repo_path)}
        </p>
      </div>
    {/each}
  {/if}
</div>

<style>
  .session-list {
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }
</style>
