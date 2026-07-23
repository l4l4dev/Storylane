---
id: TASK-135
title: >-
  Backfill legacy per-column story positions predating TASK-111's
  global-sequence fix
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 13:14'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in code review (2026-07-21). TASK-111's migration (supabase/migrations/20260721000007_move_story_board_global_positions.sql) changed move_story_board to maintain one iteration-wide position sequence going forward, but shipped with no backfill/UPDATE statement for existing rows. Any iteration that already has stories spread across multiple state columns, positioned under the old per-(iteration_id, state_id) scheme before this migration deployed, keeps overlapping/duplicate position values across columns until the first drag in that specific iteration re-densifies it as a side effect. apps/web/lib/utils/kanban.ts's flattenCurrentZone (used by the List view) sorts purely by the raw position column with no secondary tiebreak, so any project with such an iteration renders its List view out of the intended priority order from the moment this migration deploys until someone happens to drag a card in that iteration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A one-time backfill migration renumbers stories.position into a single ascending, iteration-wide sequence per (project_id, iteration_id) for all pre-existing rows, matching the ordering move_story_board now produces going forward
- [x] #2 Backlog stories (iteration_id is null) are unaffected/out of scope -- their positions were already a separate, correctly-scoped sequence
- [x] #3 The backfill is idempotent -- safe to run against a database where some iterations have already self-healed via a drag, without disturbing already-correct sequences
- [x] #4 A test or verification query demonstrates the fix against a fixture with pre-existing overlapping positions across state columns in one iteration
- [x] #5 Migration passes local supabase db reset; pnpm test + lint green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: migration 20260722000013 - a single idempotent UPDATE that renumbers each (project_id, iteration_id) group's stories.position into a dense 0-based sequence, order by (position, project_states.position, id). Primary key is position (what move_story_board densifies by going forward); the cross-column tie at equal positions - the actual TASK-111 legacy bug - is broken by the board's visual left-to-right column order, then id. 'position is distinct from new_pos' makes it a no-op for already-dense iterations, so it's idempotent and safe against partially self-healed DBs. Backlog (iteration_id null) excluded (AC #2). Position-only UPDATE fires only set_updated_at among stories' triggers (checked: maintain_story_completed_at early-returns on unchanged state_id, reject_done_iteration_assignment is WHEN iteration_id changes, pin_story_number guards number).

Verified: db reset green. New integration test (backfill-iteration-positions.integration.test.ts, 3 cases) builds the exact legacy overlap (two 0-based per-column runs colliding across Unstarted/Started/Finished), runs the same ranking statement scoped to the test project, and asserts the dense A,C,E,B,D result; plus idempotency (2nd run rowCount 0) and backlog-untouched. The test genuinely fails without the backfill ([0,0,0,1,1] != [0,1,2,3,4]). Full suite 827 pass, only the 2 known pre-existing unrelated failures; tsc + lint clean.

rls-security-reviewer: DEFERRED to after the account session-limit reset (9pm JST) - the reviewer agent is rate-limited right now. This migration has zero RLS/policy/grant/security-definer surface (a pure stories.position data backfill), so the standing migration-review rule applies but the risk is minimal; batched with the viewer-rollover migration's owed re-run.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Backfilled TASK-111's missing one-time normalization (migration 20260722000013): an idempotent UPDATE renumbers every pre-existing iteration's stories.position into the same dense, iteration-wide 0-based sequence move_story_board now maintains, so the List view (flattenCurrentZone, which sorts purely by position) renders in order without waiting for a drag to self-heal. Ordering is by position primary, then the board's left-to-right state-column order to break the cross-column overlap that was the bug, then id. Idempotent (writes only rows that move) and scoped to iteration stories only (backlog is a separate correct sequence). Verified by a new integration test that reconstructs the exact legacy overlap and asserts the dense renumber + idempotency + backlog-untouched (it fails without the backfill); db reset + tsc + lint + suite green (only 2 known pre-existing unrelated failures). NOTE: the standing migration rls-security-reviewer pass is deferred to after the account session-limit reset (9pm JST) since the agent is rate-limited; this backfill has no RLS surface (pure position UPDATE).
<!-- SECTION:FINAL_SUMMARY:END -->
