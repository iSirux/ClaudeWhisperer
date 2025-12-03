<script lang="ts">
  import '../styles/app.css';
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';

  // Prevent browser back/forward navigation from causing full page reloads
  // This app uses internal state for navigation, not URL-based routing
  onMount(() => {
    // Replace current history state to prevent back navigation
    history.replaceState({ ...history.state, preventNav: true }, '');

    // Listen for popstate (back/forward button) and prevent navigation
    const handlePopState = (event: PopStateEvent) => {
      // Push the current state back to prevent navigation
      history.pushState({ ...history.state, preventNav: true }, '', window.location.href);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  });

  // Also intercept SvelteKit's navigation system
  beforeNavigate(({ cancel, to, from }) => {
    // Allow navigation to different routes (settings modal, overlay, etc.)
    // but prevent back/forward browser navigation that would reload the app
    if (to?.url.pathname === from?.url.pathname) {
      cancel();
    }
  });
</script>

<slot />
