<script lang="ts">
  import { remoteSessionStats, type SessionStatsData } from '$lib/stores/sessionStats';
  import { onMount, onDestroy } from 'svelte';

  let stats: SessionStatsData = { active: 0, done: 0, error: 0, total: 0 };

  onMount(async () => {
    await remoteSessionStats.init();
  });

  onDestroy(() => {
    remoteSessionStats.cleanup();
  });

  $: stats = $remoteSessionStats;
  $: hasAnySessions = stats.active > 0 || stats.done > 0 || stats.error > 0;
</script>

<div class="status-bar">
  {#if hasAnySessions}
    {#if stats.active > 0}
      <div class="stat active">
        <span class="dot"></span>
        <span class="count">{stats.active}</span>
      </div>
    {/if}
    {#if stats.done > 0}
      <div class="stat done">
        <span class="dot"></span>
        <span class="count">{stats.done}</span>
      </div>
    {/if}
    {#if stats.error > 0}
      <div class="stat error">
        <span class="dot"></span>
        <span class="count">{stats.error}</span>
      </div>
    {/if}
  {:else}
    <span class="idle">No sessions</span>
  {/if}
</div>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 12px;
    background: rgba(15, 23, 42, 0.92);
    backdrop-filter: blur(8px);
    border-radius: 16px;
    border: 1px solid rgba(148, 163, 184, 0.15);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    font-size: 12px;
    font-family: system-ui, -apple-system, sans-serif;
    white-space: nowrap;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .count {
    font-weight: 600;
    font-size: 11px;
  }

  .active .dot {
    background: #34d399;
    box-shadow: 0 0 6px #34d399;
  }

  .active .count {
    color: #34d399;
  }

  .done .dot {
    background: #60a5fa;
  }

  .done .count {
    color: #60a5fa;
  }

  .error .dot {
    background: #f87171;
  }

  .error .count {
    color: #f87171;
  }

  .idle {
    color: rgba(148, 163, 184, 0.6);
    font-size: 11px;
  }
</style>
