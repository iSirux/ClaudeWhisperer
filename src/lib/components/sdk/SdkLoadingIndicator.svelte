<script lang="ts">
  let { statusMessage }: { statusMessage: string } = $props();
</script>

<div class="message message-loading">
  <div class="loading-indicator">
    <span class="loading-dot"></span>
    <span class="loading-dot"></span>
    <span class="loading-dot"></span>
  </div>
  <span class="loading-text">{statusMessage}</span>
</div>

<style>
  .message-loading {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    color: #888;
  }

  .loading-indicator {
    display: flex;
    gap: 4px;
  }

  .loading-dot {
    width: 6px;
    height: 6px;
    background: #6366f1;
    border-radius: 50%;
    animation: bounce 1.4s ease-in-out infinite;
  }

  .loading-dot:nth-child(1) {
    animation-delay: 0s;
  }
  .loading-dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .loading-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes bounce {
    0%,
    80%,
    100% {
      transform: translateY(0);
    }
    40% {
      transform: translateY(-6px);
    }
  }

  .loading-text {
    font-size: 0.85rem;
  }
</style>
