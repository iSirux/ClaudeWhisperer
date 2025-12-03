<script lang="ts">
  import { onMount } from 'svelte';
  import { usageStats, formatDuration, formatDate, formatRelativeTime, getWeeklyStats, getTotalForPeriod, formatTokens, formatCost } from '$lib/stores/usageStats';
  import { activeSdkSession } from '$lib/stores/sdkSessions';
  import { settings } from '$lib/stores/settings';
  import { goto } from '$app/navigation';

  // Current session usage
  let sessionUsage = $derived($activeSdkSession?.usage);
  let sessionInputTokens = $derived(
    sessionUsage
      ? sessionUsage.totalInputTokens + sessionUsage.progressiveInputTokens
      : 0
  );
  let sessionOutputTokens = $derived(
    sessionUsage
      ? sessionUsage.totalOutputTokens + sessionUsage.progressiveOutputTokens
      : 0
  );
  let sessionTotalTokens = $derived(sessionInputTokens + sessionOutputTokens);
  let sessionCost = $derived(sessionUsage?.totalCostUsd ?? 0);
  let sessionCacheRead = $derived(sessionUsage?.cacheReadTokens ?? 0);
  let sessionCacheCreation = $derived(sessionUsage?.cacheCreationTokens ?? 0);
  let hasSessionUsage = $derived(sessionTotalTokens > 0 || sessionCost > 0);

  let resettingStats = $state(false);

  onMount(() => {
    usageStats.load();
  });

  async function resetStats() {
    if (!confirm('Are you sure you want to reset all usage statistics? This cannot be undone.')) {
      return;
    }
    resettingStats = true;
    try {
      await usageStats.reset();
    } catch (error) {
      console.error('Failed to reset stats:', error);
    }
    resettingStats = false;
  }

  // Helper to get model distribution percentages
  function getModelPercentage(count: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((count / total) * 100);
  }

  // Get repo name from path
  function getRepoName(path: string): string {
    const repo = $settings.repos.find(r => r.path === path);
    return repo?.name || path.split(/[/\\]/).pop() || path;
  }

  function goBack() {
    goto('/');
  }
</script>

<div class="usage-view flex flex-col h-full bg-background">
  <header class="flex items-center gap-4 px-4 py-3 border-b border-border bg-surface">
    <button
      class="p-1.5 hover:bg-surface-elevated rounded transition-colors"
      onclick={goBack}
      title="Back to main view"
    >
      <svg class="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
    <h2 class="text-lg font-semibold text-text-primary">Usage Statistics</h2>
  </header>

  <div class="flex-1 overflow-y-auto p-6">
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Current Session Usage -->
      {#if hasSessionUsage}
        <div>
          <h3 class="text-sm font-medium text-text-primary mb-3">Current Session</h3>
          <div class="p-4 bg-surface-elevated rounded-lg border border-accent/30">
            <!-- Session Cost Banner -->
            <div class="flex items-center justify-between mb-4 pb-4 border-b border-border">
              <div>
                <div class="text-3xl font-bold text-accent">{formatCost(sessionCost)}</div>
                <div class="text-xs text-text-muted">Session Cost (USD)</div>
              </div>
              <div class="text-right">
                <div class="text-xl font-bold text-text-primary">{formatTokens(sessionTotalTokens)}</div>
                <div class="text-xs text-text-muted">Session Tokens</div>
              </div>
            </div>

            <!-- Token Breakdown -->
            <div class="grid grid-cols-2 gap-4">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <svg class="w-4 h-4 text-blue-400" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4 8a.5.5 0 0 1 .5-.5h5.793L8.146 5.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 8.5H4.5A.5.5 0 0 1 4 8z"/>
                  </svg>
                </div>
                <div>
                  <div class="text-sm font-medium text-text-primary">{formatTokens(sessionInputTokens)}</div>
                  <div class="text-xs text-text-muted">Input Tokens</div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <svg class="w-4 h-4 text-purple-400" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M12 8a.5.5 0 0 1-.5.5H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5H11.5a.5.5 0 0 1 .5.5z"/>
                  </svg>
                </div>
                <div>
                  <div class="text-sm font-medium text-text-primary">{formatTokens(sessionOutputTokens)}</div>
                  <div class="text-xs text-text-muted">Output Tokens</div>
                </div>
              </div>
            </div>

            <!-- Cache Stats (if any) -->
            {#if sessionCacheRead > 0 || sessionCacheCreation > 0}
              <div class="mt-4 pt-4 border-t border-border">
                <div class="text-xs text-text-muted mb-2">Prompt Caching</div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                      <svg class="w-4 h-4 text-green-400" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814l-3.5-2.5z"/>
                      </svg>
                    </div>
                    <div>
                      <div class="text-sm font-medium text-success">{formatTokens(sessionCacheRead)}</div>
                      <div class="text-xs text-text-muted">Cache Reads (90% savings)</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <svg class="w-4 h-4 text-orange-400" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 3zm4 8a4 4 0 0 1-8 0V5a4 4 0 1 1 8 0v6z"/>
                      </svg>
                    </div>
                    <div>
                      <div class="text-sm font-medium text-text-primary">{formatTokens(sessionCacheCreation)}</div>
                      <div class="text-xs text-text-muted">Cache Writes</div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Token Usage & Cost (Most Important) -->
      {#if $usageStats.token_stats && ($usageStats.token_stats.total_input_tokens > 0 || $usageStats.token_stats.total_output_tokens > 0)}
        <div>
          <h3 class="text-sm font-medium text-text-primary mb-3">Token Usage & Cost</h3>
          <div class="p-4 bg-surface-elevated rounded-lg">
            <!-- Total Cost Banner -->
            <div class="flex items-center justify-between mb-4 pb-4 border-b border-border">
              <div>
                <div class="text-3xl font-bold text-warning">{formatCost($usageStats.token_stats.total_cost_usd)}</div>
                <div class="text-xs text-text-muted">Estimated API Cost (USD)</div>
                <div class="text-[10px] text-text-muted mt-0.5">Only applies to API usage, not subscriptions</div>
              </div>
              <div class="text-right">
                <div class="text-xl font-bold text-text-primary">{formatTokens($usageStats.token_stats.total_input_tokens + $usageStats.token_stats.total_output_tokens)}</div>
                <div class="text-xs text-text-muted">Total Tokens</div>
              </div>
            </div>

            <!-- Token Breakdown -->
            <div class="grid grid-cols-2 gap-4">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <svg class="w-4 h-4 text-blue-400" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4 8a.5.5 0 0 1 .5-.5h5.793L8.146 5.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 8.5H4.5A.5.5 0 0 1 4 8z"/>
                  </svg>
                </div>
                <div>
                  <div class="text-sm font-medium text-text-primary">{formatTokens($usageStats.token_stats.total_input_tokens)}</div>
                  <div class="text-xs text-text-muted">Input Tokens</div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <svg class="w-4 h-4 text-purple-400" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M12 8a.5.5 0 0 1-.5.5H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5H11.5a.5.5 0 0 1 .5.5z"/>
                  </svg>
                </div>
                <div>
                  <div class="text-sm font-medium text-text-primary">{formatTokens($usageStats.token_stats.total_output_tokens)}</div>
                  <div class="text-xs text-text-muted">Output Tokens</div>
                </div>
              </div>
            </div>

            <!-- Cache Stats (if any) -->
            {#if $usageStats.token_stats.total_cache_read_tokens > 0 || $usageStats.token_stats.total_cache_creation_tokens > 0}
              <div class="mt-4 pt-4 border-t border-border">
                <div class="text-xs text-text-muted mb-2">Prompt Caching</div>
                <div class="grid grid-cols-2 gap-4">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                      <svg class="w-4 h-4 text-green-400" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0zM6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814l-3.5-2.5z"/>
                      </svg>
                    </div>
                    <div>
                      <div class="text-sm font-medium text-success">{formatTokens($usageStats.token_stats.total_cache_read_tokens)}</div>
                      <div class="text-xs text-text-muted">Cache Reads (90% savings)</div>
                    </div>
                  </div>
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <svg class="w-4 h-4 text-orange-400" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 3zm4 8a4 4 0 0 1-8 0V5a4 4 0 1 1 8 0v6z"/>
                      </svg>
                    </div>
                    <div>
                      <div class="text-sm font-medium text-text-primary">{formatTokens($usageStats.token_stats.total_cache_creation_tokens)}</div>
                      <div class="text-xs text-text-muted">Cache Writes</div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Overview Stats -->
      <div>
        <h3 class="text-sm font-medium text-text-primary mb-3">Overview</h3>
        <div class="grid grid-cols-4 gap-3">
          <div class="p-3 bg-surface-elevated rounded-lg">
            <div class="text-2xl font-bold text-accent">{$usageStats.session_stats.total_sessions}</div>
            <div class="text-xs text-text-muted">Total Sessions</div>
          </div>
          <div class="p-3 bg-surface-elevated rounded-lg">
            <div class="text-2xl font-bold text-accent">{$usageStats.session_stats.total_prompts}</div>
            <div class="text-xs text-text-muted">Total Prompts</div>
          </div>
          <div class="p-3 bg-surface-elevated rounded-lg">
            <div class="text-2xl font-bold text-accent">{$usageStats.session_stats.total_recordings}</div>
            <div class="text-xs text-text-muted">Voice Recordings</div>
          </div>
          <div class="p-3 bg-surface-elevated rounded-lg">
            <div class="text-2xl font-bold text-accent">{$usageStats.session_stats.total_tool_calls}</div>
            <div class="text-xs text-text-muted">Tool Calls</div>
          </div>
        </div>
      </div>

      <!-- Streak & Activity -->
      <div>
        <h3 class="text-sm font-medium text-text-primary mb-3">Activity</h3>
        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 bg-surface-elevated rounded-lg">
            <div class="flex items-center gap-2">
              <span class="text-xl">🔥</span>
              <div>
                <div class="text-lg font-bold text-text-primary">{$usageStats.streak_days} days</div>
                <div class="text-xs text-text-muted">Current Streak</div>
              </div>
            </div>
          </div>
          <div class="p-3 bg-surface-elevated rounded-lg">
            <div class="flex items-center gap-2">
              <span class="text-xl">🏆</span>
              <div>
                <div class="text-lg font-bold text-text-primary">{$usageStats.longest_streak} days</div>
                <div class="text-xs text-text-muted">Longest Streak</div>
              </div>
            </div>
          </div>
        </div>

        {#if $usageStats.session_stats.first_session_at}
          <div class="mt-3 p-3 bg-surface-elevated rounded-lg">
            <div class="flex justify-between text-sm">
              <span class="text-text-muted">Using since</span>
              <span class="text-text-primary">{formatDate($usageStats.session_stats.first_session_at)}</span>
            </div>
            {#if $usageStats.session_stats.last_session_at}
              <div class="flex justify-between text-sm mt-1">
                <span class="text-text-muted">Last activity</span>
                <span class="text-text-primary">{formatRelativeTime($usageStats.session_stats.last_session_at)}</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="grid grid-cols-2 gap-6">
        <!-- Session Types -->
        <div>
          <h3 class="text-sm font-medium text-text-primary mb-3">Session Types</h3>
          <div class="p-3 bg-surface-elevated rounded-lg space-y-2">
            <div class="flex justify-between items-center">
              <span class="text-sm text-text-secondary">SDK Sessions</span>
              <span class="text-sm font-medium text-text-primary">{$usageStats.session_stats.total_sdk_sessions}</span>
            </div>
            <div class="w-full bg-border rounded-full h-2">
              <div
                class="bg-accent h-2 rounded-full transition-all"
                style="width: {getModelPercentage($usageStats.session_stats.total_sdk_sessions, $usageStats.session_stats.total_sessions)}%"
              ></div>
            </div>
            <div class="flex justify-between items-center mt-2">
              <span class="text-sm text-text-secondary">PTY Sessions</span>
              <span class="text-sm font-medium text-text-primary">{$usageStats.session_stats.total_pty_sessions}</span>
            </div>
            <div class="w-full bg-border rounded-full h-2">
              <div
                class="bg-success h-2 rounded-full transition-all"
                style="width: {getModelPercentage($usageStats.session_stats.total_pty_sessions, $usageStats.session_stats.total_sessions)}%"
              ></div>
            </div>
          </div>
        </div>

        <!-- Model Usage -->
        {#if $usageStats.model_usage.opus_sessions + $usageStats.model_usage.sonnet_sessions + $usageStats.model_usage.haiku_sessions > 0}
          {@const totalModels = $usageStats.model_usage.opus_sessions + $usageStats.model_usage.sonnet_sessions + $usageStats.model_usage.haiku_sessions}
          <div>
            <h3 class="text-sm font-medium text-text-primary mb-3">Model Usage</h3>
            <div class="p-3 bg-surface-elevated rounded-lg space-y-3">
              <div class="flex items-center gap-3">
                <div class="w-16 text-sm text-text-secondary">Opus</div>
                <div class="flex-1 bg-border rounded-full h-2">
                  <div class="bg-purple-500 h-2 rounded-full" style="width: {getModelPercentage($usageStats.model_usage.opus_sessions, totalModels)}%"></div>
                </div>
                <div class="w-10 text-right text-sm text-text-primary">{$usageStats.model_usage.opus_sessions}</div>
              </div>
              <div class="flex items-center gap-3">
                <div class="w-16 text-sm text-text-secondary">Sonnet</div>
                <div class="flex-1 bg-border rounded-full h-2">
                  <div class="bg-blue-500 h-2 rounded-full" style="width: {getModelPercentage($usageStats.model_usage.sonnet_sessions, totalModels)}%"></div>
                </div>
                <div class="w-10 text-right text-sm text-text-primary">{$usageStats.model_usage.sonnet_sessions}</div>
              </div>
              <div class="flex items-center gap-3">
                <div class="w-16 text-sm text-text-secondary">Haiku</div>
                <div class="flex-1 bg-border rounded-full h-2">
                  <div class="bg-green-500 h-2 rounded-full" style="width: {getModelPercentage($usageStats.model_usage.haiku_sessions, totalModels)}%"></div>
                </div>
                <div class="w-10 text-right text-sm text-text-primary">{$usageStats.model_usage.haiku_sessions}</div>
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Recording Stats -->
      {#if $usageStats.session_stats.total_recordings > 0}
        <div>
          <h3 class="text-sm font-medium text-text-primary mb-3">Voice Recording</h3>
          <div class="p-3 bg-surface-elevated rounded-lg">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <div class="text-lg font-bold text-text-primary">{formatDuration($usageStats.session_stats.total_recording_duration_ms)}</div>
                <div class="text-xs text-text-muted">Total Recording Time</div>
              </div>
              <div>
                <div class="text-lg font-bold text-text-primary">{$usageStats.session_stats.total_transcriptions}</div>
                <div class="text-xs text-text-muted">Transcriptions</div>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <div class="grid grid-cols-2 gap-6">
        <!-- Top Tools -->
        {#if $usageStats.most_used_tools.length > 0}
          <div>
            <h3 class="text-sm font-medium text-text-primary mb-3">Top Tools</h3>
            <div class="p-3 bg-surface-elevated rounded-lg">
              <div class="space-y-2">
                {#each $usageStats.most_used_tools.slice(0, 8) as [tool, count]}
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-text-secondary font-mono">{tool}</span>
                    <span class="text-sm font-medium text-text-primary">{count}</span>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}

        <!-- Repo Usage -->
        {#if $usageStats.repo_usage.length > 0}
          <div>
            <h3 class="text-sm font-medium text-text-primary mb-3">Repository Activity</h3>
            <div class="p-3 bg-surface-elevated rounded-lg">
              <div class="space-y-2">
                {#each $usageStats.repo_usage.sort((a, b) => b.session_count - a.session_count).slice(0, 5) as repo}
                  <div class="flex justify-between items-center">
                    <span class="text-sm text-text-secondary truncate flex-1">{getRepoName(repo.repo_path)}</span>
                    <div class="flex gap-3 text-sm">
                      <span class="text-text-muted">{repo.session_count} sessions</span>
                      <span class="text-text-primary">{repo.prompt_count} prompts</span>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Weekly Activity Chart (simple bars) -->
      {#if $usageStats.daily_stats.length > 0}
        {@const weeklyStats = getWeeklyStats($usageStats.daily_stats)}
        {@const maxSessions = Math.max(...weeklyStats.map(d => d.sessions), 1)}
        {@const weekTotals = getTotalForPeriod($usageStats.daily_stats, 7)}
        <div>
          <h3 class="text-sm font-medium text-text-primary mb-3">Last 7 Days</h3>
          <div class="p-3 bg-surface-elevated rounded-lg">
            <div class="flex items-end justify-between gap-2 h-24">
              {#each weeklyStats as day}
                <div class="flex-1 flex flex-col items-center gap-1">
                  <div
                    class="w-full bg-accent rounded-t transition-all min-h-[4px]"
                    style="height: {(day.sessions / maxSessions) * 100}%"
                    title="{day.sessions} sessions, {day.prompts} prompts"
                  ></div>
                  <div class="text-[10px] text-text-muted">{day.date.slice(-2)}</div>
                </div>
              {/each}
            </div>
            <div class="mt-3 pt-3 border-t border-border grid grid-cols-4 gap-2 text-center">
              <div>
                <div class="text-sm font-medium text-text-primary">{weekTotals.sessions}</div>
                <div class="text-[10px] text-text-muted">Sessions</div>
              </div>
              <div>
                <div class="text-sm font-medium text-text-primary">{weekTotals.prompts}</div>
                <div class="text-[10px] text-text-muted">Prompts</div>
              </div>
              <div>
                <div class="text-sm font-medium text-text-primary">{weekTotals.recordings}</div>
                <div class="text-[10px] text-text-muted">Recordings</div>
              </div>
              <div>
                <div class="text-sm font-medium text-text-primary">{weekTotals.toolCalls}</div>
                <div class="text-[10px] text-text-muted">Tool Calls</div>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Reset Stats -->
      <div class="border-t border-border pt-4">
        <button
          class="px-3 py-1.5 text-sm text-error border border-error/30 hover:bg-error/10 rounded transition-colors flex items-center gap-2"
          onclick={resetStats}
          disabled={resettingStats}
        >
          {#if resettingStats}
            <div class="w-3 h-3 border-2 border-error border-t-transparent rounded-full animate-spin"></div>
          {/if}
          Reset All Statistics
        </button>
        <p class="text-xs text-text-muted mt-2">This will permanently delete all usage statistics.</p>
      </div>
    </div>
  </div>
</div>
