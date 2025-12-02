<script lang="ts">
  import { sessions } from '$lib/stores/sessions';
  import { sdkSessions } from '$lib/stores/sdkSessions';

  // Helper function to get status color
  function getStatusBg(status: string): string {
    switch (status) {
      case 'Starting': return 'bg-yellow-400';
      case 'Running': case 'querying': case 'tool': case 'thinking': case 'responding': return 'bg-emerald-400';
      case 'Completed': case 'idle': case 'done': return 'bg-blue-400';
      case 'new': return 'bg-slate-400';
      case 'Failed': case 'error': return 'bg-red-400';
      default: return 'bg-slate-400';
    }
  }

  // Get smart status for SDK sessions
  function getSdkSmartStatus(session: typeof $sdkSessions[0]): { status: string; detail?: string } {
    const messages = session.messages;
    const lastMsg = messages.at(-1);

    if (session.status === 'error') {
      return { status: 'error' };
    }

    if (session.status === 'querying') {
      // Find the last tool_start that doesn't have a matching tool_result after it
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.type === 'tool_start') {
          // Count consecutive calls to this same tool
          let count = 1;
          const currentTool = msg.tool;

          // Look backwards through completed tool pairs
          for (let j = i - 1; j >= 0; j--) {
            const prevMsg = messages[j];

            // Skip to the previous tool_start
            if (prevMsg.type === 'tool_start') {
              // Check if it's the same tool
              if (prevMsg.tool === currentTool) {
                count++;
              } else {
                // Different tool found, stop counting
                break;
              }
            }
          }

          const detail = count > 1 ? `${msg.tool} ×${count}` : msg.tool;
          return { status: 'tool', detail };
        }
        if (msg.type === 'tool_result') {
          // Tool finished, Claude is thinking
          return { status: 'thinking' };
        }
        if (msg.type === 'text') {
          return { status: 'responding' };
        }
      }
      return { status: 'thinking' };
    }

    // Idle states
    if (messages.length === 0) {
      return { status: 'new' };
    }

    if (lastMsg?.type === 'done') {
      return { status: 'done' };
    }

    return { status: 'idle' };
  }

  function getStatusLabel(status: string, detail?: string): string {
    switch (status) {
      case 'Running': case 'querying': return 'Active';
      case 'tool': return detail || 'Tool';
      case 'thinking': return 'Thinking';
      case 'responding': return 'Responding';
      case 'idle': return 'Ready';
      case 'done': return 'Done';
      case 'new': return 'New';
      case 'Starting': return 'Starting';
      case 'Completed': return 'Done';
      case 'Failed': case 'error': return 'Error';
      default: return status;
    }
  }

  function truncatePrompt(prompt: string, maxLength: number = 40): string {
    if (prompt.length <= maxLength) return prompt;
    return prompt.slice(0, maxLength) + '...';
  }

  // Unified session type for display
  interface DisplaySession {
    id: string;
    type: 'pty' | 'sdk';
    status: string;
    statusDetail?: string;
    prompt: string;
  }

  // Combine and filter active sessions
  let activeSessions = $derived.by(() => {
    const ptySessions = $sessions
      .filter(s => s.status === 'Running' || s.status === 'Starting')
      .map(s => ({
        id: s.id,
        type: 'pty' as const,
        status: s.status,
        statusDetail: undefined as string | undefined,
        prompt: s.prompt || 'Interactive',
      }));

    const sdkSessionsList = $sdkSessions
      .filter(s => s.status === 'querying')
      .map(s => {
        const smartStatus = getSdkSmartStatus(s);
        return {
          id: s.id,
          type: 'sdk' as const,
          status: smartStatus.status,
          statusDetail: smartStatus.detail,
          prompt: s.messages.find(m => m.type === 'user')?.content || 'SDK Session',
        };
      });

    return [...ptySessions, ...sdkSessionsList];
  });

  // Calculate total sessions count
  let totalSessions = $derived($sessions.length + $sdkSessions.length);
  let activeSdk = $derived($sdkSessions.filter(s => s.status === 'querying').length);
  let activePty = $derived($sessions.filter(s => s.status === 'Running' || s.status === 'Starting').length);
</script>

<div class="sessions-overlay-window">
  <div class="header">
    <div class="flex items-center gap-2">
      <svg class="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      <span class="text-xs font-medium text-text-primary">Sessions</span>
    </div>
    <div class="text-xs text-text-muted">
      {activeSdk + activePty}/{totalSessions}
    </div>
  </div>

  {#if activeSessions.length === 0}
    <div class="no-sessions">
      <span class="text-xs text-text-muted">No active sessions</span>
    </div>
  {:else}
    <div class="sessions-list">
      {#each activeSessions as session (session.id)}
        <div class="session-item">
          <div class="flex items-center gap-2 mb-1">
            {#if session.type === 'sdk'}
              <span class="type-badge">SDK</span>
            {:else}
              <span class="type-badge pty">PTY</span>
            {/if}
            <div class="relative">
              <div class="status-dot {getStatusBg(session.status)}"></div>
              <div class="status-dot-ping {getStatusBg(session.status)}"></div>
            </div>
            <span class="text-xs font-medium text-text-primary">
              {getStatusLabel(session.status, session.statusDetail)}
            </span>
          </div>
          <p class="prompt-text" title={session.prompt}>
            {truncatePrompt(session.prompt)}
          </p>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sessions-overlay-window {
    background: rgba(15, 23, 42, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    padding: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    max-height: 400px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    margin-bottom: 8px;
  }

  .no-sessions {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .sessions-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    max-height: 320px;
    scrollbar-width: thin;
    scrollbar-color: rgba(148, 163, 184, 0.3) transparent;
  }

  .session-item {
    padding: 6px 8px;
    background: rgba(30, 41, 59, 0.5);
    border-radius: 4px;
    border-left: 2px solid var(--color-accent);
  }

  .type-badge {
    padding: 1px 6px;
    font-size: 9px;
    font-weight: 600;
    background: rgba(99, 102, 241, 0.2);
    color: rgb(99, 102, 241);
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .type-badge.pty {
    background: rgba(148, 163, 184, 0.2);
    color: rgb(148, 163, 184);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .status-dot-ping {
    position: absolute;
    inset: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite;
    opacity: 0.75;
  }

  .prompt-text {
    font-size: 11px;
    color: rgb(203, 213, 225);
    line-height: 1.3;
    margin-left: 20px;
  }

  @keyframes ping {
    75%, 100% {
      transform: scale(2);
      opacity: 0;
    }
  }

  :global(body) {
    background: transparent !important;
    overflow: hidden;
  }

  :global(html) {
    background: transparent !important;
  }
</style>
