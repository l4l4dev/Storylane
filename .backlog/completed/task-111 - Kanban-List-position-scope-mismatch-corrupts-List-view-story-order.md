---
id: TASK-111
title: Kanban/List position-scope mismatch corrupts List-view story order
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
updated_date: '2026-07-21 11:35'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 10800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #2. apps/web/lib/utils/kanban.ts:254 (flattenCurrentZone) sorts merged stories by raw position assuming one shared sequence, but Kanban drags reset position per-state-column while List drags use one project-wide sequence — the two scopes are incompatible, so switching Kanban->List can interleave stories from different columns out of order.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 flattenCurrentZone (or move_story_board) reconciles the two position scopes so switching Kanban->List never interleaves stories from different columns out of column-order
- [x] #2 A test reproduces doc-13's scenario (reorder within two Kanban columns, then flatten for List) and proves correct grouping
- [x] #3 kanban.test.ts's flattenCurrentZone test is extended to catch column-local (non-globally-unique) positions, not just the hand-picked globally-unique case
- [x] #4 pnpm test + lint green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the Kanban/List position-scope mismatch (doc-13 finding #2). move_story_board's Kanban (tracker) branch re-densified position scoped to (iteration_id, state_id) — one 0-based run per state column — colliding across columns and corrupting the List view's flat, position-ordered rendering (flattenCurrentZone). New migration 20260721000007_move_story_board_global_positions.sql makes the tracker branch re-densify the whole current iteration (same iteration-scoped set the list branch uses), so both views share one sequence; the board already loads stories order-by-position and buckets into columns, so Kanban's within-column order is a correct subsequence with zero read-side change. Kanban column-end drops (anchor null) are pre-resolved to the first story after the moved card's column tail (null-safe fallback to append), so a card dropped at a column's end doesn't jump to the iteration's absolute bottom in List view. fable-advisor design-reviewed the plan (approve-with-changes: base on the TASK-88 body not the stale 20260719000008, and add the column-end anchor resolution — both applied). rls-security-reviewer: clean, no security issue (auth guard/staleness/cross-tenant guards byte-identical to base; only the intended position block changed; added a comment noting the v_current_id-scoping invariant per their non-blocking note). Tests: extended kanban.test.ts flattenCurrentZone (interleaved global positions) + 2 new move-story-board integration tests (interleaved-layout Kanban reorder yields one dense 0..3 sequence with no collision; column-end drop lands after the column tail, not the iteration bottom). Full web suite (558) + tsc + lint green; move-story-board (14 incl. new 2) + related board/position integration tests green.
<!-- SECTION:FINAL_SUMMARY:END -->
