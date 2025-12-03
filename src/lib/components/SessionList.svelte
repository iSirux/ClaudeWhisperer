<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { sessions, activeSessionId, type TerminalSession } from '$lib/stores/sessions';
  import { sdkSessions, activeSdkSessionId } from '$lib/stores/sdkSessions';
  import { settings, activeRepo } from '$lib/stores/settings';
  import { invoke } from '@tauri-apps/api/core';

  async function createNewSession() {
    try {
      if ($settings.terminal_mode === 'Sdk') {
        // SDK mode: create SDK session
        const repoPath = $activeRepo?.path || '.';
        const model = $settings.default_model;
        const sessionId = await sdkSessions.createSession(repoPath, model);
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

  // Get elapsed time for a session using timer-based tracking
  // Returns null if session hasn't started working yet
  function getElapsedTime(
    accumulatedDurationMs: number,
    currentWorkStartedAt: number | undefined,
    isFinished: boolean
  ): string | null {
    // If no work has been done yet (no accumulated time and not currently working)
    if (accumulatedDurationMs === 0 && !currentWorkStartedAt) {
      return null;
    }

    let totalMs = accumulatedDurationMs;

    // If currently working, add the live elapsed time
    if (currentWorkStartedAt && !isFinished) {
      const liveElapsedMs = (now * 1000) - currentWorkStartedAt;
      totalMs += Math.max(0, liveElapsedMs);
    }

    const elapsedSeconds = Math.floor(totalMs / 1000);
    return formatDuration(elapsedSeconds);
  }

  // Legacy function for PTY sessions that still use timestamp-based tracking
  function getLegacyElapsedTime(startedAt: number | undefined, endedAt?: number): string | null {
    if (startedAt === undefined) {
      return null; // Timer not started yet
    }
    const endTime = endedAt ?? now;
    const elapsed = Math.max(0, endTime - startedAt);
    return formatDuration(elapsed);
  }

  // Unified session type for display
  interface DisplaySession {
    id: string;
    type: 'pty' | 'sdk';
    status: string;
    statusDetail?: string; // e.g., tool name being run
    prompt: string;
    repoPath: string;
    model?: string; // model name for SDK sessions
    createdAt: number; // When the session was created (for sorting)
    startedAt?: number; // When the timer should start (when prompt was sent/SDK started working) - deprecated for SDK
    endedAt?: number; // timestamp when session finished (for SDK sessions) - deprecated
    branch?: string; // git branch name
    // Timer-based duration (SDK sessions only)
    accumulatedDurationMs: number;
    currentWorkStartedAt?: number;
    isFinished: boolean; // Whether the session is done/idle/error
    unread?: boolean; // Whether the session completed and user hasn't viewed it yet
  }

  // Cache for git branches to avoid repeated calls
  let branchCache = new Map<string, string>();

  async function getGitBranch(repoPath: string): Promise<string | undefined> {
    if (!$settings.show_branch_in_sessions) {
      return undefined;
    }

    if (branchCache.has(repoPath)) {
      return branchCache.get(repoPath);
    }

    try {
      const branch = await invoke<string>('get_git_branch', { repoPath });
      if (branch) {
        branchCache.set(repoPath, branch);
        return branch;
      }
    } catch (error) {
      // Not a git repo or error getting branch, silently ignore
    }

    return undefined;
  }

  // Get smart status for SDK sessions based on messages
  function getSdkSmartStatus(session: typeof $sdkSessions[0]): { status: string; detail?: string } {
    const messages = session.messages;
    const lastMsg = messages.at(-1);

    if (session.status === 'error') {
      return { status: 'error' };
    }

    if (session.status === 'querying') {
      // Find the last tool_start that doesn't have a matching tool_result after it
      // Also track if we're in a subagent
      let inSubagent = false;
      let subagentType: string | undefined;

      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];

        // Track subagent state (stop before start when iterating backwards)
        if (msg.type === 'subagent_stop') {
          // Subagent finished, continue looking for what's happening now
          continue;
        }
        if (msg.type === 'subagent_start') {
          // We found a subagent_start without a matching stop - subagent is running
          inSubagent = true;
          subagentType = msg.agentType;
          continue;
        }

        if (msg.type === 'tool_start') {
          // If we're in a subagent, show that instead
          if (inSubagent) {
            return { status: 'subagent', detail: subagentType || 'Agent' };
          }

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
          // Tool finished, Claude is thinking (but might have subagent running)
          if (inSubagent) {
            return { status: 'subagent', detail: subagentType || 'Agent' };
          }
          return { status: 'thinking' };
        }
        if (msg.type === 'text') {
          // Got text but might have subagent running after it
          if (inSubagent) {
            return { status: 'subagent', detail: subagentType || 'Agent' };
          }
          return { status: 'responding' };
        }
      }

      // If we found a subagent but no other status-determining messages
      if (inSubagent) {
        return { status: 'subagent', detail: subagentType || 'Agent' };
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

    // Check if there's an unfinished subagent (status not querying but subagent might still be running)
    // This handles edge cases where status gets out of sync
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'subagent_stop' || msg.type === 'done') {
        break; // Found a completion marker, we're really idle
      }
      if (msg.type === 'subagent_start') {
        // Found subagent_start without stop - still working
        return { status: 'subagent', detail: msg.agentType || 'Agent' };
      }
    }

    return { status: 'idle' };
  }

  function selectPtySession(id: string) {
    activeSessionId.set(id);
    activeSdkSessionId.set(null);
    // Dispatch event to parent to switch view
    window.dispatchEvent(new CustomEvent('switch-to-sessions'));
  }

  function selectSdkSession(id: string) {
    activeSdkSessionId.set(id);
    activeSessionId.set(null);
    // Mark as read when selected
    sdkSessions.markAsRead(id);
    // Dispatch event to parent to switch view
    window.dispatchEvent(new CustomEvent('switch-to-sessions'));
  }

  // Check if a session status indicates it's actively working
  function isActivelyWorking(status: string): boolean {
    const activeStatuses = ['Starting', 'Running', 'querying', 'tool', 'thinking', 'responding', 'subagent'];
    return activeStatuses.includes(status);
  }

  // State for confirmation dialog
  let confirmDialog = $state<{
    show: boolean;
    sessionId: string;
    sessionType: 'pty' | 'sdk';
  }>({ show: false, sessionId: '', sessionType: 'pty' });

  function closePtySession(id: string, event: MouseEvent) {
    event.stopPropagation();

    // Check if session is actively working
    const session = $sessions.find(s => s.id === id);
    if (session && isActivelyWorking(session.status)) {
      confirmDialog = { show: true, sessionId: id, sessionType: 'pty' };
      return;
    }

    sessions.closeSession(id);
    if ($activeSessionId === id) {
      activeSessionId.set(null);
    }
  }

  function closeSdkSession(id: string, event: MouseEvent) {
    event.stopPropagation();

    // Check if session is actively working
    const session = $sdkSessions.find(s => s.id === id);
    if (session) {
      const smartStatus = getSdkSmartStatus(session);
      if (isActivelyWorking(smartStatus.status)) {
        confirmDialog = { show: true, sessionId: id, sessionType: 'sdk' };
        return;
      }
    }

    sdkSessions.closeSession(id);
    if ($activeSdkSessionId === id) {
      activeSdkSessionId.set(null);
    }
  }

  function confirmClose() {
    if (confirmDialog.sessionType === 'pty') {
      sessions.closeSession(confirmDialog.sessionId);
      if ($activeSessionId === confirmDialog.sessionId) {
        activeSessionId.set(null);
      }
    } else {
      sdkSessions.closeSession(confirmDialog.sessionId);
      if ($activeSdkSessionId === confirmDialog.sessionId) {
        activeSdkSessionId.set(null);
      }
    }
    confirmDialog = { show: false, sessionId: '', sessionType: 'pty' };
  }

  function cancelClose() {
    confirmDialog = { show: false, sessionId: '', sessionType: 'pty' };
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'Starting': return 'text-yellow-400';
      case 'Running': case 'querying': case 'tool': case 'thinking': case 'responding': case 'subagent': return 'text-emerald-400';
      case 'Completed': case 'idle': case 'done': return 'text-blue-400';
      case 'new': return 'text-text-muted';
      case 'Failed': case 'error': return 'text-red-400';
      default: return 'text-text-muted';
    }
  }

  function getStatusBg(status: string): string {
    switch (status) {
      case 'Starting': return 'bg-yellow-400';
      case 'Running': case 'querying': case 'tool': case 'thinking': case 'responding': case 'subagent': return 'bg-emerald-400';
      case 'Completed': case 'idle': case 'done': return 'bg-blue-400';
      case 'new': return 'bg-slate-400';
      case 'Failed': case 'error': return 'bg-red-400';
      default: return 'bg-text-muted';
    }
  }

  function getStatusLabel(status: string, detail?: string): string {
    switch (status) {
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

  function truncatePrompt(prompt: string, maxLength: number = 100): string {
    if (prompt.length <= maxLength) return prompt;
    return prompt.slice(0, maxLength) + '...';
  }

  function getRepoName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }

  function getShortModelName(model: string): string {
    // Convert model IDs to shorter display names
    if (model.includes('opus')) return 'Opus';
    if (model.includes('sonnet')) return 'Sonnet';
    if (model.includes('haiku')) return 'Haiku';
    // Return last part of model ID if no match
    const parts = model.split('-');
    return parts[parts.length - 1] || model;
  }

  // Combine PTY and SDK sessions into unified list
  let allSessions = $state<DisplaySession[]>([]);

  // Reactively update sessions when sessions or settings change
  $effect(() => {
    // Access reactive dependencies
    const ptySessions = $sessions;
    const sdkSessionsList = $sdkSessions;
    const showBranch = $settings.show_branch_in_sessions;
    const sortOrder = $settings.session_sort_order;

    // Build base sessions without branches
    const baseSessions: DisplaySession[] = [
      ...ptySessions.map(s => ({
        id: s.id,
        type: 'pty' as const,
        status: s.status,
        statusDetail: undefined as string | undefined,
        prompt: s.prompt,
        repoPath: s.repo_path,
        createdAt: s.created_at,
        startedAt: s.created_at, // PTY sessions start timing immediately (legacy)
        // PTY sessions don't have timer-based tracking, set defaults
        accumulatedDurationMs: 0,
        currentWorkStartedAt: undefined,
        isFinished: s.status === 'Completed' || s.status === 'Failed',
      })),
      ...sdkSessionsList.map(s => {
        const smartStatus = getSdkSmartStatus(s);
        const isFinished = smartStatus.status === 'done' || smartStatus.status === 'idle' || smartStatus.status === 'error' || smartStatus.status === 'new';

        return {
          id: s.id,
          type: 'sdk' as const,
          status: smartStatus.status,
          statusDetail: smartStatus.detail,
          prompt: s.messages.find(m => m.type === 'user')?.content || 'SDK Session',
          repoPath: s.cwd,
          model: s.model,
          createdAt: Math.floor(s.createdAt / 1000), // For sorting
          startedAt: s.startedAt ? Math.floor(s.startedAt / 1000) : undefined, // Legacy, deprecated
          // Timer-based duration tracking
          accumulatedDurationMs: s.accumulatedDurationMs || 0,
          currentWorkStartedAt: s.currentWorkStartedAt,
          isFinished,
          unread: s.unread,
        };
      })
    ];

    // Sort sessions based on user preference
    const sorted = baseSessions.sort((a, b) => {
      if (sortOrder === 'StatusThenChronological') {
        // Sort by status first, then by creation time (newest first)
        const statusOrder: Record<string, number> = {
          Starting: 0, Running: 0, querying: 0, tool: 0, thinking: 0, responding: 0, subagent: 0,
          idle: 1, new: 1, Completed: 2, done: 2,
          Failed: 3, error: 3
        };
        const statusDiff = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
        if (statusDiff !== 0) return statusDiff;
      }
      // Chronological: newest first
      return b.createdAt - a.createdAt;
    });

    allSessions = sorted;

    // Fetch branches asynchronously if enabled
    if (showBranch) {
      sorted.forEach(async (session) => {
        const branch = await getGitBranch(session.repoPath);
        if (branch) {
          // Update the session in the array
          allSessions = allSessions.map(s =>
            s.id === session.id ? { ...s, branch } : s
          );
        }
      });
    }
  });

  interface Props {
    currentView?: 'sessions' | 'settings' | 'start';
  }

  let { currentView = 'sessions' }: Props = $props();

  function isSessionActive(session: DisplaySession): boolean {
    // Only show as active if we're in the sessions view
    if (currentView !== 'sessions') {
      return false;
    }

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

  {#if allSessions.length === 0}
    <div class="p-4 text-center text-text-muted text-sm">
      <svg class="w-8 h-8 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
      No sessions yet
    </div>
  {:else}
    {#each allSessions as session (session.id)}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="session-item p-3 border-b border-border/50 hover:bg-surface-elevated/50 transition-all cursor-pointer"
        class:active={isSessionActive(session)}
        class:unread={session.unread}
        onmousedown={(e) => {
          // Middle mouse button closes the session
          if (e.button === 1) {
            e.preventDefault();
            session.type === 'pty' ? closePtySession(session.id, e) : closeSdkSession(session.id, e);
          }
        }}
        onclick={() => session.type === 'pty' ? selectPtySession(session.id) : selectSdkSession(session.id)}
      >
        <!-- Header row: type badge, status dot, time, close button -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            {#if session.type === 'sdk' && session.model}
              <span class="px-1.5 py-0.5 text-[10px] font-medium bg-accent/20 text-accent rounded">{getShortModelName(session.model)}</span>
            {/if}
            <div class="relative">
              <div class="w-2 h-2 rounded-full {getStatusBg(session.status)}"></div>
              {#if ['Running', 'Starting', 'querying', 'tool', 'thinking', 'responding', 'subagent'].includes(session.status)}
                <div class="absolute inset-0 w-2 h-2 rounded-full {getStatusBg(session.status)} animate-ping opacity-75"></div>
              {/if}
            </div>
            <span class="text-xs font-medium {getStatusColor(session.status)}">{getStatusLabel(session.status, session.statusDetail)}</span>
          </div>
          <div class="flex items-center gap-2">
            {#if session.type === 'sdk'}
              {#if getElapsedTime(session.accumulatedDurationMs, session.currentWorkStartedAt, session.isFinished) !== null}
                <span class="text-xs text-text-muted font-mono tabular-nums">{getElapsedTime(session.accumulatedDurationMs, session.currentWorkStartedAt, session.isFinished)}</span>
              {/if}
            {:else}
              {#if getLegacyElapsedTime(session.startedAt) !== null}
                <span class="text-xs text-text-muted font-mono tabular-nums">{getLegacyElapsedTime(session.startedAt)}</span>
              {/if}
            {/if}
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
        <p class="text-sm text-text-primary leading-snug mb-1.5 select-text" title={session.prompt || 'Interactive session'}>
          {#if session.prompt}
            {truncatePrompt(session.prompt)}
          {:else}
            <span class="text-text-muted italic">{session.type === 'sdk' ? 'SDK Session' : 'Interactive session'}</span>
          {/if}
        </p>

        <!-- Repo name, branch, and model -->
        <div class="flex items-center gap-1.5 text-text-muted">
          <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span class="text-xs truncate">{getRepoName(session.repoPath)}</span>
          {#if session.branch}
            <span class="text-xs text-text-muted">·</span>
            <span class="text-xs text-blue-400/70" title="Git branch: {session.branch}">{session.branch}</span>
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>

<!-- Confirmation Dialog -->
{#if confirmDialog.show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    onclick={cancelClose}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-surface border border-border rounded-lg shadow-xl p-5 max-w-sm mx-4"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-start gap-3 mb-4">
        <div class="flex-shrink-0 w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
          <svg class="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div>
          <h3 class="text-lg font-semibold text-text-primary mb-1">Close active session?</h3>
          <p class="text-sm text-text-muted">
            This session is still working. Are you sure you want to close it?
          </p>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <button
          class="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary hover:bg-surface-elevated rounded-md transition-colors"
          onclick={cancelClose}
        >
          Cancel
        </button>
        <button
          class="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
          onclick={confirmClose}
        >
          Close session
        </button>
      </div>
    </div>
  </div>
{/if}

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

  .session-item.unread {
    background-color: rgba(59, 130, 246, 0.08);
    border-left: 2px solid rgb(59, 130, 246);
  }

  .session-item.unread.active {
    background-color: rgba(99, 102, 241, 0.1);
    border-left: 2px solid var(--color-accent);
  }
</style>
