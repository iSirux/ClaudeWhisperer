<script lang="ts">
  import type { SdkSessionUsage } from '$lib/stores/sdkSessions';
  import { formatTokens, formatCost } from '$lib/stores/usageStats';

  let { usage, isQuerying = false }: { usage: SdkSessionUsage; isQuerying?: boolean } = $props();

  let liveInputTokens = $derived(usage.totalInputTokens + usage.progressiveInputTokens);
  let liveOutputTokens = $derived(usage.totalOutputTokens + usage.progressiveOutputTokens);
  let liveCacheReadTokens = $derived(usage.totalCacheReadTokens + usage.progressiveCacheReadTokens);
</script>

<div class="session-header">
  <div class="usage-bar" class:querying={isQuerying}>
    <div class="usage-stats">
      <span class="usage-stat" class:live={usage.progressiveInputTokens > 0} title="Input tokens{usage.progressiveInputTokens > 0 ? ' (live)' : ''}">
        <svg class="usage-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 8a.5.5 0 0 1 .5-.5h5.793L8.146 5.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 8.5H4.5A.5.5 0 0 1 4 8z"/>
        </svg>
        {formatTokens(liveInputTokens)}
      </span>
      <span class="usage-stat" class:live={usage.progressiveOutputTokens > 0} title="Output tokens{usage.progressiveOutputTokens > 0 ? ' (live)' : ''}">
        <svg class="usage-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M12 8a.5.5 0 0 1-.5.5H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5H11.5a.5.5 0 0 1 .5.5z"/>
        </svg>
        {formatTokens(liveOutputTokens)}
      </span>
      {#if liveCacheReadTokens > 0}
        <span class="usage-stat cache" class:live={usage.progressiveCacheReadTokens > 0} title="Cache read tokens (reduced cost){usage.progressiveCacheReadTokens > 0 ? ' (live)' : ''}">
          <svg class="usage-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/>
          </svg>
          {formatTokens(liveCacheReadTokens)}
        </span>
      {/if}
      {#if usage.totalCostUsd > 0}
        <span class="usage-stat cost" title="Total cost">
          {formatCost(usage.totalCostUsd)}
        </span>
      {/if}
    </div>
    <div class="context-bar-container" title="Context usage: {usage.contextUsagePercent.toFixed(1)}% of {formatTokens(usage.contextWindow)}">
      <div class="context-bar-bg">
        <div
          class="context-bar-fill"
          class:warning={usage.contextUsagePercent > 70}
          class:danger={usage.contextUsagePercent > 90}
          class:live={isQuerying && (usage.progressiveInputTokens > 0 || usage.progressiveOutputTokens > 0)}
          style="width: {Math.min(100, usage.contextUsagePercent)}%"
        ></div>
      </div>
      <span class="context-percent">{usage.contextUsagePercent.toFixed(0)}%</span>
    </div>
  </div>
</div>

<style>
  .session-header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 0.5rem 1rem;
    background: #1e293b;
    border-bottom: 1px solid #334155;
    font-size: 0.85rem;
  }

  .usage-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .usage-stats {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-shrink: 0;
  }

  .usage-stat {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: #94a3b8;
    font-size: 0.75rem;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .usage-stat.cache {
    color: #22c55e;
  }

  .usage-stat.cost {
    color: #f59e0b;
    font-weight: 600;
  }

  .usage-icon {
    width: 12px;
    height: 12px;
    opacity: 0.7;
  }

  .context-bar-container {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
  }

  .context-bar-bg {
    flex: 1;
    height: 6px;
    background: #334155;
    border-radius: 3px;
    overflow: hidden;
  }

  .context-bar-fill {
    height: 100%;
    background: #3b82f6;
    border-radius: 3px;
    transition: width 0.3s ease, background 0.3s ease;
  }

  .context-bar-fill.warning {
    background: #f59e0b;
  }

  .context-bar-fill.danger {
    background: #ef4444;
  }

  .usage-bar.querying {
    border-color: #3b82f6;
  }

  .usage-stat.live {
    color: #60a5fa;
    animation: pulse-value 1.5s ease-in-out infinite;
  }

  .usage-stat.cache.live {
    color: #4ade80;
  }

  .context-bar-fill.live {
    animation: pulse-bar 1.5s ease-in-out infinite;
  }

  @keyframes pulse-value {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.7;
    }
  }

  @keyframes pulse-bar {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.8;
    }
  }

  .context-percent {
    font-size: 0.7rem;
    color: #64748b;
    font-weight: 500;
    min-width: 32px;
    text-align: right;
  }
</style>
