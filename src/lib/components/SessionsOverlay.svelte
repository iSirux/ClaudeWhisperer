<script lang="ts">
  import { remoteSessionStats, type SessionStatsData } from '$lib/stores/sessionStats';
  import { sessionsOverlay } from '$lib/stores/sessionsOverlay';
  import { onMount, onDestroy } from 'svelte';

  let stats: SessionStatsData = { active: 0, done: 0, error: 0, total: 0 };
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let windowStartX = 0;
  let windowStartY = 0;

  onMount(async () => {
    await remoteSessionStats.init();

    // Add global mouse event listeners for dragging
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  });

  onDestroy(() => {
    remoteSessionStats.cleanup();
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  });

  function handleMouseDown(e: MouseEvent) {
    // Middle mouse button closes the overlay
    if (e.button === 1) {
      e.preventDefault();
      sessionsOverlay.hide();
      return;
    }

    // Left mouse button starts dragging
    if (e.button === 0) {
      isDragging = true;
      dragStartX = e.screenX;
      dragStartY = e.screenY;

      // Get current window position
      const pos = sessionsOverlay.getPosition();
      windowStartX = pos.x;
      windowStartY = pos.y;
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    const deltaX = e.screenX - dragStartX;
    const deltaY = e.screenY - dragStartY;

    const newX = windowStartX + deltaX;
    const newY = windowStartY + deltaY;

    sessionsOverlay.setPosition(newX, newY);
  }

  function handleMouseUp() {
    if (isDragging) {
      isDragging = false;
      // Save position when dragging ends
      sessionsOverlay.savePosition();
    }
  }

  function handleClose() {
    sessionsOverlay.hide();
  }

  $: stats = $remoteSessionStats;
  $: hasAnySessions = stats.active > 0 || stats.done > 0 || stats.error > 0;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="status-bar"
  class:dragging={isDragging}
  onmousedown={handleMouseDown}
>
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

  <button class="close-btn" onclick={handleClose} title="Close (or middle-click)">
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <path d="M1.5 0L5 3.5L8.5 0L10 1.5L6.5 5L10 8.5L8.5 10L5 6.5L1.5 10L0 8.5L3.5 5L0 1.5L1.5 0Z"/>
    </svg>
  </button>
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
    cursor: grab;
    user-select: none;
  }

  .status-bar.dragging {
    cursor: grabbing;
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

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    margin-left: 4px;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: rgba(148, 163, 184, 0.5);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    background: rgba(148, 163, 184, 0.2);
    color: rgba(148, 163, 184, 0.9);
  }

  .close-btn:active {
    background: rgba(148, 163, 184, 0.3);
  }
</style>
