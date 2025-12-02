<script lang="ts">
  import { onMount } from 'svelte';
  import SessionsOverlay from '$lib/components/SessionsOverlay.svelte';
  import { settings } from '$lib/stores/settings';
  import { sessionsOverlay } from '$lib/stores/sessionsOverlay';
  import { sessions } from '$lib/stores/sessions';
  import { sdkSessions } from '$lib/stores/sdkSessions';

  onMount(async () => {
    await settings.load();
    await sessions.init();

    // Apply saved theme
    document.documentElement.setAttribute('data-theme', $settings.theme);

    // Position overlay at bottom right
    await sessionsOverlay.positionBottomRight();

    // Show overlay if enabled and there are sessions
    if ($settings.overlay.sessions_overlay_enabled) {
      const hasActiveSessions =
        $sessions.some(s => s.status === 'Running' || s.status === 'Starting') ||
        $sdkSessions.some(s => s.status === 'querying');

      if (hasActiveSessions) {
        await sessionsOverlay.show();
      }
    }
  });
</script>

<div class="overlay-container">
  <SessionsOverlay />
</div>

<style>
  .overlay-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
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
