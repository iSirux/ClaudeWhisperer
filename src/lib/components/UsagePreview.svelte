<script lang="ts">
  import { onMount } from 'svelte';
  import { usageStats, formatTokens, formatCost } from '$lib/stores/usageStats';
  import { appSessionUsage } from '$lib/stores/sdkSessions';
  import { goto } from '$app/navigation';

  onMount(() => {
    usageStats.load();
  });

  function navigateToUsage() {
    goto('/usage');
  }

  // App session usage - cumulative across all SDK sessions since app launch
  let appUsage = $derived($appSessionUsage);
  let appTokens = $derived(
    appUsage.totalInputTokens + appUsage.totalOutputTokens +
    appUsage.progressiveInputTokens + appUsage.progressiveOutputTokens
  );
  let appCost = $derived(appUsage.totalCostUsd);
  let hasAppUsage = $derived(appTokens > 0 || appCost > 0);
</script>

<button
  class="usage-preview"
  onclick={navigateToUsage}
  title="App session usage - click for details"
>
  {#if hasAppUsage}
    <div class="preview-content">
      <span class="app-cost">{formatCost(appCost)}</span>
      <span class="app-tokens">{formatTokens(appTokens)}</span>
    </div>
  {:else}
    <div class="preview-content empty">
      <svg class="icon" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
      </svg>
      <span>Usage</span>
    </div>
  {/if}
</button>

<style>
  .usage-preview {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.625rem;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .usage-preview:hover {
    background: var(--color-border);
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }

  .preview-content {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .preview-content.empty {
    gap: 0.25rem;
  }

  .icon {
    width: 14px;
    height: 14px;
    opacity: 0.7;
  }

  .app-cost {
    color: var(--color-accent);
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .app-tokens {
    color: var(--color-text-secondary);
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }
</style>
