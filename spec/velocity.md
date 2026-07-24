← [SPEC.md](../SPEC.md)

## Velocity Calculation Logic (person-day rate — doc-8 §7)

Velocity is normalized **per person-day**, so sprints of different capacity
(team size, holidays, personal time off) are comparable.

```
rate = ( Σ done-category points over the window )
       ─────────────────────────────────────────────
       ( Σ capacity over the window )

window = the last `velocity_window` non-skipped, capacity>0 `done` iterations

forecast(sprint) = rate × sprint.capacity      (planned capacity for a future sprint)
```

- A **ratio of sums**, not an average of ratios — this avoids zero-division
  and over-weighting tiny sprints (doc-8 §7 advisor).
- **Points counted** = stories that entered a **`done`-category** state
  (`project_states.category = 'done'`, spec/data-model.md), still excluding
  `story_type = 'chore'` / `'release'` via the existing type filter, and
  excluding containers (`is_container = false`, doc-18 §5 — a container carries
  NULL points and is off the board; only its terminal children count). The
  read-side roll-up of a container's state is display-only and never feeds
  velocity.
- **Capacity** = Σ over members of their working days in the sprint
  (calendar-aware, minus personal time off). It is **snapshotted onto
  `iterations.capacity` by the finalization RPC** and never recomputed, so
  later member removal or calendar edits cannot rewrite history. If lazy
  finalization runs weeks late, capacity reflects membership/time-off at
  that moment (accepted, documented).
- **Window filter**: skipped iterations (`iterations.skipped = true`) and
  capacity-0 iterations (e.g. an empty `done` row auto-created on a
  neglected 1-day project) are excluded, so neither drags the rate.
- Auto-assignment: stories are pulled from the top of the backlog to fill
  the next iteration up to `rate × planned capacity`. Containers
  (`is_container = true`) are never pulled — they are not board items; their
  children are pulled individually (doc-18 §5).

### Where the capacity formula lives (TASK-86)

Two implementations, deliberately: `public.project_capacity` (SQL, called by
`finalize_iteration` — the snapshot invariant has to hold for every client
and for Edge Functions, so it cannot live in a client) and `projectCapacity`
(`packages/core/src/capacity.ts`, for planning future sprints, which have no
row to read a snapshot from). Both are asserted against the single golden
fixture `spec/fixtures/capacity.json` so they cannot drift.

Rules both must apply: `working_weekdays` is a **set** (the DB CHECK cannot
reject duplicates); `holiday` removes a day, `extra_workday` adds one;
personal time off subtracts per member; there is **no `joined_at`
proration** — the member set at finalize time × every working day of the
sprint.

**Only `owner` and `member` roles count toward capacity.** A `viewer` cannot
be assigned a story, so counting their days would inflate the denominator
and under-forecast every future sprint. Both implementations spell this as
an allowlist, not `!= 'viewer'`, so a role added later has to opt in rather
than land in the math by default.

Only the first pass of a `finalize_iteration` call writes a real capacity.
The catch-up loop inserts a gap row and finalizes it in the same call, so
every later pass writes `capacity = 0` — otherwise a neglected project's
empty gap rows would enter the window with `points = 0` and crush the rate.

No backfill: iterations finalized before this shipped keep `capacity = NULL`
and are excluded from the window, so forecasting falls back to the minimum
1 point per group until `velocity_window` new iterations have finalized.

## Automatic scheduling & rollover (updated 2026-07-02 for Pivotal Tracker parity)

Replaces the manual "Generate next iteration" / "Mark as done" operations from Task 6.

### Which iterations exist as DB rows

- Only the **current** iteration and past `done` iterations exist as
  `iterations` rows. On first access, if no row covers today, one is created
  automatically from `iteration_length` (continuing from the previous
  iteration's `end_date`, or starting today for a fresh project).
- **Future iterations are virtual**: boundary markers computed at render time
  and drawn inside the Backlog panel — no DB rows. Backlog stories keep
  `iteration_id = NULL`.
- Dragging a story into the Current panel sets `iteration_id` to the current
  iteration; dragging it back to Backlog/Icebox sets it to NULL.
- `iterations.state = 'planned'` is no longer produced (kept in the CHECK
  constraint for compatibility). The one-time migration for this change
  deletes existing future `planned` rows and returns their stories to the
  top of the backlog, preserving relative order.

### Virtual-group computation (pure function, shared per client)

- Point budget per virtual iteration = **`rate × that sprint's planned
  capacity`** (doc-8 §7 advisor), where planned capacity is computed from the
  working-day calendar for the sprint's projected dates. Falls back to a
  minimum of 1 point per group so backlog splitting still progresses before
  any history exists.
- The calendar/capacity math is a per-client pure function (web + iOS), so it
  ships with **shared golden fixtures** as part of the velocity rework —
  same TS↔Swift parity requirement as the state advance-button computation
  (doc-8 §2).
- Walk the backlog top-down accumulating points (`chore` / `release` /
  unestimated stories consume 0; containers are not in the walk at all —
  `is_container = false`, doc-18 §5); when adding the next story would exceed
  the remaining capacity, close the group and start the next one.
- A single story larger than the full capacity occupies a virtual iteration
  by itself.
- A manual `iteration_break` divider (spec/data-model.md) closes the group
  at that exact spot regardless of remaining capacity.
- **Numbering & rendering (2026-07-07):** the first group is
  `current iteration number + 1` and each group renders **under its own
  header** (number, dates, goal, point sum, collapse toggle — see
  spec/screens.md "Backlog groups"). The former boundary-marker rendering,
  where the first group had no label and a break appeared to "skip" a
  number, is replaced.
- Goals for these virtual numbers live in `iteration_goals`
  (spec/data-model.md) and are edited inline on the group header.

### Rollover (lazy, on first access after end_date)

1. Finalize the ended iteration: snapshot its `velocity` (done-category
   point sum) **and `capacity`** (Σ member working-days), set `state = 'done'`.
2. Create the next iteration row (dates continue from `end_date`, using the
   cadence length at access time — see "Cadence change" below). If
   `iteration_goals` has a goal for the new number, adopt it into
   `iterations.goal` and delete the `iteration_goals` row (2026-07-07).
3. Move stories not in a `done`-category state from the ended iteration into
   the new current iteration (`done`-category stories stay on the done
   iteration).
4. Repeat if more than one `iteration_length` has passed since last access.

Phase 1 trigger is **lazy on first access** (no cron dependency). It may later
move to a scheduled Edge Function; either way the rule must live in one shared
place per client — never duplicated per view (see ARCHITECTURE.md).

### Manual finish (2026-07-07)

"Finish iteration" in the iteration bar lets an owner or member close the
current iteration before its `end_date` (confirmation dialog — the action
is irreversible):

1. Truncate the iteration's `end_date` to today, so history reflects the
   actual duration.
2. Run the same finalization steps as rollover (velocity, `done`, next row
   starting tomorrow, goal adoption, not-yet-done-story carry-over).

Automatic rollover stays in place — manual finish is an early-exit on top
of it, not a replacement. The iteration bar always shows
"auto-finishes on <end_date>" so the automatic behavior is discoverable.

### Skipping a not-yet-started iteration (2026-07-15, TASK-38)

Manually finishing iteration #N creates its successor #N+1 starting the next
day. Pressing "Finish iteration" again the same day therefore acts on a
current iteration that **has not started yet** (`start_date > today`). This is
a valid action — it **skips** #N+1:

1. The skipped iteration keeps its `start_date` and collapses `end_date` onto
   `start_date` (a zero-length row — `end_date` must never precede
   `start_date`).
2. It finalizes like any other iteration (velocity = done-category point sum,
   normally 0 since a future iteration has no done stories; not-yet-done
   stories carry to the successor), and is flagged `skipped = true`.
3. The successor starts the day after the skipped iteration's `start_date`
   with a full `iteration_length`.

**Velocity:** a skipped iteration is **excluded from the velocity window** so
its (normally 0) velocity never drags the running average down. The UI shows a
"skipped" badge in its place, not "velocity 0".

**Concurrency / double-click:** manual finish is *target-explicit* — the client
sends the id of the iteration it is finishing (`p_iteration_id`). The RPC acts
only if that id is still the project's latest, non-done row; a raced or
double-clicked second call names the now-finished predecessor, sees a newer
latest row, and returns a no-op event instead of skipping the fresh successor
(which would create iterations without end). Every outcome — finalized,
skipped, or no-op — returns a visible result to the client
(spec/ux-principles.md principle 2); the "Finish iteration" dialog never ends
in silence.

### Finalization concurrency & permissions (2026-07-08)

Rollover and manual finish share **one finalization RPC**, and several
clients can race into it (two tabs loading after `end_date`, Finish
clicked twice, Finish racing a page-load rollover). Rules:

- The RPC takes a per-project advisory lock
  (`pg_advisory_xact_lock` keyed on the project id) so only one
  finalization per project runs at a time.
- It is **idempotent**: the done-transition is
  `UPDATE iterations SET state = 'done' … WHERE id = … AND state <> 'done'`;
  zero rows updated means another caller already finalized — return the
  refreshed current iteration instead of erroring. The next-iteration
  INSERT additionally relies on `UNIQUE (project_id, number)`.
- Manual finish sets `end_date = LEAST(end_date, today)` — finishing an
  already-overdue iteration must not extend it (the overdue catch-up then
  proceeds as normal rollover).
- The RPC is SECURITY DEFINER with explicit membership checks inside
  (`require_project_role`, re-run after the advisory lock so a mid-wait
  revocation is caught — TASK-142). **Both lazy rollover and manual finish
  are owner/member only** (owner decision 2026-07-22): rollover is a write
  (finalizes iterations, inserts the successor, moves `stories.iteration_id`),
  and a `viewer` is read-only — an abandoned project stays *visibly*
  abandoned (its expired iteration shown as-is) rather than being advanced by
  a viewer's page view. A viewer's rollover call is rejected 42501, which the
  clients swallow (`ensureCurrentIteration`) so the board still renders the
  stale row; a writer catches it up on their next visit.
- A DB trigger rejects setting `stories.iteration_id` to an iteration
  whose `state = 'done'` — this closes the TOCTOU gap where a drag lands
  just after a concurrent finalization (the app's pre-check stays as UX;
  the trigger is the authoritative guard). The finalization path itself
  only moves stories *out* of the done iteration, so it is unaffected.
- Clients that raced and lost see the refreshed board via Realtime /
  revalidation; a rejected drop surfaces the existing
  "finalized iteration" error message.
- A manually shortened iteration counts in the velocity window like any
  other done iteration — no proration (Pivotal behavior). A *skipped*
  iteration (finished before it started, see "Skipping" above) is the one
  exception: it is excluded from the window.

## Fixed-cadence sprints (doc-8 §3–§4)

Boundaries are pure date arithmetic (`start_date + iteration_length`).
**Start dates never move automatically** — no calendar/holiday influence —
so Scrum events stay on the same weekday. The working-day calendar affects
velocity/planning math only, never boundaries (single exception: 1-day
start-date selection below).

A project runs at **one cadence** (`projects.iteration_length` in days: 1,
7, 14, 21, …), never mixed within a project. A "personal project" is just an
ordinary project whose cadence is 1 day — there is no special personal mode.

### 1-day cadence (doc-8 §4 advisor)

For a 1-day project an iteration's `start_date` is a **working day** and its
`end_date` is the **day before the next working day** — so Friday's
iteration spans Fri–Sun and rollover fires on Monday. Consequences:

- Work accepted on a non-working day lands in the still-current iteration
  naturally — no writes into finalized (`done`) iterations, no
  re-finalization, and the old "counts into the preceding iteration" special
  rule is unnecessary.
- Working-day determination uses the **project-level calendar only**
  (`projects.working_weekdays` + `project_calendar_exceptions`) — never
  user-level time off, which would make iteration existence differ per user.
- Lazy catch-up on a neglected 1-day project creates one empty `done` row
  per missed working day. Allowed — the velocity window excludes capacity-0
  iterations so they don't distort the rate.
- 1-day iterations display the date as their title (spec/data-model.md
  `iteration_term`).

### Cadence change (doc-8 §3 advisor)

Cadence is changeable at any time. The change applies **immediately, to the
next iteration row that gets created** — there is no effective-date
scheduling mechanism. Lazy catch-up (Rollover step 4) uses the cadence
length **at access time**, so it may retroactively fill gap periods at the
new length (accepted trade-off). The settings change writes an
`activity_logs` row recording old/new length.

### Per-sprint manual override (doc-8 §3 advisor)

A single sprint can be lengthened in whole weeks (e.g. this sprint only
2w → 3w for a long holiday); whole-week overrides preserve the start
weekday, and subsequent sprints continue from the new `end_date`. The
override runs inside the **existing finalization RPC pattern with the
per-project advisory lock** ("Finalization concurrency" above) and is
**rejected if the iteration is already `state = 'done'`**.
