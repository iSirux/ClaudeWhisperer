<script lang="ts">
  interface Props {
    show: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'warning' | 'danger' | 'info';
    onconfirm: () => void;
    oncancel: () => void;
  }

  let {
    show,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'warning',
    onconfirm,
    oncancel
  }: Props = $props();

  function getIconColor(): string {
    switch (variant) {
      case 'danger':
        return 'bg-red-500/20 text-red-400';
      case 'info':
        return 'bg-blue-500/20 text-blue-400';
      default:
        return 'bg-yellow-500/20 text-yellow-400';
    }
  }

  function getConfirmButtonStyle(): string {
    switch (variant) {
      case 'danger':
        return 'text-white bg-red-600 hover:bg-red-700';
      case 'info':
        return 'text-white bg-blue-600 hover:bg-blue-700';
      default:
        return 'text-white bg-red-600 hover:bg-red-700';
    }
  }
</script>

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={oncancel}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-surface border border-border rounded-lg shadow-xl p-5 max-w-sm mx-4"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-start gap-3 mb-4">
        <div
          class="flex-shrink-0 w-10 h-10 rounded-full {getIconColor()} flex items-center justify-center"
        >
          {#if variant === 'danger'}
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          {:else if variant === 'info'}
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          {:else}
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          {/if}
        </div>
        <div>
          <h3 class="text-lg font-semibold text-text-primary mb-1">{title}</h3>
          <p class="text-sm text-text-muted">{message}</p>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <button
          class="px-4 py-2 text-sm font-medium text-text-muted hover:text-text-primary hover:bg-surface-elevated rounded-md transition-colors"
          onclick={oncancel}
        >
          {cancelLabel}
        </button>
        <button class="px-4 py-2 text-sm font-medium {getConfirmButtonStyle()} rounded-md transition-colors" onclick={onconfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
