# Native Scheduling — Implementation Spec (2026-07)

Schedule session starts and in-session messages at custom times (with presets like
"tomorrow 09:00") and on recurring rules (weekdays, every N weeks, day of month),
with editing, pause/resume, run-now, and run history. Separate from Sequences —
this is the native, lightweight path. Local PC wall clock is the source of truth
(same policy as the sequences scheduler); no timezone knob.

Two rails, one user-facing concept:

- **One-shot custom time** rides the EXISTING Smart Queue rails: a never-launched
  session parks as `status: 'queued'` with `queueInfo.targetStartAt = <custom epoch ms>`;
  an in-session turn parks on `rateLimited` with `reason: 'scheduled'` and a custom
  `targetStartAt`. The Smart Queue's `scheduled` readiness branch already fires on
  `now > targetStartAt` (smartQueue.ts ~L171-175) — no driver change needed for this.
- **Recurring (and managed one-shots created from the Schedules tab)** are a new
  durable **Schedule** entity in a new store `src/lib/stores/schedules.ts`, persisted
  to `schedules.json` via new opaque-JSON Tauri commands (pile pattern). A schedule
  *spawns* sessions/turns when it fires; it is never consumed.

## 1. Schedule entity (`src/lib/stores/schedules.ts`)

```ts
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
```

### Recurrence math

`computeNextFire(spec: ScheduleSpec, after: number, anchor: number): number | null`
— pure local-time date math (new Date(), setHours), DST handled naturally by
computing occurrences in local time.

- `at`: `at > after ? at : null`.
- `daily` / `interval`: next occurrence of `time` that is > after and (for interval)
  `floor(daysSince(anchorDate)) % everyNDays === 0` where anchorDate = the date part of `anchor`.
- `weekly`: next day in `days` at `time` that is > after; with `everyNWeeks >= 2`,
  only weeks where `weeksSince(startOfWeek(anchor)) % everyNWeeks === 0` (weeks start Monday).
- `monthly`: day `1..28` at `time`; `'last'` = last calendar day of the month.
- Respect `endAt` / `maxRuns` (given the schedule's current `runCount`): return null when exceeded.
- Unit-testable: export it. (No test infra exists for TS in this repo — just keep it pure.)

### Store shape (pile.ts is the model)

`createSchedulesStore()` singleton export `schedules` with:
- `subscribe`; internal `items: Schedule[]`
- `load()` — `invoke<unknown[]>('get_schedules')`, normalize each item (fill missing
  fields with defaults — spareTokens `normalizeItemState` is the model), recompute
  `nextFireAt` for recurring items whose stored value is stale/null.
- debounced 500 ms `persist()` — `invoke('save_schedules', { items })`, full replacement.
- `add(partial)`, `update(id, patch)`, `remove(id)`, `duplicate(id)`,
  `setEnabled(id, enabled)`, `skipNext(id)` (advance `nextFireAt` past the next
  occurrence, history entry `skipped`), `runNow(id)` (fire immediately WITHOUT
  advancing `nextFireAt` or counting toward `maxRuns` — history entry recorded).
- Derived stores: `upcomingSchedules` (enabled, nextFireAt != null, sorted ascending),
  `nextScheduleFireAt` (earliest, or null), `enabledScheduleCount`.

### Driver (`startSchedules()`, called once from `(main)/+layout.svelte` after `schedules.load()`)

30 s `setInterval` tick + immediate evaluation on start (same pattern as
`startSmartQueue`). Guard `typeof window !== 'undefined'`. On each tick, for every
schedule with `enabled && nextFireAt != null && now >= nextFireAt`:

1. **Idle hold:** session target with `waitForIdle` and busy repo scope → hold (do
   NOT advance; re-check next tick). Message target with its session busy
   (`querying`/`initializing`) → hold.
2. **Advance first, unconditionally:** set `lastRunAt = now`, `runCount++`,
   `nextFireAt = computeNextFire(when, now, createdAt)` (null for one-shots). A run
   failure must never stall the series.
3. **Fire** (see pipeline below), append to `history` (cap 20).

**Catch-up on load:** any schedule with `nextFireAt < now` at load time:
`catchUp === 'run_once'` → fire once through the same pipeline (all missed
occurrences coalesce into one); `'skip'` → advance `nextFireAt` past now and append
a `skipped` history entry.

**Same-tick pileup:** fire session launches through a module-level
`createSessionQueue()` (from `sessionLaunch.ts`) with `{ stagger: true }`.

### Firing pipeline

Session target:
- Resolve repo from `settings.repos` by `repoId`. Missing → history `failed`
  ("repository no longer exists"), no launch.
- `launchSession({ prompt, repo, model, effortLevel, provider, accountId,
  useWorktree, systemPrompt, tag: { schedule: { id, label } }, onWorktreeError: 'fail' })`.
  Worktree failure → history `failed`. (See §3 for the new `onWorktreeError` option.)
- If the provider window is exhausted at fire time, launch anyway — the existing
  `startSetupSession` gate parks it as a `rate_limit` queued session and the Smart
  Queue drains it at reset. Detect via `providerExhaustion(...)` and record history
  `deferred` (with sessionId) instead of `ok`.

Message target:
- Session not in store (or terminal-and-unusable) → `ifSessionGone`: `'skip'` →
  history `skipped`; `'launch_new'` → launch a fresh session from `fallback`
  (missing fallback → `skipped`).
- Session live and idle → `action === 'compact'` ? `sdkSessions.compactSession(id)`
  (verify the actual method name in sdkSessions.ts; there is an existing
  provider-correct compact path used by `continueRateLimited`) :
  `sdkSessions.sendPrompt(id, prompt)`. History `ok` with sessionId.
- Busy → held at step 1 (never sent mid-turn).

## 2. Backend (`src-tauri/src/commands/schedule_cmds.rs`)

Clone the pile pattern (`pile_cmds.rs`):
- `schedules_file_path()` → `<config dir>/schedules.json`, `schedules.dev.json` in
  debug builds (same cfg split as `pile_file_path`).
- `#[tauri::command] get_schedules() -> Result<Vec<serde_json::Value>, String>` —
  opaque JSON, frontend owns the schema; missing file → empty vec.
- `#[tauri::command] save_schedules(items: Vec<serde_json::Value>)` — `atomic_write`
  (crate::persist) full replacement.
- Declare the module and register both commands in `lib.rs`'s `invoke_handler`.
No AppConfig change, no migration (the file is frontend-owned).

## 3. Existing-rails extensions (one-shot custom time) + Smart Queue fixes

### `src/lib/stores/sdkSessions.ts`

- `startSetupSession` `schedule` param widens from `QueueWindow | 'after_sessions'`
  to `QueueWindow | 'after_sessions' | { at: number }`. `{ at }` → park as
  `status: 'queued'` with `queueInfo = { reason: 'scheduled', provider, queuedAt,
  targetStartAt: at }` — **no `window` field, and never set a window-derived
  `targetStartAt`** for this shape. Widen the same param type in
  `transcriptProcessor.handleSetupSessionStart` and anywhere else the union is copied.
- New `queueTurnAtTime(id, prompt, images | undefined, at: number, action?: 'compact')`
  — mirrors `queueTurnForWindow` (~L3517): parks `rateLimited = { reason: 'scheduled',
  provider, targetStartAt: at, scope: undefined, prompt, images, action, queuedAt }`
  with **no `resetsAt` and no `window`**, pushes the same ghost user message with a
  new `queued: 'at_time'` marker, `releaseQueuedToEnd` bookkeeping identical to
  `queueTurnForWindow`.
- `SdkMessage.queued` union gains `'at_time'`.
- `SessionTag` (sessionLaunch.ts) gains `schedule?: { id: string; label: string }`;
  `SdkSession` gains the matching optional inline tag field `scheduleTag?:
  { id: string; label: string }` (auto-persists; follow the pileItem/notionCard
  precedent, applied in `launchSession`'s tag block).

### `src/lib/utils/sessionLaunch.ts`

- `LaunchSessionOptions.schedule` widens to `QueueWindow | 'after_sessions' | { at: number }`.
- New `onWorktreeError?: 'fallback' | 'fail'` (default `'fallback'` = today's
  silent-fallback behavior). `'fail'` → throw instead of falling back to the main
  repo path, so unattended scheduled runs never silently edit main.
- Apply the `schedule` tag in the tag block.

### `src/lib/stores/smartQueue.ts` — behavior fixes (all pre-existing traps)

1. **Master toggle** (~L191-196): `settings.queue.enabled` gates ONLY
   `reason: 'rate_limit'` items. `scheduled` and `after_sessions` are explicit
   per-item user actions and always dispatch.
2. **Fuzzy stagger** (~L226-247): apply reset delays only to `rate_limit` items;
   `scheduled` items dispatch without fuzzy delay (a user who picked 09:00 gets 09:00).
3. **Exhaustion roll-forward** (~L171-174): the `scheduled` readiness branch no
   longer holds while exhausted — once `now > targetStartAt` it fires; downstream
   gates re-park as `rate_limit` if the provider rejects.
4. **`nextQueueResetAt` precedence** (~L380-401): use `targetStartAt ?? resetsAt`
   (consistent with `toPendingItem` and `RateLimitBanner`).

### `src/lib/stores/sessionPersistence.ts`

Overflow archiving (~L493-520): exempt `status === 'queued'` sessions from the
`max_sessions` overflow sweep — a far-future scheduled session must not be archived away.

### Labels

`SdkView`'s queued-session panel, `SessionListItem`'s queue badge, and
`RateLimitBanner` must render the custom-time shape: reason `scheduled` with
`targetStartAt` but no `window` → label like "Scheduled for Fri 09:00" (use a shared
`formatScheduleTarget(ts)` helper — absolute short weekday + time, plus relative
countdown where the surface already shows one).

## 4. UI

### New shared components (`src/lib/components/schedule/`)

- `ScheduleTimePicker.svelte` — preset list (**In 30 min / In 1 h / In 3 h /
  Tonight 20:00 / Tomorrow 09:00 / Next Monday 09:00**) + a `datetime-local` input
  for custom; emits epoch ms. Presets that already passed today roll to the next
  valid instant (e.g. "Tonight 20:00" at 21:00 → tomorrow 20:00 is WRONG — just
  hide passed presets instead).
- `RecurrenceEditor.svelte` — pattern kind select (Daily / Weekly / Monthly / Every N days),
  day-of-week chip row (Mon-first display), every-N-weeks stepper, monthly day
  (1..28 or Last), time input, optional end conditions. Emits a `RecurrenceRule`.
  Show a live "Next: <computed>" preview via `computeNextFire`.

### Entry points

- **`SdkPromptInput` schedule menu** (existing 4 items stay): add **"At a time…"**
  (inline picker popover → new prop `onScheduleSendAt?: (at, prompt, images) => void`
  → `SdkView` → `sdkSessions.queueTurnAtTime`) and **"Recurring…"** (dialog with
  `RecurrenceEditor` → creates a Schedule entity with a `message` target bound to
  this session, `fallback` snapshotted from the session, prompt = current draft;
  clears the draft like a send).
- **`SessionSetupView` schedule menu** (existing items stay): add **"At a time…"**
  (picker → `onSchedule(config, { at })` → `handleSetupSessionStart` with
  `schedule: { at }`) and **"Recurring…"** (dialog → creates a Schedule entity with
  a `session` target from the resolved setup config — repo/model/effort/provider/
  account/worktree — then discards the setup draft and shows a toast/switches to
  the Scheduled tab).

### Schedules tab

- Sidebar gains a third tab: **Sessions | Pile | Scheduled** (in `(main)/+page.svelte`,
  same tab mechanism as Pile). `ScheduleList.svelte`: cards with label, human
  pattern summary ("Weekdays 09:00", "Every 2 weeks · Mon, Thu 08:30", "1st of
  month 10:00", "Once · Fri 09:00"), countdown to next fire, enabled toggle,
  Run now button, overflow menu (Skip next / Duplicate / Delete), status line for
  the last run. "New schedule" button on top.
- `ScheduleDetailView.svelte` in the main pane (pile's PileDetailView is the model,
  wired via `navigation`/selection state the same way pile items are): full editor —
  label, prompt textarea, target section (for session targets: repo/model/effort/
  provider/account selectors + worktree toggle, reusing the existing selector
  components; message targets shown read-only with their bound session), timing
  section (One time ↔ Recurring switch with picker/editor), waitForIdle + catchUp
  controls, and a run-history list linking to launched sessions
  (`sessionSelection`-style activation on click).

### Ambient surfaces

- `QueueIndicator` — fold `nextScheduleFireAt` into the "next in …" countdown
  (min with `nextQueueResetAt`) and include upcoming-schedule count in the pill
  (e.g. "2 queued · 1 scheduled"; keep it compact).
- `SessionListItem` — badge for `scheduleTag` sessions (calendar-ish icon + label
  tooltip), same visual weight as the pile/notion/issue tags.
- `RateLimitBanner` — for a parked turn with custom `targetStartAt` (no `window`),
  title "Scheduled message", body "Sends Fri 09:00 (in 16h 12m)". Existing
  Send now / Cancel actions apply unchanged.

## 5. Conventions

- Svelte 5 runes ($state/$derived/$props) in all new components; match surrounding
  code style. TailwindCSS 4 utility classes, follow neighboring components' theming
  variables. Persist debounced; atomic writes on the Rust side. Logging via
  `utils/logger.ts`. All new strings in English.
- Type check: `npm run check` must pass.
