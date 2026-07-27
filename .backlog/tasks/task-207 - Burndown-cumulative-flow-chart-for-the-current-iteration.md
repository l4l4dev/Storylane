---
id: TASK-207
title: Burndown / cumulative flow chart for the current iteration
status: In Progress
assignee:
  - '@gpt-5.6-sol'
created_date: '2026-07-27 01:48'
updated_date: '2026-07-27 11:32'
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
