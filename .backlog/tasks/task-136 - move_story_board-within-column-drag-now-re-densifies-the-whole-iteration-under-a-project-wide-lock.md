---
id: TASK-136
title: >-
  move_story_board: within-column drag now re-densifies the whole iteration
  under a project-wide lock
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 13:14'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in code review (2026-07-21). TASK-111's fix widened move_story_board's single-zone position-rewrite loop from scoping by (iteration_id, state_id) -- one state column -- to scoping by iteration_id alone (every column in the current iteration), to fix List/Kanban ordering consistency. Correct for cross-column consistency, but as a side effect a plain within-column reorder drag (dragging a card up/down inside the same Kanban column, no state/iteration change) now re-densifies every column's positions in one pass, via N individual per-row UPDATE statements rather than a set-based bulk write, while holding the same project-wide pg_advisory_xact_lock (iteration_finalize:<project_id>) that finalize_iteration also takes. On a board with many columns/stories, a single drag now holds that lock proportionally longer than before TASK-111, serializing concurrent drags and iteration finalization for that much longer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A within-column reorder (drag that doesn't change state_id or iteration_id) only rewrites positions for the touched column's rows, not the whole iteration -- while a cross-column move still re-densifies consistently across the whole iteration so TASK-111's ordering guarantee is preserved
- [ ] #2 The position-rewrite write is a single set-based statement (e.g. via unnest(...) with ordinality) rather than N individual per-row UPDATEs, for whichever scope ends up being rewritten
- [ ] #3 A test demonstrates that a within-column drag on a multi-column iteration only touches rows in that column and that List-view (cross-column) ordering remains correct afterward
- [ ] #4 rls-security-reviewer pass is clean if grants/policies are touched; migration passes local supabase db reset; pnpm test + lint green
<!-- AC:END -->
