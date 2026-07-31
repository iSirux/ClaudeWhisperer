<script lang="ts">
  /**
   * Small modal that wraps `RecurrenceEditor` for the two "Recurring…" entry
   * points (the session prompt input and the New Session view). It only edits
   * the label + rule; the caller builds the actual Schedule entity so it can
   * attach the right target (message vs. session).
   *
   * Escape and backdrop click cancel, matching `ConfirmDialog`.
   */
  import RecurrenceEditor from './RecurrenceEditor.svelte';
  import type { RecurrenceRule } from '$lib/stores/schedules';

  interface Props {
    show: boolean;
    /** Dialog heading, e.g. "Repeat this message". */
    title: string;
    /** The prompt this schedule will run — shown read-only as confirmation. */
    promptPreview?: string;
    /** Short line under the title describing what firing will do. */
    description?: string;
    onSave: (rule: RecurrenceRule, label: string) => void;
    onCancel: () => void;
  }

  let { show, title, promptPreview = '', description, onSave, onCancel }: Props = $props();

  const DEFAULT_RULE: RecurrenceRule = {
    time: { hour: 9, minute: 0 },
    pattern: { kind: 'weekly', days: [1, 2, 3, 4, 5] },
  };

  let rule = $state<RecurrenceRule>(DEFAULT_RULE);
  let label = $state('');
  let wasShown = $state(false);

  // Reset to defaults every time the dialog opens so a cancelled edit never
  // leaks into the next one.
  $effect(() => {
    if (show && !wasShown) {
      rule = DEFAULT_RULE;
      label = '';
    }
    wasShown = show;
  });

  function handleKeydown(event: KeyboardEvent) {
    if (!show) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  }

  const trimmedPreview = $derived(
    promptPreview.length > 240 ? `${promptPreview.slice(0, 240).trimEnd()}…` : promptPreview
  );
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={onCancel}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-surface border border-border rounded-lg shadow-xl p-5 w-[min(30rem,calc(100vw-2rem))] max-h-[85vh] overflow-y-auto"
      onclick={(e) => e.stopPropagation()}
    >
      <h3 class="text-base font-semibold text-text-primary mb-1">{title}</h3>
      {#if description}
        <p class="text-xs text-text-muted mb-3">{description}</p>
      {/if}

      {#if trimmedPreview}
        <div class="mb-3 p-2 rounded border border-border bg-surface-elevated text-xs text-text-secondary whitespace-pre-wrap">
          {trimmedPreview}
        </div>
      {/if}

      <label class="block mb-3">
        <span class="block text-[0.7rem] text-text-muted mb-1">Label (optional)</span>
        <input
          class="w-full px-2 py-1.5 text-sm bg-surface-elevated border border-border rounded text-text-primary focus:outline-none focus:border-accent"
          type="text"
          bind:value={label}
          placeholder="Derived from the prompt when empty"
        />
      </label>

      <RecurrenceEditor {rule} onChange={(next) => (rule = next)} />

      <div class="flex justify-end gap-2 mt-4">
        <button
          class="px-3 py-1.5 text-sm font-medium text-text-muted hover:text-text-primary hover:bg-surface-elevated rounded-md transition-colors"
          onclick={onCancel}
        >
          Cancel
        </button>
        <button
          class="px-3 py-1.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors"
          onclick={() => onSave(rule, label.trim())}
        >
          Create schedule
        </button>
      </div>
    </div>
  </div>
{/if}
