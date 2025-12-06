<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { sessions, activeSessionId } from '$lib/stores/sessions';
  import { sdkSessions, activeSdkSessionId, type SessionAiMetadata } from '$lib/stores/sdkSessions';
  import { settings, type SessionsViewLayout, type SessionsGridSize } from '$lib/stores/settings';
  import { invoke } from '@tauri-apps/api/core';
  import SessionCard from '$lib/components/SessionCard.svelte';

  // Unified session type for display
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

  // Layout and size settings
  let layout = $derived($settings.sessions_view?.layout || 'list');
  let gridColumns = $derived($settings.sessions_view?.grid_columns || 3);
  let cardSize = $derived($settings.sessions_view?.card_size || 'medium');

  // Branch cache
  let branchCache = new Map<string, string>();

  async function getGitBranch(repoPath: string): Promise<string | undefined> {
    if (branchCache.has(repoPath)) return branchCache.get(repoPath);

    try {
      const branch = await invoke<string>('get_git_branch', { repoPath });
      if (branch) {
        branchCache.set(repoPath, branch);
        return branch;
      }
    } catch (error) {
      // Not a git repo or error
    }
    return undefined;
  }

  // Get smart status for SDK sessions
  function getSdkSmartStatus(session: typeof $sdkSessions[0]): { status: string; detail?: string } {
    const messages = session.messages;
    const lastMsg = messages.at(-1);

    if (session.status === 'pending_transcription') {
      const subStatus = session.pendingTranscription?.status || 'recording';
      if (session.pendingTranscription?.transcriptionError) {
        return { status: 'transcription_error', detail: session.pendingTranscription.transcriptionError };
      }
      return { status: 'pending_transcription', detail: subStatus };
    }

    if (session.status === 'pending_repo') return { status: 'pending_repo' };
    if (session.status === 'initializing') return { status: 'initializing' };
    if (session.status === 'error') return { status: 'error' };

    if (session.status === 'querying') {
      let inSubagent = false;
      let subagentType: string | undefined;

      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];

        if (msg.type === 'subagent_stop') continue;
        if (msg.type === 'subagent_start') {
          inSubagent = true;
          subagentType = msg.agentType;
          continue;
        }

        if (msg.type === 'tool_start') {
          if (inSubagent) return { status: 'subagent', detail: subagentType || 'Agent' };

          let count = 1;
          const currentTool = msg.tool;

          for (let j = i - 1; j >= 0; j--) {
            const prevMsg = messages[j];
            if (prevMsg.type === 'tool_start') {
              if (prevMsg.tool === currentTool) count++;
              else break;
            }
          }

          const detail = count > 1 ? `${msg.tool} x${count}` : msg.tool;
          return { status: 'tool', detail };
        }
        if (msg.type === 'tool_result') {
          if (inSubagent) return { status: 'subagent', detail: subagentType || 'Agent' };
          return { status: 'thinking' };
        }
        if (msg.type === 'text') {
          if (inSubagent) return { status: 'subagent', detail: subagentType || 'Agent' };
          return { status: 'responding' };
        }
      }

      if (inSubagent) return { status: 'subagent', detail: subagentType || 'Agent' };
      return { status: 'thinking' };
    }

    if (messages.length === 0) return { status: 'new' };
    if (lastMsg?.type === 'done') return { status: 'done' };

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'subagent_stop' || msg.type === 'done') break;
      if (msg.type === 'subagent_start') {
        return { status: 'subagent', detail: msg.agentType || 'Agent' };
      }
    }

    return { status: 'idle' };
  }

  // Get latest text message
  function getLatestTextMessage(messages: typeof $sdkSessions[0]['messages']): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'text' && msg.content) return msg.content;
    }
    return undefined;
  }

  // Combine sessions
  let allSessions = $state<DisplaySession[]>([]);

  $effect(() => {
    const ptySessions = $sessions;
    const sdkSessionsList = $sdkSessions;
    const sortOrder = $settings.session_sort_order;

    const baseSessions: DisplaySession[] = [
      ...ptySessions.map(s => ({
        id: s.id,
        type: 'pty' as const,
        status: s.status,
        statusDetail: undefined as string | undefined,
        prompt: s.prompt,
        repoPath: s.repo_path,
        createdAt: s.created_at,
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
          prompt: s.messages.find(m => m.type === 'user')?.content || s.pendingPrompt || s.pendingRepoSelection?.transcript || '',
          repoPath: s.cwd,
          model: s.model,
          createdAt: Math.floor(s.createdAt / 1000),
          accumulatedDurationMs: s.accumulatedDurationMs || 0,
          currentWorkStartedAt: s.currentWorkStartedAt,
          isFinished,
          unread: s.unread,
          latestMessage: getLatestTextMessage(s.messages),
          aiMetadata: s.aiMetadata,
        };
      })
    ];

    // Sort
    const sorted = baseSessions.sort((a, b) => {
      if (sortOrder === 'StatusThenChronological') {
        const statusOrder: Record<string, number> = {
          pending_transcription: -1, transcription_error: -1,
          pending_repo: 0, initializing: 0,
          Starting: 0, Running: 0, querying: 0, tool: 0, thinking: 0, responding: 0, subagent: 0,
          idle: 1, new: 1, Completed: 2, done: 2,
          Failed: 3, error: 3
        };
        const statusDiff = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
        if (statusDiff !== 0) return statusDiff;
      }
      return b.createdAt - a.createdAt;
    });

    allSessions = sorted;

    // Fetch branches
    sorted.forEach(async (session) => {
      const branch = await getGitBranch(session.repoPath);
      if (branch) {
        allSessions = allSessions.map(s =>
          s.id === session.id ? { ...s, branch } : s
        );
      }
    });
  });

  // Navigation and selection
  function goBack() {
    goto('/');
  }

  function selectSession(session: DisplaySession) {
    if (session.type === 'pty') {
      activeSessionId.set(session.id);
      activeSdkSessionId.set(null);
    } else {
      activeSdkSessionId.set(session.id);
      activeSessionId.set(null);
      sdkSessions.markAsRead(session.id);
    }
    goto('/');
  }

  function closeSession(session: DisplaySession, event: MouseEvent) {
    event.stopPropagation();
    if (session.type === 'pty') {
      sessions.closeSession(session.id);
      if ($activeSessionId === session.id) activeSessionId.set(null);
    } else {
      sdkSessions.closeSession(session.id);
      if ($activeSdkSessionId === session.id) activeSdkSessionId.set(null);
    }
  }

  function isSessionActive(session: DisplaySession): boolean {
    if (session.type === 'pty') return $activeSessionId === session.id;
    return $activeSdkSessionId === session.id;
  }

  // Layout controls
  async function setLayout(newLayout: SessionsViewLayout) {
    const newSettings = {
      ...$settings,
      sessions_view: {
        ...$settings.sessions_view,
        layout: newLayout
      }
    };
    await settings.save(newSettings);
  }

  async function setCardSize(newSize: SessionsGridSize) {
    const newSettings = {
      ...$settings,
      sessions_view: {
        ...$settings.sessions_view,
        card_size: newSize
      }
    };
    await settings.save(newSettings);
  }

  async function setGridColumns(cols: number) {
    const newSettings = {
      ...$settings,
      sessions_view: {
        ...$settings.sessions_view,
        grid_columns: cols
      }
    };
    await settings.save(newSettings);
  }

  // Statistics
  let activeCount = $derived(allSessions.filter(s =>
    ['Starting', 'Running', 'querying', 'tool', 'thinking', 'responding', 'subagent', 'initializing'].includes(s.status)
  ).length);
  let pendingCount = $derived(allSessions.filter(s =>
    ['pending_repo', 'pending_transcription'].includes(s.status)
  ).length);
  let doneCount = $derived(allSessions.filter(s =>
    ['Completed', 'idle', 'done', 'new'].includes(s.status)
  ).length);
  let errorCount = $derived(allSessions.filter(s =>
    ['Failed', 'error', 'transcription_error'].includes(s.status)
  ).length);
  let unreadCount = $derived(allSessions.filter(s => s.unread).length);

  // Grid style
  let gridStyle = $derived.by(() => {
    if (layout === 'grid') {
      return `grid-template-columns: repeat(${gridColumns}, minmax(0, 1fr))`;
    }
    return '';
  });
</script>

<div class="sessions-view flex flex-col h-full bg-background">
  <header class="flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
    <div class="flex items-center gap-4">
      <button
        class="p-1.5 hover:bg-surface-elevated rounded transition-colors"
        onclick={goBack}
        title="Back to main view"
      >
        <svg class="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <h2 class="text-lg font-semibold text-text-primary">Sessions Command Center</h2>

      <!-- Stats badges -->
      <div class="flex items-center gap-2 ml-4">
        <span class="px-2 py-1 text-xs font-medium bg-surface-elevated rounded text-text-muted">
          {allSessions.length} total
        </span>
        {#if pendingCount > 0}
          <span class="px-2 py-1 text-xs font-medium bg-amber-500/20 text-amber-400 rounded flex items-center gap-1">
            <div class="w-1.5 h-1.5 bg-amber-400 rounded-full"></div>
            {pendingCount} pending
          </span>
        {/if}
        {#if activeCount > 0}
          <span class="px-2 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-400 rounded flex items-center gap-1">
            <div class="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
            {activeCount} active
          </span>
        {/if}
        {#if unreadCount > 0}
          <span class="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-400 rounded">
            {unreadCount} unread
          </span>
        {/if}
        {#if errorCount > 0}
          <span class="px-2 py-1 text-xs font-medium bg-red-500/20 text-red-400 rounded">
            {errorCount} errors
          </span>
        {/if}
      </div>
    </div>

    <!-- Layout controls -->
    <div class="flex items-center gap-3">
      <!-- Card size selector (only for grid) -->
      {#if layout === 'grid'}
        <div class="flex items-center gap-1 bg-surface-elevated rounded p-0.5">
          <button
            class="px-2 py-1 text-xs rounded transition-colors"
            class:bg-accent={cardSize === 'small'}
            class:text-white={cardSize === 'small'}
            class:text-text-muted={cardSize !== 'small'}
            onclick={() => setCardSize('small')}
            title="Small cards"
          >
            S
          </button>
          <button
            class="px-2 py-1 text-xs rounded transition-colors"
            class:bg-accent={cardSize === 'medium'}
            class:text-white={cardSize === 'medium'}
            class:text-text-muted={cardSize !== 'medium'}
            onclick={() => setCardSize('medium')}
            title="Medium cards"
          >
            M
          </button>
          <button
            class="px-2 py-1 text-xs rounded transition-colors"
            class:bg-accent={cardSize === 'large'}
            class:text-white={cardSize === 'large'}
            class:text-text-muted={cardSize !== 'large'}
            onclick={() => setCardSize('large')}
            title="Large cards"
          >
            L
          </button>
        </div>

        <!-- Column count selector -->
        <div class="flex items-center gap-1 bg-surface-elevated rounded p-0.5">
          {#each [2, 3, 4, 5] as cols}
            <button
              class="px-2 py-1 text-xs rounded transition-colors"
              class:bg-accent={gridColumns === cols}
              class:text-white={gridColumns === cols}
              class:text-text-muted={gridColumns !== cols}
              onclick={() => setGridColumns(cols)}
              title="{cols} columns"
            >
              {cols}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Layout toggle -->
      <div class="flex items-center gap-1 bg-surface-elevated rounded p-0.5">
        <button
          class="p-1.5 rounded transition-colors"
          class:bg-accent={layout === 'list'}
          class:text-white={layout === 'list'}
          class:text-text-muted={layout !== 'list'}
          onclick={() => setLayout('list')}
          title="List view"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        </button>
        <button
          class="p-1.5 rounded transition-colors"
          class:bg-accent={layout === 'grid'}
          class:text-white={layout === 'grid'}
          class:text-text-muted={layout !== 'grid'}
          onclick={() => setLayout('grid')}
          title="Grid view"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
          </svg>
        </button>
      </div>
    </div>
  </header>

  <div class="flex-1 overflow-y-auto p-4">
    {#if allSessions.length === 0}
      <div class="flex flex-col items-center justify-center h-full text-text-muted">
        <svg class="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p class="text-lg mb-2">No sessions yet</p>
        <p class="text-sm">Record a voice prompt to start a new Claude session</p>
      </div>
    {:else if layout === 'list'}
      <!-- List layout -->
      <div class="max-w-4xl mx-auto space-y-2">
        {#each allSessions as session (session.id)}
          <SessionCard
            {session}
            size={cardSize}
            isActive={isSessionActive(session)}
            {now}
            showLatestMessage={$settings.show_latest_message_preview}
            promptRows={$settings.session_prompt_rows}
            responseRows={$settings.session_response_rows}
            onselect={() => selectSession(session)}
            onclose={(e) => closeSession(session, e)}
          />
        {/each}
      </div>
    {:else}
      <!-- Grid layout -->
      <div
        class="grid gap-3"
        style={gridStyle}
      >
        {#each allSessions as session (session.id)}
          <SessionCard
            {session}
            size={cardSize}
            isActive={isSessionActive(session)}
            {now}
            showLatestMessage={$settings.show_latest_message_preview}
            promptRows={$settings.session_prompt_rows}
            responseRows={$settings.session_response_rows}
            onselect={() => selectSession(session)}
            onclose={(e) => closeSession(session, e)}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .sessions-view {
    user-select: none;
  }
</style>
