/**
 * Native scheduling — Schedule entity store + fire driver.
 *
 * A Schedule is a durable rule that *spawns* work when it fires: either a brand
 * new SDK session in a repo, or a follow-up turn on an existing session. Unlike
 * the Smart Queue's parked items (a one-shot custom time rides those rails), a
 * schedule is never consumed — a recurring rule keeps rolling forward and a
 * managed one-shot simply ends with `nextFireAt = null`.
 *
 * Schedules are persisted to their own file via the `get_schedules` /
 * `save_schedules` Tauri commands (frontend owns the schema — the backend stores
 * opaque JSON), mirroring the pile.
 *
 * The local PC wall clock is the source of truth (same policy as the sequences
 * scheduler): all recurrence math runs in local time via `Date`, so DST shifts
 * are handled naturally.
 */

import { writable, derived, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';

import { repos, findRepoById } from './repos';
import { sdkSessions, hasBusySessionsInScope, type EffortLevel, type SdkSession } from './sdkSessions';
import { providerExhaustion } from './queueDetection';
import { launchSession, createSessionQueue } from '$lib/utils/sessionLaunch';
import { formatScheduleTarget } from '$lib/utils/duration';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // JS Date convention, 0 = Sunday

export interface ScheduleTime { hour: number; minute: number }

export type RecurrencePattern =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: Weekday[]; everyNWeeks?: number } // everyNWeeks >= 2 for biweekly etc.
  | { kind: 'monthly'; day: number | 'last' }                 // 1..28 or 'last'
  | { kind: 'interval'; everyNDays: number };

export interface RecurrenceRule {
  time: ScheduleTime;
  pattern: RecurrencePattern;
  endAt?: number;    // stop after this epoch ms
  maxRuns?: number;  // stop after N runs
}

export type ScheduleSpec =
  | { kind: 'at'; at: number }                 // managed one-shot
  | { kind: 'recurring'; rule: RecurrenceRule };

export interface ScheduleSessionTarget {
  kind: 'session';
  repoId: string;                 // concrete — NEVER auto-repo (no user present at fire time)
  model: string;                  // may be the Auto model id; accept LLM latency/fallback
  effortLevel: EffortLevel;
  provider: 'claude' | 'openai';
  accountId?: string;
  useWorktree: boolean;
  systemPrompt?: string;
}

export interface ScheduleMessageTarget {
  kind: 'message';
  sessionId: string;
  ifSessionGone: 'skip' | 'launch_new';
  /** Snapshot taken at creation so 'launch_new' can fall back when the session is gone. */
  fallback?: { repoId: string; model: string; effortLevel: EffortLevel; provider: 'claude' | 'openai'; accountId?: string };
  action?: 'compact';             // reuse the existing parked-turn compact action
}

export interface ScheduleRun {
  at: number;
  status: 'ok' | 'failed' | 'skipped' | 'deferred'; // deferred = launched but parked (rate limit)
  sessionId?: string;
  error?: string;
}

export interface Schedule {
  id: string;                     // crypto.randomUUID()
  label: string;                  // auto-derived from prompt (first ~60 chars) if empty at save
  enabled: boolean;               // pause/resume
  target: ScheduleSessionTarget | ScheduleMessageTarget;
  prompt: string;
  when: ScheduleSpec;
  /** Session targets only: after fire time, hold until the target repo scope is idle
   *  (hasBusySessionsInScope). Message targets ALWAYS implicitly wait for their session
   *  to be idle. */
  waitForIdle: boolean;
  catchUp: 'skip' | 'run_once';   // missed while app closed; default 'run_once'
  createdAt: number;              // also the anchor for everyNWeeks alignment
  nextFireAt: number | null;      // computed + persisted; null = spent one-shot / ended recurrence
  lastRunAt?: number;
  runCount: number;
  history: ScheduleRun[];         // newest first, capped at 20
}

/** The fields a caller must supply when creating a schedule; the rest are derived. */
export type NewSchedule = Pick<Schedule, 'target' | 'prompt' | 'when'> &
  Partial<Omit<Schedule, 'id' | 'createdAt' | 'runCount' | 'history'>>;

/** Newest-first history cap per schedule. */
const MAX_HISTORY = 20;

/** How often the driver re-evaluates (same cadence as the Smart Queue tick). */
const TICK_MS = 30_000;

// ---------------------------------------------------------------------------
// Recurrence math (pure — no store access, no side effects)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Local midnight of the day `ts` falls in. */
function startOfDay(ts: number | Date): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local Monday-midnight of the week `ts` falls in (weeks start Monday). */
function startOfWeek(ts: number | Date): Date {
  const d = startOfDay(ts);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Whole days from `a` to `b`, computed on local midnights so DST can't skew it. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

/** Non-negative modulo (JS `%` keeps the sign of the dividend). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** `day` at the rule's wall-clock time, local. */
function atTime(day: Date, time: ScheduleTime): number {
  const d = new Date(day);
  d.setHours(clamp(time?.hour ?? 0, 0, 23), clamp(time?.minute ?? 0, 0, 59), 0, 0);
  return d.getTime();
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * Next fire time (epoch ms) strictly after `after`, or null when the schedule is
 * spent (one-shot in the past, past `endAt`, or `maxRuns` reached).
 *
 * `anchor` is the schedule's `createdAt` — it aligns the `everyNWeeks` week
 * phase and the `everyNDays` day phase. `runCount` is the schedule's current run
 * count, needed only to honour `maxRuns`.
 *
 * Pure local-time date math: every candidate is built with `new Date()` +
 * `setHours`, so DST transitions resolve the same way the user's clock does.
 */
export function computeNextFire(
  spec: ScheduleSpec,
  after: number,
  anchor: number,
  runCount = 0
): number | null {
  if (spec.kind === 'at') {
    return spec.at > after ? spec.at : null;
  }

  const rule = spec.rule;
  if (rule.maxRuns != null && runCount >= rule.maxRuns) return null;

  const candidate = nextOccurrence(rule, after, anchor);
  if (candidate == null) return null;
  if (rule.endAt != null && candidate > rule.endAt) return null;
  return candidate;
}

/** First occurrence of the rule's pattern strictly after `after` (ignores end conditions). */
function nextOccurrence(rule: RecurrenceRule, after: number, anchor: number): number | null {
  const pattern = rule.pattern;
  const from = startOfDay(after);

  if (pattern.kind === 'daily') {
    for (let i = 0; i <= 1; i++) {
      const day = new Date(from);
      day.setDate(day.getDate() + i);
      const ts = atTime(day, rule.time);
      if (ts > after) return ts;
    }
    return null;
  }

  if (pattern.kind === 'interval') {
    const every = Math.max(1, Math.floor(pattern.everyNDays || 1));
    const anchorDay = startOfDay(anchor);
    // Within `every` days of today there is always a phase-matching day; +1 covers
    // the case where today matches but its wall-clock time has already passed.
    for (let i = 0; i <= every; i++) {
      const day = new Date(from);
      day.setDate(day.getDate() + i);
      if (mod(daysBetween(anchorDay, day), every) !== 0) continue;
      const ts = atTime(day, rule.time);
      if (ts > after) return ts;
    }
    return null;
  }

  if (pattern.kind === 'weekly') {
    const days = (pattern.days ?? []).filter((d) => d >= 0 && d <= 6);
    if (days.length === 0) return null; // no weekday selected — nothing to fire
    const every = Math.max(1, Math.floor(pattern.everyNWeeks || 1));
    const anchorWeek = startOfWeek(anchor);
    // Scan a full phase cycle plus one week so a matching weekday is always found.
    const horizon = 7 * every + 7;
    for (let i = 0; i <= horizon; i++) {
      const day = new Date(from);
      day.setDate(day.getDate() + i);
      if (!days.includes(day.getDay() as Weekday)) continue;
      const weeksSince = Math.floor(daysBetween(anchorWeek, startOfWeek(day)) / 7);
      if (mod(weeksSince, every) !== 0) continue;
      const ts = atTime(day, rule.time);
      if (ts > after) return ts;
    }
    return null;
  }

  // monthly — day 1..28, or the last calendar day of the month
  const base = new Date(after);
  for (let i = 0; i <= 13; i++) {
    const year = base.getFullYear();
    const month = base.getMonth() + i;
    const dayOfMonth =
      pattern.day === 'last'
        ? new Date(year, month + 1, 0).getDate() // day 0 of next month = last of this one
        : clamp(pattern.day, 1, 28);
    const ts = atTime(new Date(year, month, dayOfMonth), rule.time);
    if (ts > after) return ts;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Human-readable summaries
// ---------------------------------------------------------------------------

/** Weekday labels in JS `Date.getDay()` order (index 0 = Sunday). */
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Monday-first display order for weekday chips and summaries. */
export const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** "09:00" for a rule's wall-clock time. */
function formatRuleTime(time: ScheduleTime | undefined): string {
  const hour = clamp(time?.hour ?? 0, 0, 23);
  const minute = clamp(time?.minute ?? 0, 0, 59);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 1 → "1st", 2 → "2nd", 23 → "23rd". */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "Mon, Thu" — Monday-first, with the common sets collapsed to a word. */
function describeWeekdays(days: Weekday[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  const isWeekdays = [1, 2, 3, 4, 5].every((d) => set.has(d as Weekday)) && set.size === 5;
  if (isWeekdays) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  return WEEKDAY_ORDER.filter((d) => set.has(d))
    .map((d) => WEEKDAY_LABELS[d])
    .join(', ');
}

/**
 * One-line human summary of a schedule's timing, e.g.
 * "Weekdays 09:00" · "Every 2 weeks · Mon, Thu 08:30" · "1st of month 10:00" ·
 * "Once · Fri 09:00". Used by the schedules list and the session badges.
 */
export function describeScheduleSpec(spec: ScheduleSpec, nowMs: number = Date.now()): string {
  if (spec.kind === 'at') return `Once · ${formatScheduleTarget(spec.at, nowMs)}`;

  const rule = spec.rule;
  const time = formatRuleTime(rule.time);
  const pattern = rule.pattern;

  if (pattern.kind === 'daily') return `Daily ${time}`;

  if (pattern.kind === 'interval') {
    const every = Math.max(1, Math.floor(pattern.everyNDays || 1));
    return every === 1 ? `Daily ${time}` : `Every ${every} days ${time}`;
  }

  if (pattern.kind === 'weekly') {
    const days = (pattern.days ?? []).filter((d) => d >= 0 && d <= 6);
    const dayLabel = days.length === 0 ? 'No days selected' : describeWeekdays(days);
    const every = Math.max(1, Math.floor(pattern.everyNWeeks || 1));
    if (every > 1) return `Every ${every} weeks · ${dayLabel} ${time}`;
    return `${dayLabel} ${time}`;
  }

  const day = pattern.day === 'last' ? 'Last day' : ordinal(clamp(pattern.day, 1, 28));
  return `${day} of month ${time}`;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** First ~60 characters of the prompt, used when the user leaves the label empty. */
function deriveLabel(prompt: string): string {
  const flat = (prompt || '').replace(/\s+/g, ' ').trim();
  if (!flat) return 'Untitled schedule';
  return flat.length > 60 ? `${flat.slice(0, 60).trimEnd()}…` : flat;
}

/** Pattern kinds `computeNextFire` / `describeScheduleSpec` know how to walk. */
const PATTERN_KINDS = ['daily', 'weekly', 'monthly', 'interval'];

/**
 * Is this stored `when` structurally walkable? Both the recurrence math and the
 * human summaries dereference `rule.pattern.kind` without guards, so a truncated or
 * hand-edited spec has to be rejected here rather than thrown from a `$derived`.
 * Everything *inside* the pattern is already tolerated (missing time, out-of-range
 * day, NaN interval all clamp to sane defaults).
 */
function isValidSpec(when: ScheduleSpec | undefined): when is ScheduleSpec {
  if (!when || typeof when !== 'object') return false;
  if (when.kind === 'at') return Number.isFinite(when.at);
  if (when.kind !== 'recurring') return false;
  const rule = when.rule;
  if (!rule || typeof rule !== 'object') return false;
  return !!rule.pattern && PATTERN_KINDS.includes(rule.pattern.kind);
}

/**
 * Fill in every field a persisted schedule may be missing (older writes, hand-edited
 * files). Mirrors the tolerant `normalizeItemState` pattern in `spareTokens.ts`.
 */
function normalizeSchedule(raw: Partial<Schedule>): Schedule | null {
  if (!raw || typeof raw !== 'object' || !raw.target || !isValidSpec(raw.when)) return null;
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
  return {
    id: raw.id ?? crypto.randomUUID(),
    label: (typeof raw.label === 'string' ? raw.label.trim() : '') || deriveLabel(prompt),
    enabled: raw.enabled ?? true,
    target: raw.target,
    prompt,
    when: raw.when,
    waitForIdle: raw.waitForIdle ?? false,
    catchUp: raw.catchUp ?? 'run_once',
    createdAt: raw.createdAt ?? Date.now(),
    nextFireAt: raw.nextFireAt ?? null,
    lastRunAt: raw.lastRunAt,
    runCount: raw.runCount ?? 0,
    // Drop malformed rows rather than letting one of them break every surface that
    // renders the history list.
    history: Array.isArray(raw.history)
      ? raw.history.filter((r) => !!r && typeof r === 'object').slice(0, MAX_HISTORY)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function createSchedulesStore() {
  const { subscribe, set, update } = writable<Schedule[]>([]);

  let loaded = false;
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

  function schedulePersist() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(persist, 500);
  }

  async function persist() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }
    // Never write before a successful load: if `get_schedules` failed, the store
    // is empty and a save here would replace schedules.json with that empty list.
    if (!loaded) return;
    try {
      await invoke('save_schedules', { items: get({ subscribe }) });
    } catch (error) {
      console.error('[schedules] Failed to save schedules:', error);
    }
  }

  async function load() {
    try {
      const raw = await invoke<unknown[]>('get_schedules');
      const items: Schedule[] = [];
      for (const entry of raw ?? []) {
        // Isolate per item: one unreadable row must not abort the whole load. An
        // aborted load leaves the store empty, and the next mutation persists that
        // empty list over a perfectly good file.
        try {
          const item = normalizeSchedule(entry as Partial<Schedule>);
          if (!item) continue;
          // A stored `nextFireAt` of null means the value was never computed (or the
          // rule was edited elsewhere) — recompute it. `computeNextFire` returns null
          // again for a genuinely spent one-shot, so this is safe for both spec kinds.
          // A past-due value is deliberately left alone: the driver's catch-up pass
          // owns that decision (`catchUp: 'run_once' | 'skip'`).
          if (item.enabled && item.nextFireAt == null) {
            item.nextFireAt = computeNextFire(item.when, Date.now(), item.createdAt, item.runCount);
          }
          items.push(item);
        } catch (error) {
          console.error('[schedules] Skipping unreadable schedule:', error, entry);
        }
      }
      set(items);
      loaded = true;
    } catch (error) {
      console.error('[schedules] Failed to load schedules:', error);
    }
  }

  function getSchedule(id: string): Schedule | undefined {
    return get({ subscribe }).find((s) => s.id === id);
  }

  function add(partial: NewSchedule): Schedule {
    // `createdAt` doubles as the recurrence anchor, so it is always "now" —
    // callers can't backdate a schedule into a different everyNWeeks phase.
    const createdAt = Date.now();
    const item: Schedule = {
      id: crypto.randomUUID(),
      label: partial.label?.trim() || deriveLabel(partial.prompt),
      enabled: partial.enabled ?? true,
      target: partial.target,
      prompt: partial.prompt,
      when: partial.when,
      waitForIdle: partial.waitForIdle ?? false,
      catchUp: partial.catchUp ?? 'run_once',
      createdAt,
      nextFireAt:
        partial.nextFireAt ?? computeNextFire(partial.when, Date.now(), createdAt, 0),
      lastRunAt: partial.lastRunAt,
      runCount: 0,
      history: [],
    };
    update((items) => [...items, item]);
    schedulePersist();
    return item;
  }

  /**
   * Patch a schedule. Changing the timing rule (or re-enabling a spent one)
   * recomputes `nextFireAt` from now so the change takes effect immediately.
   */
  function updateSchedule(id: string, patch: Partial<Schedule>) {
    update((items) =>
      items.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s, ...patch };
        if (patch.label !== undefined) next.label = patch.label.trim() || deriveLabel(next.prompt);
        const timingChanged = patch.when !== undefined;
        const reEnabled = patch.enabled === true && !s.enabled;
        if (patch.nextFireAt === undefined && (timingChanged || reEnabled)) {
          next.nextFireAt = computeNextFire(next.when, Date.now(), next.createdAt, next.runCount);
        }
        return next;
      })
    );
    schedulePersist();
  }

  function remove(id: string) {
    update((items) => items.filter((s) => s.id !== id));
    schedulePersist();
  }

  /** Clone a schedule as a fresh, never-run copy (new id/anchor, empty history). */
  function duplicate(id: string): Schedule | null {
    const source = getSchedule(id);
    if (!source) return null;
    const createdAt = Date.now();
    const copy: Schedule = {
      ...source,
      id: crypto.randomUUID(),
      label: `${source.label} (copy)`,
      createdAt,
      nextFireAt: computeNextFire(source.when, createdAt, createdAt, 0),
      lastRunAt: undefined,
      runCount: 0,
      history: [],
    };
    update((items) => [...items, copy]);
    schedulePersist();
    return copy;
  }

  function setEnabled(id: string, enabled: boolean) {
    updateSchedule(id, { enabled });
  }

  /**
   * Skip the upcoming occurrence: advance past it and record a `skipped` run.
   * Does NOT count toward `runCount` / `maxRuns` — nothing actually ran.
   */
  function skipNext(id: string) {
    const source = getSchedule(id);
    if (!source || source.nextFireAt == null) return;
    const skippedAt = source.nextFireAt;
    // Search forward from `now` when the skipped occurrence is already past due (held by
    // `waitForIdle`, or missed while the app was closed) — advancing from `skippedAt` alone
    // could land on another past occurrence, which the driver would fire on the next tick.
    const from = Math.max(skippedAt, Date.now());
    update((items) =>
      items.map((s) =>
        s.id === id
          ? {
              ...s,
              nextFireAt: computeNextFire(s.when, from, s.createdAt, s.runCount),
              history: [{ at: skippedAt, status: 'skipped' as const }, ...s.history].slice(
                0,
                MAX_HISTORY
              ),
            }
          : s
      )
    );
    schedulePersist();
  }

  /**
   * Driver-facing: consume the current occurrence *before* firing it, so a
   * failure can never stall the series. Bumps `runCount`/`lastRunAt` and rolls
   * `nextFireAt` forward (null for a spent one-shot / ended recurrence).
   */
  function markFired(id: string, at: number) {
    update((items) =>
      items.map((s) => {
        if (s.id !== id) return s;
        const runCount = s.runCount + 1;
        return {
          ...s,
          lastRunAt: at,
          runCount,
          nextFireAt: computeNextFire(s.when, at, s.createdAt, runCount),
        };
      })
    );
    schedulePersist();
  }

  /** Driver-facing: advance past a missed occurrence without running it. */
  function markMissed(id: string, at: number) {
    update((items) =>
      items.map((s) =>
        s.id === id
          ? {
              ...s,
              nextFireAt: computeNextFire(s.when, at, s.createdAt, s.runCount),
              history: [{ at, status: 'skipped' as const }, ...s.history].slice(0, MAX_HISTORY),
            }
          : s
      )
    );
    schedulePersist();
  }

  /** Driver-facing: prepend a run to the schedule's history (newest first, capped). */
  function recordRun(id: string, run: ScheduleRun) {
    update((items) =>
      items.map((s) =>
        s.id === id ? { ...s, history: [run, ...s.history].slice(0, MAX_HISTORY) } : s
      )
    );
    schedulePersist();
  }

  /**
   * Fire a schedule right now, out of band: does NOT count toward `maxRuns` and
   * ignores the idle hold (it's an explicit user action). A *future* `nextFireAt`
   * is left untouched — but a due/past-due occurrence (held by `waitForIdle`, or
   * missed while the app was closed) is consumed by advancing past it, otherwise
   * the driver would fire the same occurrence again on the next tick. The run is
   * still recorded in the history. Returns the session id the run targeted/launched.
   */
  async function runNow(id: string): Promise<string | null> {
    const schedule = getSchedule(id);
    if (!schedule) return null;
    if (schedule.nextFireAt != null && schedule.nextFireAt <= Date.now()) {
      update((items) =>
        items.map((s) =>
          s.id === id
            ? { ...s, nextFireAt: computeNextFire(s.when, Date.now(), s.createdAt, s.runCount) }
            : s
        )
      );
      schedulePersist();
    }
    return fireSchedule(schedule);
  }

  return {
    subscribe,
    load,
    isLoaded: () => loaded,
    getSchedule,
    add,
    update: updateSchedule,
    remove,
    duplicate,
    setEnabled,
    skipNext,
    runNow,
    // Driver-facing bookkeeping (used by startSchedules below)
    markFired,
    markMissed,
    recordRun,
  };
}

export const schedules = createSchedulesStore();

// ---------------------------------------------------------------------------
// Derived stores for the UI
// ---------------------------------------------------------------------------

/** Enabled schedules with a pending fire time, soonest first. */
export const upcomingSchedules = derived(schedules, ($items) =>
  $items
    .filter((s) => s.enabled && s.nextFireAt != null)
    .sort((a, b) => (a.nextFireAt ?? 0) - (b.nextFireAt ?? 0))
);

/** Earliest upcoming fire time (epoch ms), or null when nothing is scheduled. */
export const nextScheduleFireAt = derived(
  upcomingSchedules,
  ($upcoming) => $upcoming[0]?.nextFireAt ?? null
);

/** How many schedules are armed (enabled *and* still have an occurrence ahead). */
export const enabledScheduleCount = derived(upcomingSchedules, ($upcoming) => $upcoming.length);

/** Total number of schedules (armed or not) — drives the sidebar tab count. */
export const scheduleCount = derived(schedules, ($items) => $items.length);

/** Currently selected schedule (shown in the main pane, mirrors `selectedPileItemId`). */
export const selectedScheduleId = writable<string | null>(null);

export const selectedSchedule = derived(
  [schedules, selectedScheduleId],
  ([$items, $id]) => ($id ? $items.find((s) => s.id === $id) ?? null : null)
);

// ---------------------------------------------------------------------------
// Firing pipeline
// ---------------------------------------------------------------------------

/**
 * Session launches all go through one module-level queue so a same-tick pileup
 * (several schedules due at 09:00) starts sequentially with a stagger instead of
 * hammering git/the sidecar.
 */
const launchQueue = createSessionQueue();

/** Statuses a message target can be delivered to. Busy sessions are held earlier. */
function isMessageTargetUsable(session: SdkSession): boolean {
  return session.status === 'idle' || session.status === 'done' || session.status === 'error';
}

/** Is this session mid-turn (so a scheduled message must wait rather than interleave)? */
function isSessionBusy(session: SdkSession): boolean {
  return session.status === 'querying' || session.status === 'initializing';
}

/**
 * Launch a fresh session for a schedule. Used both by session targets and by a
 * message target's `launch_new` fallback. Records the run and returns the new
 * session id (null on failure).
 */
async function launchForSchedule(
  schedule: Schedule,
  config: {
    repoId: string;
    model: string;
    effortLevel: EffortLevel;
    provider: 'claude' | 'openai';
    accountId?: string;
    useWorktree?: boolean;
    systemPrompt?: string;
  }
): Promise<string | null> {
  const at = Date.now();
  const repo = findRepoById(get(repos).list, config.repoId);
  if (!repo) {
    schedules.recordRun(schedule.id, {
      at,
      status: 'failed',
      error: 'Repository no longer exists',
    });
    return null;
  }

  // Snapshot exhaustion at fire time: the launch still goes ahead (the
  // `startSetupSession` gate parks it as a `rate_limit` queued session and the
  // Smart Queue drains it at reset), but the run is recorded as `deferred`.
  const exhausted = providerExhaustion(config.provider, config.accountId).exhausted;

  try {
    const sessionId = await launchSession({
      prompt: schedule.prompt,
      repo,
      model: config.model,
      effortLevel: config.effortLevel,
      provider: config.provider,
      accountId: config.accountId,
      useWorktree: config.useWorktree,
      branchNameHint: schedule.label,
      systemPrompt: config.systemPrompt,
      tag: { schedule: { id: schedule.id, label: schedule.label } },
      // Unattended runs must never silently fall back to editing the main repo.
      onWorktreeError: 'fail',
    });
    const parked = get(sdkSessions).find((s) => s.id === sessionId)?.status === 'queued';
    schedules.recordRun(schedule.id, {
      at,
      status: exhausted || parked ? 'deferred' : 'ok',
      sessionId,
    });
    return sessionId;
  } catch (error) {
    console.error('[schedules] Launch failed:', error);
    schedules.recordRun(schedule.id, { at, status: 'failed', error: String(error) });
    return null;
  }
}

/** Deliver a scheduled turn to an existing session (or fall back per `ifSessionGone`). */
async function runMessageTarget(schedule: Schedule): Promise<string | null> {
  const target = schedule.target as ScheduleMessageTarget;
  const session = get(sdkSessions).find((s) => s.id === target.sessionId);

  if (!session || !isMessageTargetUsable(session)) {
    if (target.ifSessionGone === 'launch_new' && target.fallback) {
      return launchForSchedule(schedule, target.fallback);
    }
    schedules.recordRun(schedule.id, {
      at: Date.now(),
      status: 'skipped',
      error: 'Target session is gone',
    });
    return null;
  }

  const at = Date.now();
  try {
    if (target.action === 'compact') {
      await sdkSessions.compactSession(target.sessionId);
    } else {
      await sdkSessions.sendPrompt(target.sessionId, schedule.prompt);
    }
    schedules.recordRun(schedule.id, { at, status: 'ok', sessionId: target.sessionId });
    return target.sessionId;
  } catch (error) {
    console.error('[schedules] Scheduled message failed:', error);
    schedules.recordRun(schedule.id, {
      at,
      status: 'failed',
      sessionId: target.sessionId,
      error: String(error),
    });
    return null;
  }
}

/** Run a schedule's target now (no bookkeeping — callers advance the series first). */
async function fireSchedule(schedule: Schedule): Promise<string | null> {
  if (schedule.target.kind === 'session') {
    return launchForSchedule(schedule, schedule.target);
  }
  return runMessageTarget(schedule);
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Should this schedule hold instead of firing right now?
 *
 * - Session target with `waitForIdle`: hold while any session in the target
 *   repo's scope is still working.
 * - Message target: ALWAYS holds while its own session is mid-turn, so a
 *   scheduled follow-up is never injected into a running turn.
 *
 * A hold does not advance the schedule — it is re-checked on the next tick.
 */
function isHeld(schedule: Schedule, sessions: SdkSession[]): boolean {
  if (schedule.target.kind === 'message') {
    const sessionId = schedule.target.sessionId;
    const session = sessions.find((s) => s.id === sessionId);
    return !!session && isSessionBusy(session);
  }
  if (!schedule.waitForIdle) return false;
  const repo = findRepoById(get(repos).list, schedule.target.repoId);
  if (!repo) return false; // missing repo — let it fire and fail with a clear reason
  return hasBusySessionsInScope(sessions, repo.path);
}

/** Re-entrancy guard: the tick and the startup pass can overlap. */
let evaluating = false;

/**
 * One evaluation pass over every due schedule.
 *
 * Order per schedule: idle hold → advance unconditionally → fire. Advancing
 * before firing is deliberate: a failed run must never stall the series, and all
 * occurrences missed while the app was closed coalesce into a single fire.
 */
async function evaluateSchedules(): Promise<void> {
  if (evaluating) return;
  evaluating = true;
  try {
    const now = Date.now();
    const due = get(schedules).filter(
      (s) => s.enabled && s.nextFireAt != null && now >= s.nextFireAt
    );

    const launches: Array<() => Promise<void>> = [];
    for (const schedule of due) {
      // Re-read the sessions each iteration: a message target fired earlier in this
      // same pass has already put its session into `querying`, and a snapshot taken
      // before the loop would still show it idle — sending a second scheduled turn
      // straight into the running one.
      if (isHeld(schedule, get(sdkSessions))) continue;
      schedules.markFired(schedule.id, now);
      if (schedule.target.kind === 'session') {
        launches.push(async () => {
          await fireSchedule(schedule);
        });
      } else {
        await fireSchedule(schedule);
      }
    }

    // Same-tick pileup: stagger the session launches so they don't all start at once.
    if (launches.length > 0) launchQueue.enqueue(launches, { stagger: true });
  } catch (error) {
    console.error('[schedules] Evaluation failed:', error);
  } finally {
    evaluating = false;
  }
}

/**
 * Startup catch-up: schedules whose fire time passed while the app was closed.
 * `catchUp: 'skip'` advances past them with a `skipped` history entry; the
 * `'run_once'` default is left for the regular evaluation, which fires them once
 * (all missed occurrences coalesced) and rolls forward to the next future slot.
 */
function catchUpMissed(): void {
  const now = Date.now();
  for (const schedule of get(schedules)) {
    if (!schedule.enabled || schedule.nextFireAt == null) continue;
    if (schedule.nextFireAt >= now) continue;
    if (schedule.catchUp === 'skip') schedules.markMissed(schedule.id, now);
  }
}

let started = false;
let currentTeardown: (() => void) | null = null;

/**
 * Start the schedule driver: catch up on anything missed while the app was
 * closed, evaluate immediately, then re-evaluate every 30 s. Idempotent — a
 * second call while running is a no-op that returns the same teardown.
 *
 * Call once from `(main)/+layout.svelte`, after `schedules.load()`.
 */
export function startSchedules(): () => void {
  if (started && currentTeardown) return currentTeardown;
  started = true;

  catchUpMissed();
  void evaluateSchedules();

  let intervalId: ReturnType<typeof setInterval> | null = null;
  if (typeof window !== 'undefined') {
    intervalId = setInterval(() => void evaluateSchedules(), TICK_MS);
  }

  currentTeardown = () => {
    if (!started) return;
    started = false;
    currentTeardown = null;
    if (intervalId != null) clearInterval(intervalId);
  };

  return currentTeardown;
}
