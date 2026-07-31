<script lang="ts">
  /**
   * Editor for a `RecurrenceRule` — pattern kind, its per-kind options, the
   * wall-clock time, and the optional end conditions. Fully controlled: every
   * change is emitted through `onChange` with a fresh rule object, and the live
   * "Next: …" preview is computed from that same rule via `computeNextFire`, so
   * what the user sees is exactly what the driver will do.
   */
  import {
    computeNextFire,
    describeScheduleSpec,
    WEEKDAY_ORDER,
    type RecurrencePattern,
    type RecurrenceRule,
    type Weekday,
  } from '$lib/stores/schedules';
  import { formatScheduleTarget } from '$lib/utils/duration';

  interface Props {
    rule: RecurrenceRule;
    onChange: (rule: RecurrenceRule) => void;
    /**
     * Recurrence anchor (a schedule's `createdAt`) — aligns the every-N-weeks /
     * every-N-days phase so the preview matches the saved schedule.
     */
    anchor?: number;
    /** Current run count, so a `maxRuns` limit previews correctly. */
    runCount?: number;
  }

  let { rule, onChange, anchor = Date.now(), runCount = 0 }: Props = $props();

  const WEEKDAY_LABELS: Record<Weekday, string> = {
    0: 'Sun',
    1: 'Mon',
    2: 'Tue',
    3: 'Wed',
    4: 'Thu',
    5: 'Fri',
    6: 'Sat',
  };

  type PatternKind = RecurrencePattern['kind'];

  const PATTERN_OPTIONS: { value: PatternKind; label: string }[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'interval', label: 'Every N days' },
  ];

  const pattern = $derived(rule.pattern);
  const timeValue = $derived(
    `${String(rule.time?.hour ?? 9).padStart(2, '0')}:${String(rule.time?.minute ?? 0).padStart(2, '0')}`
  );

  const selectedDays = $derived(
    pattern.kind === 'weekly' ? new Set(pattern.days ?? []) : new Set<Weekday>()
  );
  const everyNWeeks = $derived(
    pattern.kind === 'weekly' ? Math.max(1, Math.floor(pattern.everyNWeeks || 1)) : 1
  );
  const everyNDays = $derived(
    pattern.kind === 'interval' ? Math.max(1, Math.floor(pattern.everyNDays || 1)) : 1
  );
  const monthlyDay = $derived(pattern.kind === 'monthly' ? pattern.day : 1);

  const nextFire = $derived(
    computeNextFire({ kind: 'recurring', rule }, Date.now(), anchor, runCount)
  );
  const summary = $derived(describeScheduleSpec({ kind: 'recurring', rule }));

  function emit(patch: Partial<RecurrenceRule>) {
    onChange({ ...rule, ...patch });
  }

  /** Switching kind keeps the time but rebuilds the kind-specific options with sane defaults. */
  function setPatternKind(kind: PatternKind) {
    if (kind === pattern.kind) return;
    let next: RecurrencePattern;
    if (kind === 'daily') next = { kind: 'daily' };
    else if (kind === 'weekly') next = { kind: 'weekly', days: [1, 2, 3, 4, 5] };
    else if (kind === 'monthly') next = { kind: 'monthly', day: 1 };
    else next = { kind: 'interval', everyNDays: 2 };
    emit({ pattern: next });
  }

  function toggleDay(day: Weekday) {
    if (pattern.kind !== 'weekly') return;
    const days = new Set(pattern.days ?? []);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    // Keep the stored order Monday-first so persisted rules read consistently.
    emit({
      pattern: { ...pattern, days: WEEKDAY_ORDER.filter((d) => days.has(d)) },
    });
  }

  function setEveryNWeeks(value: number) {
    if (pattern.kind !== 'weekly') return;
    const every = Math.min(12, Math.max(1, Math.round(value) || 1));
    emit({ pattern: { ...pattern, everyNWeeks: every > 1 ? every : undefined } });
  }

  function setEveryNDays(value: number) {
    if (pattern.kind !== 'interval') return;
    emit({
      pattern: { kind: 'interval', everyNDays: Math.min(365, Math.max(1, Math.round(value) || 1)) },
    });
  }

  function setMonthlyDay(raw: string) {
    emit({ pattern: { kind: 'monthly', day: raw === 'last' ? 'last' : Number(raw) } });
  }

  function setTime(raw: string) {
    const [h, m] = raw.split(':');
    const hour = Math.min(23, Math.max(0, Number(h) || 0));
    const minute = Math.min(59, Math.max(0, Number(m) || 0));
    emit({ time: { hour, minute } });
  }

  // --- End conditions (both optional and independent) ---

  /** `YYYY-MM-DD` in local time for the end-date input. */
  function toDateInput(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const endDateValue = $derived(rule.endAt != null ? toDateInput(rule.endAt) : '');

  function toggleEndDate(enabled: boolean) {
    if (!enabled) {
      emit({ endAt: undefined });
      return;
    }
    // Default to a month out so enabling the checkbox never instantly ends the series.
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    d.setHours(23, 59, 0, 0);
    emit({ endAt: d.getTime() });
  }

  function setEndDate(raw: string) {
    if (!raw) {
      emit({ endAt: undefined });
      return;
    }
    // End of the chosen day, so an occurrence on that date still runs.
    const [y, m, d] = raw.split('-').map(Number);
    emit({ endAt: new Date(y, (m || 1) - 1, d || 1, 23, 59, 0, 0).getTime() });
  }

  function toggleMaxRuns(enabled: boolean) {
    emit({ maxRuns: enabled ? Math.max(1, rule.maxRuns ?? 10) : undefined });
  }

  function setMaxRuns(value: number) {
    emit({ maxRuns: Math.max(1, Math.round(value) || 1) });
  }
</script>

<div class="recurrence">
  <div class="row">
    <label class="field">
      <span class="field-label">Repeats</span>
      <select
        class="control"
        value={pattern.kind}
        onchange={(e) => setPatternKind(e.currentTarget.value as PatternKind)}
      >
        {#each PATTERN_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>

    <label class="field field--narrow">
      <span class="field-label">At</span>
      <input
        class="control"
        type="time"
        value={timeValue}
        onchange={(e) => setTime(e.currentTarget.value)}
      />
    </label>
  </div>

  {#if pattern.kind === 'weekly'}
    <div class="field">
      <span class="field-label">On days</span>
      <div class="day-chips">
        {#each WEEKDAY_ORDER as day (day)}
          <button
            class="day-chip"
            class:active={selectedDays.has(day)}
            type="button"
            onclick={() => toggleDay(day)}
          >
            {WEEKDAY_LABELS[day]}
          </button>
        {/each}
      </div>
      {#if selectedDays.size === 0}
        <p class="warn">Pick at least one day — the schedule can't fire otherwise.</p>
      {/if}
    </div>

    <label class="field field--narrow">
      <span class="field-label">Every N weeks</span>
      <input
        class="control"
        type="number"
        min="1"
        max="12"
        value={everyNWeeks}
        onchange={(e) => setEveryNWeeks(Number(e.currentTarget.value))}
      />
    </label>
  {:else if pattern.kind === 'monthly'}
    <label class="field field--narrow">
      <span class="field-label">Day of month</span>
      <select
        class="control"
        value={monthlyDay === 'last' ? 'last' : String(monthlyDay)}
        onchange={(e) => setMonthlyDay(e.currentTarget.value)}
      >
        {#each Array.from({ length: 28 }, (_, i) => i + 1) as day (day)}
          <option value={String(day)}>{day}</option>
        {/each}
        <option value="last">Last day</option>
      </select>
    </label>
  {:else if pattern.kind === 'interval'}
    <label class="field field--narrow">
      <span class="field-label">Every N days</span>
      <input
        class="control"
        type="number"
        min="1"
        max="365"
        value={everyNDays}
        onchange={(e) => setEveryNDays(Number(e.currentTarget.value))}
      />
    </label>
  {/if}

  <div class="end-conditions">
    <label class="check">
      <input
        type="checkbox"
        class="accent-accent"
        checked={rule.endAt != null}
        onchange={(e) => toggleEndDate(e.currentTarget.checked)}
      />
      End on
    </label>
    {#if rule.endAt != null}
      <input
        class="control control--inline"
        type="date"
        value={endDateValue}
        onchange={(e) => setEndDate(e.currentTarget.value)}
      />
    {/if}

    <label class="check">
      <input
        type="checkbox"
        class="accent-accent"
        checked={rule.maxRuns != null}
        onchange={(e) => toggleMaxRuns(e.currentTarget.checked)}
      />
      Stop after
    </label>
    {#if rule.maxRuns != null}
      <input
        class="control control--inline control--tiny"
        type="number"
        min="1"
        value={rule.maxRuns}
        onchange={(e) => setMaxRuns(Number(e.currentTarget.value))}
      />
      <span class="hint">runs</span>
    {/if}
  </div>

  <p class="preview">
    <span class="preview-summary">{summary}</span>
    {#if nextFire != null}
      <span class="preview-next">Next: {formatScheduleTarget(nextFire)}</span>
    {:else}
      <span class="preview-next preview-next--none">No upcoming run</span>
    {/if}
  </p>
</div>

<style>
  .recurrence {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .row {
    display: flex;
    gap: 0.65rem;
    flex-wrap: wrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
    flex: 1;
  }

  .field--narrow {
    flex: 0 0 auto;
    min-width: 7rem;
  }

  .field-label {
    font-size: 0.7rem;
    color: var(--color-text-muted);
  }

  .control {
    padding: 0.35rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text-primary);
    font-size: 0.8rem;
    font-family: inherit;
  }

  .control:focus {
    outline: none;
    border-color: var(--color-accent);
  }

  .control--inline {
    padding: 0.2rem 0.4rem;
    font-size: 0.75rem;
  }

  .control--tiny {
    width: 4rem;
  }

  .day-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .day-chip {
    padding: 0.25rem 0.5rem;
    border-radius: 0.375rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    font-size: 0.72rem;
    font-weight: 500;
    transition: all 0.15s ease;
  }

  .day-chip:hover {
    background: var(--color-surface-elevated);
  }

  .day-chip.active {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: white;
  }

  .end-conditions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem 0.65rem;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    cursor: pointer;
  }

  .hint {
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }

  .warn {
    margin: 0;
    font-size: 0.7rem;
    color: var(--color-warning, #f59e0b);
  }

  .preview {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    padding-top: 0.15rem;
    border-top: 1px solid var(--color-border);
    font-size: 0.75rem;
  }

  .preview-summary {
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .preview-next {
    color: var(--color-accent);
  }

  .preview-next--none {
    color: var(--color-text-muted);
  }
</style>
