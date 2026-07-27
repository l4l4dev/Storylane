# Storylane — Architecture Relations

How things connect across the three layers (Web / iOS / Supabase), so relations don't have to be re-derived each session.

**Everything above the `hook:end` marker is injected into every session by the SessionStart hook** (`scripts/session-context.sh`, wired from `.claude/settings.json` and `.codex/hooks.json`; it refuses to run if the marker goes missing). Keep that part to invariants — the rules a session would silently violate without being told. Detail belongs below the marker, where it is read on demand. This file is not a copy of `spec/`; it points at it.

## Entity relations

```
profiles ──< project_members >── projects ──< integrations
   │                                 │      ──< project_calendar_exceptions
   │
profiles ──< my_work_columns          (per-user free columns; My Work)
my_work_story_state    ┌──────────┬──────────┬──────────────┐
   │              iterations    labels   project_states  (working_weekdays,
   │                 │            │          │             iteration_length,
   └──< stories >────┴──< story_labels >─────┘             iteration_term)
          │  state_id → project_states (NULL = Icebox)
          │  parent_id → stories (self-ref, 1-level; container = is_container, doc-18)
   ┌──────┼──────────┐
 tasks  comments  activity_logs

profiles ──< user_time_off        (cross-project; capacity math)
```

Columns and constraints: `spec/data-model.md`. Removed and not to be reintroduced: the fixed `stories.state` enum, `custom_statuses`, `swimlanes`, `recurring_stories`, `stories.focus`, `projects.workflow_mode`, `story_pins`, `project_my_work_mapping`, and the separate `epics` table + `stories.epic_id` (doc-18 unified epics into `stories.parent_id`). `story_completions` is orphaned pending TASK-98.

## Invariants

Violating one of these is a cross-layer bug that type checking will not catch. Each links to its section below.

- **One data-access seam per client.** Web goes through `apps/web/lib/supabase/`, iOS through `Repositories/` — never construct a Supabase client anywhere else. → [Client seams](#client-seams)
- **Web and iOS share only the schema.** They never call each other, so a schema or RLS change must be checked against both repository layers. → [Client seams](#client-seams)
- **Business-rule mutations live in Postgres RPCs, invariants in the DB** (decision-1) — server actions do not cover iOS. Pure logic is per-client with shared golden fixtures in `packages/core`. → [Shared pure logic](#shared-pure-logic)
- **Every table with a `project_id` needs its own RLS policy set** — nothing is inherited. → `spec/rls.md`
- **Read `project_states.category`, never the state name.** Zone predicate, velocity, `completed_at` and the estimation gate all key off the category. → [State and category](#state-and-category)
- **Clients never insert `activity_logs`** — a trigger is the single recording path. → [Triggers own the audit trail](#triggers-own-the-audit-trail)
- **Clients never set `is_container` and never bulk-create children with plain writes** — triggers and `split_story` own hierarchy integrity. → [Containers](#containers)
- **No client sends Slack itself** — a DB trigger fires the Edge Function, so every client's write notifies. → [Slack](#slack)
- **Velocity and capacity are snapshotted at finalization**, never recomputed afterwards. → [Iterations](#iterations)
- **Cross-project story writes go through `move_story_to_project` / `copy_story_to_project` only.** → [Cross-project writes](#cross-project-writes)

<!-- hook:end -->

Everything below is reference material — read the section your change touches, not the whole file.

## Client seams

| Relation | Where | Why it matters |
|---|---|---|
| Web ⇄ Supabase | `apps/web/lib/supabase/` | All web data access goes through here — never construct a Supabase client elsewhere in `apps/web`. |
| iOS ⇄ Supabase | `apps/ios/Storylane/Repositories/` + `Core/SupabaseClient.swift` | Same rule on iOS — Views/ViewModels never call Supabase directly. |
| Web ⇄ iOS | **No direct relation.** The only shared contract is the schema + RLS policies in `supabase/migrations/`. | A schema or RLS change must be validated against both repository layers, not just one. |
| RLS ⇄ role | `spec/rls.md` — `owner` / `member` / `viewer` | Every table with a `project_id` column is gated by this; a new table needs its own policy set, not an inherited one. |

## Shared pure logic

`packages/core` holds the computations both clients must agree on, each with golden fixtures: velocity/capacity math, the advance-button state pair, and the container roll-up. Adding a client-side reimplementation of any of them is the drift this package exists to prevent (decision-1).

## State and category

`spec/data-model.md` `project_states` (doc-8 §2).

Every board column carries an immutable system category (`unstarted`/`in_progress`/`done`/`rejected`). The DB allows any→any transitions via `set_story_state`; ordering discipline is UI-only. Zone predicate, velocity, `completed_at` and the estimation gate all read `category`, never the state name.

`stories.completed_at` is set when a story enters a `done`-category state and cleared when it leaves, maintained by the single `set_story_state` write path.

## Iterations

`spec/velocity.md` (doc-8 §7) for the velocity model, `spec/data-model.md` + `spec/velocity.md` (doc-8 §4,§6) for the calendar.

- Only stories entering a `done`-category state count toward velocity (`chore`/`release` excluded); the rate is person-day normalized.
- `iterations.velocity` / `iterations.capacity` are derived and **snapshotted** at finalization, not editable once `state = 'done'`.
- Iterations past `end_date` are finalized lazily on first access (no cron in Phase 1). Web and iOS must apply the identical rule from one shared place per client. Manual "Finish iteration" reuses the same finalization path, never a second one.
- `iteration_goals` holds future-iteration goals keyed by number, adopted into the real `iterations` row on rollover/manual finish — anything creating an iteration row must consult it.
- `working_weekdays` + `project_calendar_exceptions` + `user_time_off` feed capacity. The calendar affects planning math only, never sprint boundaries (except 1-day cadence start-date selection, which consults the **project** calendar only). Calendar edits never move existing iteration rows.

## Containers

doc-18 (`spec/data-model.md` `stories`, `spec/velocity.md`).

A container (`is_container = true`, trigger-maintained) is off the board — NULL state/iteration/points — and its progress is a read-side roll-up of its children's categories, never stored. Children are ordinary board items. Depth is capped at 1 by `enforce_single_level_nesting`.

Clients never set `is_container`. The triggers own hierarchy integrity for every write route: a plain `parent_id` UPDATE for the single-child case, the `split_story` SECURITY DEFINER RPC for the multi-child Split Studio commit. Velocity and the board exclude containers via one `is_container = false` filter; the roll-up never feeds velocity.

## Triggers own the audit trail

Postgres triggers on `stories`/`comments` writes are the single `activity_logs` recording path, so every write route is covered without duplicating logic per client. `activity_logs` also references `project_id` directly, so it survives story deletion.

The trigger watches `state_id` and `iteration_id` independently on the same `UPDATE` (a single write can change both — e.g. scheduling a story into an iteration's category for the first time — and both get logged), so `finalize_iteration`'s rollover reparent and an ordinary Backlog↔Current reschedule (`move_story_board`) both record a `story.iteration_changed` row automatically, with no per-caller logging of their own.

**Exceptions** — events no INSERT/UPDATE trigger on the observed columns can capture, so those paths record their own rows: `move_story_to_project` / `copy_story_to_project` (`story.moved_out` / `story.moved_in` / `story.copied_in`, all DELETE-driven or cross-project) and the `is_container` maintenance trigger logging a container's cleared points.

## Cross-project writes

`spec/features.md` "Move / Copy".

`move_story_to_project` / `copy_story_to_project` are SECURITY DEFINER, re-check membership in both projects, and are the only sanctioned cross-project write path — clients never move stories across projects with plain table writes. The "neither project archived" re-check is deferred until TASK-8 adds `projects.archived_at`.

## My Work

`spec/data-model.md` `my_work_story_state` / `my_work_columns` (doc-15, Done-as-status TASK-176).

A purely personal, cross-project board with no project-board mapping. A story classifies to exactly ONE column: Done (live done category) > Today (`today_date`) > free column (`column_id`) > Todo, and each column has its own manual order column.

Two write paths, split by project kind:

- **Personal-project** Todo/Done drags write the REAL state via `set_story_state`, exempt from the estimation/iteration gates via `projects.is_personal`.
- **Team** stories, and all Today/free-column drags, are plain `my_work_story_state` upserts. A team story is completed only on its own board; once real-done it appears in the viewer's Done column, read from its category.

Today is date-scoped to the viewer's LOCAL wall date (client-passed), never DB `current_date`. `remove_member` purges a removed user's `my_work_story_state` rows.

## Slack

`spec/integrations.md` "Slack Notifications".

`notify_slack_event` triggers on `activity_logs` (`story.state_changed`) and `iterations` (finalize/start) write a `slack_notifications` outbox row and fire pg_net → the `slack-notify` Edge Function, which reads the row plus `integrations` and posts to Slack.

Client-agnostic on purpose (decision-1 §3): any client's write notifies, so no client sends Slack itself. Message formatting is duplicated into the Edge Function because Deno cannot import the web workspace; the vitest and Deno tests assert the same input/output pairs to catch drift.
