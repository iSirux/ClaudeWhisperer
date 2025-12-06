<script lang="ts">
  let {
    onSendPrompt,
  }: {
    onSendPrompt: (prompt: string) => void;
  } = $props();

  const quickActions = [
    { label: 'Implement', prompt: 'Please implement this.' },
    { label: 'Fix', prompt: 'Please fix the issues.' },
    { label: 'Keep going', prompt: 'Please continue.' },
  ];
</script>

<div class="quick-actions">
  <span class="quick-actions-label">Quick actions:</span>
  <div class="quick-actions-buttons">
    {#each quickActions as action}
      <button
        class="quick-action-button"
        onclick={() => onSendPrompt(action.prompt)}
        title={action.prompt}
      >
        {action.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .quick-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.75rem 0;
    margin-top: 0.5rem;
    border-top: 1px dashed var(--color-border);
  }

  .quick-actions-label {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    white-space: nowrap;
  }

  .quick-actions-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .quick-action-button {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.75rem;
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    min-width: unset;
  }

  .quick-action-button:hover {
    background: var(--color-surface-elevated);
    color: var(--color-text-primary);
    border-color: var(--color-accent);
  }

  .quick-action-button:active {
    transform: scale(0.97);
  }
</style>
