<script lang="ts">
  import { onMount } from 'svelte';
  import SessionsOverlay from '$lib/components/SessionsOverlay.svelte';
  import { sessionsOverlay } from '$lib/stores/sessionsOverlay';

  onMount(async () => {
    // Position overlay at bottom right
    await sessionsOverlay.positionBottomRight();
  });
</script>

<div class="overlay-container">
  <SessionsOverlay />
</div>

<style>
  .overlay-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  :global(body) {
    background: transparent !important;
    overflow: hidden;
    margin: 0;
    padding: 0;
  }

  :global(html) {
    background: transparent !important;
  }
</style>
