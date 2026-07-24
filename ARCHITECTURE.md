# Storylane — Architecture Relations

A short map of how things connect across the three layers (Web / iOS / Supabase), so relations don't have to be re-derived from scratch each session. Update this file when a new cross-cutting relation is introduced — keep it short, this is not a copy of SPEC.md.

## Entity relations (see spec/data-model.md for full column definitions)

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
*(`story_completions` retired by TASK-176 — Done is a status column now; the
table is orphaned pending TASK-98's removal.)*

- `stories.iteration_id` / `stories.parent_id` are nullable (ON DELETE SET NULL) — a story can exist in the backlog with no iteration/parent. `stories.state_id` is a composite FK to `project_states` (ON DELETE RESTRICT); **NULL = Icebox** (unscheduled). The old fixed `stories.state` enum, `custom_statuses`, `swimlanes`, `recurring_stories`, `stories.focus`, `projects.workflow_mode`, `story_pins`, and the separate **`epics` table + `stories.epic_id`** were removed (the last in the doc-18 Epic/Story unification — an epic is now a story with children, `is_container = true`, grouped by `parent_id`).
- `stories.parent_id` is a self-reference (doc-18): a container (`is_container = true`, trigger-maintained) is off the board (NULL state/iteration/points) and its progress is a read-side roll-up of its children; children are ordinary board items. Depth is capped at 1 by `enforce_single_level_nesting`. `split_story` (owner/member SECURITY DEFINER RPC) is the bulk create-children path; the `is_container` maintenance trigger clears a container's points and logs the old value.
- `iterations.velocity` and `iterations.capacity` are derived and **snapshotted** at finalization (see spec/velocity.md), not independently editable once `state = 'done'`.
- `activity_logs` fans out from `stories` but also references `project_id` directly — it survives story deletion.
- `my_work_story_state(user_id, story_id)` is per-user, cross-project — it drives My Work placement (a done-category story → Done first; else `today_date` → Today; else `column_id` → a `my_work_columns` free column; else Todo) and holds each column's manual card order (`today_position`/`column_position`/`todo_position`/`done_position`). `my_work_columns(user_id, id)` are the user's free columns (`Doing` seeded), the target of my_work_story_state's composite FK; `user_time_off(user_id, date, kind)` is per-user and read by co-members for capacity math. Done membership is read from the story's live done category (TASK-176), not a stored mark — `story_completions` (the old append-only Done log) is orphaned. *(doc-15 removed `project_my_work_mapping` — My Work no longer maps to project boards.)*

## Cross-layer coupling

| Relation | Where it lives | Why it matters |
|---|---|---|
| Web ⇄ Supabase | `apps/web/lib/supabase/` | All web data access goes through here — never construct a Supabase client elsewhere in `apps/web`. |
| iOS ⇄ Supabase | `apps/ios/Storylane/Repositories/` + `Core/SupabaseClient.swift` | Same rule on iOS — Views/ViewModels never call Supabase directly. |
| Web ⇄ iOS | **No direct relation.** They never call each other. The only shared contract is the Supabase schema + RLS policies in `supabase/migrations/`. | A schema or RLS change must be validated against both repository layers, not just one. |
| RLS ⇄ role | `spec/rls.md` — `owner` / `member` / `viewer` via `project_members.role` | Every table with a `project_id` column is gated by this; a new table needs its own policy set, not an inherited one. |
| Velocity ⇄ state category | `spec/velocity.md` (doc-8 §7) — only stories entering a `done`-category state count (`chore`/`release` excluded); rate = Σpoints ÷ Σcapacity over the window | Person-day normalized. Auto-assignment and finalization both depend on this; the rate/capacity math is a shared `packages/core` pure function with golden fixtures — keep Web/iOS in sync. |
| State ⇄ category | `spec/data-model.md` `project_states` (doc-8 §2) — every board column carries an immutable system category (`unstarted`/`in_progress`/`done`/`rejected`); DB allows any→any via `set_story_state`, ordering discipline is UI-only | Zone predicate, velocity, `completed_at`, and the estimation gate all read `category`, never the state name. Any client rendering the board or advancing a story reads `project_states`; the advance-button/pair computation is a shared pure function. |
| Calendar/capacity ⇄ iterations | `spec/data-model.md` + `spec/velocity.md` (doc-8 §4,§6,§7) — `working_weekdays` + `project_calendar_exceptions` + `user_time_off` feed capacity; 1-day cadence start-date selection consults the **project** calendar only | Calendar affects planning math only, never sprint boundaries (except 1-day start selection). Capacity is snapshotted at finalization and never recomputed; calendar edits never move existing iteration rows. |
| activity_logs ⇄ DB triggers | Postgres triggers in `supabase/migrations/` (added in Task 9) on `stories`/`comments` writes | Clients (Web/iOS/Edge Functions) never insert `activity_logs` directly — the trigger is the single recording path, so every write route is covered without duplicating logic per client. **Exceptions:** `move_story_to_project`/`copy_story_to_project` (TASK-14) insert `'story.moved_out'`/`'story.moved_in'`/`'story.copied_in'` rows, and the `is_container` maintenance trigger (doc-18 §4) logs a container's cleared points — all DELETE-driven / cross-project / value-lost events no INSERT/UPDATE trigger on the observed columns can capture, so that path records them itself. |
| Iteration rollover ⇄ lazy finalization | `spec/velocity.md` (Task 12.5) — iterations past `end_date` are finalized on first access; no cron in Phase 1 | Web and iOS must apply the identical rollover rule from one shared place per client (or it moves server-side to an Edge Function) — never implement it in only one client or duplicate it per view. Manual "Finish iteration" (2026-07-07) reuses the same finalization path, never a second one. |
| iteration_goals ⇄ rollover | `spec/data-model.md` + `spec/velocity.md` (2026-07-07) — future-iteration goals keyed by number, adopted into the real `iterations` row on rollover/manual finish | Goal adoption lives inside the shared finalization path; anything creating an iteration row must consult `iteration_goals`. |
| stories.completed_at ⇄ done category | `spec/data-model.md` (doc-8 §2) — set when a story enters a `done`-category state, cleared when it leaves | Maintained by the single `set_story_state` write path; done-state columns and My Work date grouping read it. |
| My Work state ⇄ personal board | `spec/data-model.md` `my_work_story_state` / `my_work_columns` (doc-15, Done-as-status TASK-176) — a purely personal board, no project-board mapping. A story classifies to ONE column: Done (live done category) > Today (`today_date`) > free column (`column_id`) > Todo; each column has its own manual order column. `remove_member` purges a removed user's `my_work_story_state` rows (SECURITY DEFINER RPC) | Two write paths, split by project kind: **personal-project** Todo/Done drags write the REAL state via `set_story_state` (exempt from the estimation/iteration gates via `projects.is_personal`); **team** stories and all Today/free-column drags are plain `my_work_story_state` upserts. A team story is completed only on its own board; once real-done it shows in the viewer's Done column read from its category (no `story_completions` log). Today is date-scoped to the viewer's LOCAL wall date (client-passed), never DB `current_date`. |
| Story Move/Copy ⇄ cross-project RPC | `spec/features.md` "Move / Copy" (2026-07-07, implemented TASK-14) — SECURITY DEFINER, membership re-checked in both projects, first RPC in the codebase touching two `project_id`s in one transaction | The only sanctioned cross-project write path; clients never move stories across projects with plain table writes. The "neither project archived" re-check is deferred until TASK-8 adds `projects.archived_at`. |
| Container roll-up ⇄ state category | doc-18 §5 (`spec/data-model.md` `stories`, `spec/velocity.md`) — a container's headline state and point sum are aggregated from its children's `project_states.category`; read-side only, never stored | Any client rendering the `/epics` view or the List accordion computes the roll-up from a shared `packages/core` pure function with golden fixtures (Web/iOS parity, like the advance-button and capacity computations). Velocity/board exclude containers via one `is_container = false` filter; the roll-up never feeds velocity. |
| Split / nesting integrity ⇄ DB triggers | doc-18 §3–§4, §6 (`supabase/migrations/`) — `enforce_single_level_nesting` (depth ≤ 1) and the `is_container` maintenance trigger (auto true/false + points clear + audit log) on `stories.parent_id` writes; `split_story` for the bulk Split Studio commit | Clients never set `is_container` (read-only) and never bulk-create children with plain writes — the triggers own hierarchy integrity for every write route (plain `parent_id` UPDATE for the single-child case, `split_story` for the multi-child Split Studio commit), so Web/iOS/MCP all inherit the same rules. |
| Slack notifications ⇄ DB trigger → Edge Function | `spec/integrations.md` "Slack Notifications" (TASK-24) — `notify_slack_event` triggers on `activity_logs` (`story.state_changed`) and `iterations` (finalize/start) record a `slack_notifications` outbox row + fire pg_net → the `slack-notify` Edge Function, which reads the row + `integrations` and posts to Slack | Client-agnostic on purpose (decision-1 §3): any client's write notifies, so no client (Web/iOS/MCP) sends Slack itself — the Web server action's `notifySlack` was removed. Message-formatting logic is duplicated into the Edge Function (Deno can't import the web workspace); the vitest and Deno tests assert the same input/output pairs to catch drift. |

## Current phase

Web-first: Tasks 6–13 are implemented on Web, then ported to iOS (see `TASK.md`). Don't start an iOS task before its Web counterpart is done — the Web implementation is where spec ambiguities get resolved first.
