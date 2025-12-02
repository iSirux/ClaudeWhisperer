<script lang="ts">
  import { onMount } from 'svelte';
  import Overlay from '$lib/components/Overlay.svelte';
  import { settings } from '$lib/stores/settings';
  import { overlay } from '$lib/stores/overlay';

  onMount(async () => {
    await settings.load();

    // Apply saved theme
    document.documentElement.setAttribute('data-theme', $settings.theme);

    await overlay.centerTop();
  });
</script>

<div class="overlay-container">
  <Overlay />
</div>

<style>
  .overlay-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    padding: 8px;
  }

  :global(body) {
    background: transparent !important;
    overflow: hidden;
  }

  :global(html) {
    background: transparent !important;
  }
</style>
