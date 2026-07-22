---
id: TASK-135
title: >-
  Backfill legacy per-column story positions predating TASK-111's
  global-sequence fix
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 13:14'
labels: []
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
- [ ] #1 A one-time backfill migration renumbers stories.position into a single ascending, iteration-wide sequence per (project_id, iteration_id) for all pre-existing rows, matching the ordering move_story_board now produces going forward
- [ ] #2 Backlog stories (iteration_id is null) are unaffected/out of scope -- their positions were already a separate, correctly-scoped sequence
- [ ] #3 The backfill is idempotent -- safe to run against a database where some iterations have already self-healed via a drag, without disturbing already-correct sequences
- [ ] #4 A test or verification query demonstrates the fix against a fixture with pre-existing overlapping positions across state columns in one iteration
- [ ] #5 Migration passes local supabase db reset; pnpm test + lint green
<!-- AC:END -->
