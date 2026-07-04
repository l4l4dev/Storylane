← [SPEC.md](../SPEC.md)

## Velocity Calculation Logic

```
velocity = AVG( sum of accepted points across the last velocity_window completed iterations )
```

- Stories with `story_type = 'chore'` or `'release'` are excluded from point counts
- `iterations.velocity` is finalized when an iteration transitions to `state = 'done'`
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

### Marker computation (pure function, shared per client)

- Capacity per virtual iteration = `max(current velocity, 1)` points.
- Walk the backlog top-down accumulating points (`chore` / `release` /
  unestimated stories consume 0); when adding the next story would exceed the
  remaining capacity, close the marker and start the next one.
- A single story larger than the full capacity occupies a virtual iteration
  by itself.

### Rollover (lazy, on first access after end_date)

1. Finalize the ended iteration: store its velocity, set `state = 'done'`.
2. Create the next iteration row (dates continue from `end_date`).
3. Move unaccepted stories from the ended iteration into the new current
   iteration (accepted stories stay on the done iteration).
4. Repeat if more than one `iteration_length` has passed since last access.

Phase 1 trigger is **lazy on first access** (no cron dependency). It may later
move to a scheduled Edge Function; either way the rule must live in one shared
place per client — never duplicated per view (see ARCHITECTURE.md).
