<script lang="ts">
  /**
   * Compact "pick a moment" panel: a row of one-click presets plus a
   * `datetime-local` fallback for anything else. Emits an epoch-ms instant via
   * `onPick`; the host owns what happens with it (park a turn, launch a session,
   * retime a schedule).
   *
   * Presets whose instant has already passed are HIDDEN rather than rolled
   * forward — "Tonight 20:00" silently meaning tomorrow would be a trap.
   */
  import { untrack } from 'svelte';
  import { formatScheduleTarget } from '$lib/utils/duration';

  interface Props {
    /** Currently chosen instant (epoch ms), used to seed the custom input. */
    value?: number | null;
    onPick: (at: number) => void;
    /** Label of the custom-time confirm button. */
    confirmLabel?: string;
    /** Rendered above the presets when set. */
    heading?: string;
  }

  let { value = null, onPick, confirmLabel = 'Set', heading }: Props = $props();

  /**
   * Re-evaluated on every mount/open so a panel opened at 21:00 doesn't still
   * offer "Tonight 20:00" from an earlier render.
   */
  const now = Date.now();

  function atToday(hour: number, minute: number, dayOffset = 0): number {
    const d = new Date(now);
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  }

  /** Next Monday at `hour`:00 — strictly in the future (today counts as "this" Monday). */
  function nextMonday(hour: number): number {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    const daysUntilMonday = (8 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    return d.getTime();
  }

  const presets = $derived(
    [
      { label: 'In 30 min', at: now + 30 * 60_000 },
      { label: 'In 1 h', at: now + 60 * 60_000 },
      { label: 'In 3 h', at: now + 3 * 60 * 60_000 },
      { label: 'Tonight 20:00', at: atToday(20, 0) },
      { label: 'Tomorrow 09:00', at: atToday(9, 0, 1) },
      { label: 'Next Monday 09:00', at: nextMonday(9) },
    ].filter((p) => p.at > now)
  );

  /** `YYYY-MM-DDTHH:mm` in local time — the shape `datetime-local` expects. */
  function toLocalInput(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Seeded once on mount by design — the panel is re-created each time it opens,
  // and re-seeding mid-edit would fight the user's typing.
  let customValue = $state(untrack(() => toLocalInput(value ?? now + 60 * 60_000)));

  // `datetime-local` strings have no zone, so `new Date(...)` reads them as local
  // wall-clock — exactly the policy the recurrence math uses.
  const customAt = $derived.by(() => {
    const parsed = new Date(customValue).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  });
  const customValid = $derived(customAt != null);

  function confirmCustom() {
    if (customAt == null) return;
    onPick(customAt);
  }

  function handleCustomKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    confirmCustom();
  }
</script>

<div class="picker">
  {#if heading}
    <p class="picker-heading">{heading}</p>
  {/if}

  {#if presets.length > 0}
    <div class="preset-grid">
      {#each presets as preset (preset.label)}
        <button
          class="preset-btn"
          type="button"
          title={formatScheduleTarget(preset.at, now)}
          onclick={() => onPick(preset.at)}
        >
          {preset.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="custom-row">
    <input
      class="custom-input"
      type="datetime-local"
      bind:value={customValue}
      onkeydown={handleCustomKeydown}
      aria-label="Custom date and time"
    />
    <button class="confirm-btn" type="button" disabled={!customValid} onclick={confirmCustom}>
      {confirmLabel}
    </button>
  </div>

  {#if customAt != null}
    <p class="custom-preview">{formatScheduleTarget(customAt, now)}</p>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 15rem;
  }

  .picker-heading {
    margin: 0;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-text-muted);
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem;
  }

  .preset-btn {
    padding: 0.35rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    font-size: 0.75rem;
    font-weight: 500;
    text-align: center;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .preset-btn:hover {
    background: var(--color-surface-elevated);
    border-color: var(--color-accent);
  }

  .custom-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .custom-input {
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    font-size: 0.75rem;
    font-family: inherit;
  }

  .custom-input:focus {
    outline: none;
    border-color: var(--color-accent);
  }

  .confirm-btn {
    flex-shrink: 0;
    padding: 0.35rem 0.7rem;
    border-radius: 0.375rem;
    background: var(--color-accent);
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    transition: background 0.15s ease;
  }

  .confirm-btn:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  .confirm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .custom-preview {
    margin: 0;
    font-size: 0.7rem;
    color: var(--color-text-muted);
  }
</style>
