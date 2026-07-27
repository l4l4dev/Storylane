---
id: TASK-207
title: Burndown / cumulative flow chart for the current iteration
status: In Progress
assignee:
  - '@gpt-5.6-sol'
created_date: '2026-07-27 01:48'
updated_date: '2026-07-27 15:44'
labels: []
milestone: m-0
dependencies: []
priority: medium
ordinal: 2100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SPEC.md lists a burndown chart under Phase 2 (spec/features.md) but it was never built. activity_logs already records story.state_changed events with before/after payload (spec/data-model.md 'activity_logs'), so a day-by-day remaining-points burndown (or a cumulative flow diagram across state categories) can be derived from existing event history without a new snapshot table. This gives the team the standard sprint-review artifact ('how much is left, how did we track against the plan') that the tool currently has no answer for.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A chart on the board/iteration view (see spec/screens.md 'Board layout') shows, for the current iteration, remaining done-category points per day since the iteration's start_date, derived from activity_logs.story.state_changed history plus the iteration's snapshotted capacity/velocity (spec/velocity.md)
- [ ] #2 Ideal-pace reference line uses the iteration's capacity the same way spec/velocity.md's forecast formula does, so the chart is consistent with the existing velocity math rather than a second parallel calculation
- [ ] #3 Works for past done iterations too (viewing history), not just the live current one
- [ ] #4 Handles iterations with no activity_logs coverage (pre-dating this feature) by showing a partial/empty chart rather than erroring
- [ ] #5 spec/features.md is updated to move this out of Phase 2, and spec/screens.md documents where the chart lives
- [ ] #6 Tests cover the remaining-points derivation from a fixture set of activity_logs rows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Second /code-review pass (10 findings) addressed, all in this same TASK-206 session since TASK-207's own assignee (@gpt-5.6-sol) work was uncommitted in the shared worktree:

Fixed:
1. [correctness, critical] finalize_iteration's new activity_logs INSERT and the iteration_id UPDATE were two independent statements re-evaluating the same predicate under READ COMMITTED — a concurrent set_story_state between them could log a rollover that didn't happen, or move a story with no log of it. Rewritten as one atomic statement: UPDATE...RETURNING feeds the INSERT via a CTE, so the logged set is exactly what was moved, by construction.
2. [correctness] burndown.ts's coverage guard checked resolved.length===0 instead of usable.length===0 — an iteration whose logs all failed category resolution reported 'partial' with zero real signal instead of 'none'.
3. [correctness] Both activity_logs fetchAllRows queries (state_changed, iteration_rolled_over) had no secondary order tiebreaker before .range()-based pagination — added .order('id') after created_at, so paging stays deterministic once a project's log history exceeds the 1000-row page cap.
4. [correctness] describeActivity (activity.ts) had no case for the new story.iteration_rolled_over action, so it would render the raw action string in the activity feed. Added a case; also extended the migration's payload with from/to_iteration_number so the message can name sprints, not raw UUIDs (matching iteration.length_overridden's precedent).
5. [docs] ARCHITECTURE.md's activity_logs trigger-exception list didn't mention finalize_iteration as a 4th self-recording path (only named move/copy and the is_container trigger) — added.
6. [docs] The migration's CREATE OR REPLACE of finalize_iteration silently dropped two explanatory comments from the prior version (capacity-pinning rationale, v_roles/TASK-142 rationale) — restored.
7. [regression] Redundant double empty-state when a project has zero iterations at all ('No iterations yet.' followed immediately by the History section's own empty-state) — History section now only renders when allIterations.length > 0.
8. [test-coverage] No test exercised the DoD popover's conditional rendering. Added 3 cases to transition-buttons.test.tsx (shows only next to a done-category target, hidden when unset, hidden for a non-done target) and a new kanban-columns-board.test.tsx (same 3 cases for the column-header path) — exported KanbanColumn (was private) to make it testable in isolation without a DndContext.

Also fixed from the rls-security-reviewer pass on the same migration: actor_id used coalesce(v_actor, s.created_by), diverging from the move/copy precedent's plain auth.uid() (harmless given current grants, but simplified to match).

Flagged, not fixed: targetByIteration's ideal-pace line collapses to 1 (forecastPoints' min-1 floor) for a legacy/first iteration with no prior velocity rate or snapshotted capacity. This follows directly from AC#2's explicit choice to reuse forecastPoints uniformly 'for consistency with existing velocity math' — changing it would mean overriding that acceptance criterion's stated intent, a design call I'm not making unilaterally. Left as-is; owner should decide whether a done iteration's ideal line should instead use its own snapshotted iteration.velocity.

Re-verified after all fixes: tsc/lint clean, supabase db reset applies the corrected migration cleanly, full suite (SUPABASE_INTEGRATION=1 + CI's localStorage condition) 1116/1116 passed (130 files, +6 tests over the prior pass).

Comments:
--------------------------------------------------
#1 - @claude-sonnet-5 - 2026-07-27 06:14 (UTC)
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.

#2 - @claude-sonnet-5 - 2026-07-27 06:38 (UTC)
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.

---

Third round: Codex's automated review on PR #6 (after merge to main) found 5 more issues, 2 of them P1 and genuinely serious since the merge had already deployed to production:

1. [P1, LIVE BUG] supabase/migrations/20260727100000_iteration_retro_notes.sql (TASK-205) added iterations.retro_notes with a bare ALTER TABLE, but 20260720000002_iteration_capacity.sql had already revoked table-level UPDATE on iterations and granted back only 'update (goal)' to authenticated. The new column was never added to that grant, so every owner/member save through updateIterationRetroNotes hit 42501 before RLS was even evaluated. Confirmed live: PATCH .../iterations with retro_notes as the signed-in dev user returned exactly that error, against the just-deployed production schema. Fixed: supabase/migrations/20260727130000_grant_iteration_retro_notes.sql adds the missing column grant. Re-verified the same request now returns 200.

2. [P1] The story.iteration_rolled_over logging this task's second round added only covered finalize_iteration's automated rollover -- an ordinary Backlog<->Current drag (move_story_board) changes iteration_id via a plain UPDATE with no logging at all, so normal rescheduling silently rewrote burndown history exactly like the bug the rollover logging was meant to fix. Root-caused instead of patched per call site: supabase/migrations/20260727140000_generalize_iteration_change_log.sql extends log_story_activity (already a trigger watching state_id) to also watch iteration_id independently -- not mutually exclusive with a state_id change in the same statement, since move_story_board can change both at once. This makes finalize_iteration's explicit INSERT redundant (removed); the plain UPDATE it already does is now caught automatically. Action renamed story.iteration_rolled_over -> story.iteration_changed (generic). Verified live: a plain iteration_id UPDATE now logs correctly, and a combined state_id+iteration_id UPDATE in one statement logs both events.

3. [P2] The stories query in iterations/page.tsx had no pagination, unlike the activity_logs queries fixed in round 2 -- a project whose stories exceed PostgREST's 1000-row cap would silently lose stories from every chart. Wrapped in the existing fetchAllRows helper, matching board/page.tsx's own precedent.

4. [P2] BurndownChart's SVG polyline paints nothing for a single-point series (day one of a current iteration, or any 1-day-cadence iteration) -- no line has two points to connect. Added circle markers for the single-point case; new test asserts 2 circles render.

5. [P2, deferred to TASK-218] Re-estimating a story's points mid-iteration or after completion retroactively rewrites every day's remaining-points total in the chart, since buildBurndown applies the story's CURRENT points uniformly rather than reconstructing points-at-each-date. Requires new point-change logging plus a real change to buildBurndown's replay algorithm -- bigger than the other 4, filed separately rather than rushed.

Also reverted ARCHITECTURE.md's exception-list wording from round 2 (finalize_iteration's rollover insert is no longer a self-recorded exception now that the general trigger covers it) and updated describeActivity's message for the renamed, now-generic action.

Re-verified: tsc/lint clean, supabase db reset applies the full chain (7 migrations) cleanly, full suite under CI conditions 1117/1117 passed (+1 for the new single-point chart test).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-27 06:14
---
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.
---

author: @claude-sonnet-5
created: 2026-07-27 06:38
---
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.
---
<!-- COMMENTS:END -->
