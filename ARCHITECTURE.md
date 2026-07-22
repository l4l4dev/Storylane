# Storylane — Architecture Relations

A short map of how things connect across the three layers (Web / iOS / Supabase), so relations don't have to be re-derived from scratch each session. Update this file when a new cross-cutting relation is introduced — keep it short, this is not a copy of SPEC.md.

## Entity relations (see spec/data-model.md for full column definitions)

```
profiles ──< project_members >── projects ──< integrations
   │                                 │      ──< project_calendar_exceptions
   │
profiles ──< my_work_columns          (per-user free columns; My Work)
my_work_story_state ┌──────┬─────────┼──────────┬──────────────┐
   │              epics  iterations  labels   project_states  (working_weekdays,
   │                │       │          │          │             iteration_length,
   └──< stories >───┴───────┴──< story_labels >───┘             iteration_term)
          │  state_id → project_states (NULL = Icebox)
   ┌──────┼──────────┬──────────────┐
 tasks  comments  activity_logs  story_completions

profiles ──< user_time_off        (cross-project; capacity math)
profiles ──< story_completions    (cross-project; My Work's Done log)
```

- `stories.iteration_id` / `stories.epic_id` are nullable (ON DELETE SET NULL) — a story can exist in the backlog with no iteration/epic. `stories.state_id` is a composite FK to `project_states` (ON DELETE RESTRICT); **NULL = Icebox** (unscheduled). The old fixed `stories.state` enum, `custom_statuses`, `swimlanes`, `recurring_stories`, `stories.focus`, `projects.workflow_mode`, and `story_pins` were removed in the doc-8 concept redesign / doc-14 My Work rework (single mode).
- `iterations.velocity` and `iterations.capacity` are derived and **snapshotted** at finalization (see spec/velocity.md), not independently editable once `state = 'done'`.
- `activity_logs` fans out from `stories` but also references `project_id` directly — it survives story deletion.
- `my_work_story_state(user_id, story_id)` is per-user, cross-project (drives My Work placement: `today_date` for Today, `column_id` → `my_work_columns` for a free column, else Todo); `my_work_columns(user_id, id)` are the user's free columns (`Doing` seeded), the target of my_work_story_state's composite FK; `story_completions(id, story_id, user_id, completed_at)` is an append-only per-user completion log (My Work's Done column), live-joined to the story's current data; `user_time_off(user_id, date, kind)` is per-user and read by co-members for capacity math. *(doc-15 removed `project_my_work_mapping` — My Work no longer maps to project boards.)*

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
| activity_logs ⇄ DB triggers | Postgres triggers in `supabase/migrations/` (added in Task 9) on `stories`/`comments` writes | Clients (Web/iOS/Edge Functions) never insert `activity_logs` directly — the trigger is the single recording path, so every write route is covered without duplicating logic per client. **Exceptions:** `promote_story_to_epic` (TASK-13, `20260710000001_promote_story_to_epic.sql`) inserts one bespoke `'story.promoted_to_epic'` row, and `move_story_to_project`/`copy_story_to_project` (TASK-14, `20260711000001_move_copy_story.sql`) insert `'story.moved_out'`/`'story.moved_in'`/`'story.copied_in'` rows — all DELETE-driven or cross-project events no INSERT/UPDATE trigger can observe, so the RPC itself is the only place left to record them. |
| Iteration rollover ⇄ lazy finalization | `spec/velocity.md` (Task 12.5) — iterations past `end_date` are finalized on first access; no cron in Phase 1 | Web and iOS must apply the identical rollover rule from one shared place per client (or it moves server-side to an Edge Function) — never implement it in only one client or duplicate it per view. Manual "Finish iteration" (2026-07-07) reuses the same finalization path, never a second one. |
| iteration_goals ⇄ rollover | `spec/data-model.md` + `spec/velocity.md` (2026-07-07) — future-iteration goals keyed by number, adopted into the real `iterations` row on rollover/manual finish | Goal adoption lives inside the shared finalization path; anything creating an iteration row must consult `iteration_goals`. |
| stories.completed_at ⇄ done category | `spec/data-model.md` (doc-8 §2) — set when a story enters a `done`-category state, cleared when it leaves | Maintained by the single `set_story_state` write path; done-state columns and My Work date grouping read it. |
| My Work state ⇄ personal board | `spec/data-model.md` `my_work_story_state` / `my_work_columns` / `story_completions` (doc-15) — a purely personal board, no project-board mapping. Placement is manual (Today `today_date` / free column `column_id` / Todo); `remove_member` purges a removed user's `my_work_story_state` rows (SECURITY DEFINER RPC), `story_completions` is written only by the `maintain_story_completed_at` trigger | Two write paths, split by project kind, not by mapping: **personal-project** Todo/Done drags write the REAL state via `set_story_state` (exempt from the estimation/iteration gates via `projects.is_personal`); **team** stories and all Today/free-column drags are plain `my_work_story_state` upserts. A team story is completed only on its own board. Today is date-scoped to the viewer's LOCAL wall date (client-passed), never DB `current_date`. |
| Story Move/Copy ⇄ cross-project RPC | `spec/features.md` "Move / Copy" (2026-07-07, implemented TASK-14 `20260711000001_move_copy_story.sql`) — SECURITY DEFINER, membership re-checked in both projects, first RPC in the codebase touching two `project_id`s in one transaction | The only sanctioned cross-project write path; clients never move stories across projects with plain table writes. The "neither project archived" re-check is deferred until TASK-8 adds `projects.archived_at`. |
| Slack notifications ⇄ DB trigger → Edge Function | `spec/integrations.md` "Slack Notifications" (TASK-24, `20260721000003_slack_notifications_outbox.sql`) — `notify_slack_event` triggers on `activity_logs` (`story.state_changed`) and `iterations` (finalize/start) record a `slack_notifications` outbox row + fire pg_net → the `slack-notify` Edge Function, which reads the row + `integrations` and posts to Slack | Client-agnostic on purpose (decision-1 §3): any client's write notifies, so no client (Web/iOS/MCP) sends Slack itself — the Web server action's `notifySlack` was removed. Message-formatting logic is duplicated into the Edge Function (Deno can't import the web workspace); the vitest and Deno tests assert the same input/output pairs to catch drift. |

## Current phase

Web-first: Tasks 6–13 are implemented on Web, then ported to iOS (see `TASK.md`). Don't start an iOS task before its Web counterpart is done — the Web implementation is where spec ambiguities get resolved first.
