← [SPEC.md](../SPEC.md)

## Velocity Calculation Logic

```
velocity = AVG( sum of accepted points across the last velocity_window completed iterations )
```

- Stories with `story_type = 'chore'` or `'release'` are excluded from point counts
- `iterations.velocity` is finalized when an iteration transitions to `state = 'done'`
- **Skipped iterations (`iterations.skipped = true`) are excluded from the velocity window** —
  see "Skipping a not-yet-started iteration" below
- Auto-assignment: stories are pulled from the top of the backlog to fill the next iteration up to the current velocity

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

- Capacity per virtual iteration = `max(current velocity, 1)` points.
- Walk the backlog top-down accumulating points (`chore` / `release` /
  unestimated stories consume 0); when adding the next story would exceed the
  remaining capacity, close the group and start the next one.
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

1. Finalize the ended iteration: store its velocity, set `state = 'done'`.
2. Create the next iteration row (dates continue from `end_date`). If
   `iteration_goals` has a goal for the new number, adopt it into
   `iterations.goal` and delete the `iteration_goals` row (2026-07-07).
3. Move unaccepted stories from the ended iteration into the new current
   iteration (accepted stories stay on the done iteration).
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
   starting tomorrow, goal adoption, unaccepted-story carry-over).

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
2. It finalizes like any other iteration (velocity = accepted-point sum,
   normally 0 since a future iteration has no accepted stories; unaccepted
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
- The RPC is SECURITY DEFINER with explicit membership checks inside:
  **lazy rollover** fires for any project member *including viewers* —
  it is system maintenance triggered by reads, and viewers could never
  perform its writes under plain RLS. **Manual finish** requires role
  owner or member.
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
