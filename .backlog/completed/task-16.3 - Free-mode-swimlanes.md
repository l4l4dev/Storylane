---
id: TASK-16.3
title: 'Free mode: swimlanes'
status: Done
assignee: []
created_date: '2026-07-07 14:28'
updated_date: '2026-07-09 11:54'
labels:
  - web
  - db
milestone: m-0
dependencies: []
references:
  - spec/screens.md
  - spec/data-model.md
parent_task_id: TASK-16
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md and spec/data-model.md: swimlanes table + stories.swimlane_id (composite FK). When lanes exist the board renders lanes × columns plus a 'No lane' band; dragging across bands sets swimlane_id; lanes managed in Settings alongside custom statuses; deleting a lane with stories is blocked (23503 → friendly message).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration adds swimlanes and stories.swimlane_id with composite FK and RLS; rls-security-reviewer has reviewed it
- [x] #2 Board renders lanes × columns with a No-lane band when lanes exist; unchanged single-band board when none
- [x] #3 Dragging a card across bands sets swimlane_id; within-band drags keep existing column/reorder behavior
- [x] #4 Lanes are created/renamed/reordered/deleted in Settings; delete with stories shows the move-off message
- [x] #5 Tests cover lane rendering, cross-band drag, and delete blocking
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260709000007_free_mode_swimlanes.sql: swimlanes table (project_id NOT NULL CASCADE, UNIQUE(id,project_id), position, created_at) + project_id index; stories.swimlane_id composite FK (no ON DELETE) + index; RLS: same 4 policies as custom_statuses (member select, owner/member insert/update, owner delete); no grants needed (default privileges cover it); DOWN comment block.
2. Regenerate apps/web/lib/database.types.ts via supabase gen types typescript --local.
3. lib/utils/board.ts: add laneContainerKey/parseLaneContainerKey pure helpers + unit tests.
4. settings/actions.ts: createLane/updateLane/deleteLane (23503 -> 'Move the stories off this lane before deleting it')/moveLane, copied from custom_statuses actions.
5. New lane-manager.tsx (LaneManager) modeled on status-manager.tsx; Swimlanes section in settings/page.tsx gated on isFree.
6. board/page.tsx FreeBoardPage: fetch swimlanes ordered by position; stories select adds swimlane_id + a deterministic second sort key; build initialContainers via laneContainerKey when lanes.length>0 (No lane first), else keep today's per-status keys unchanged.
7. free-board.tsx: add lanes prop. 0 lanes = current render untouched. >0 lanes = column-header row rendered once (WIP count/menu = column total across all lanes) + lane bands stacked below (No-lane band always shown first, even empty); quick-add composer lives in the No-lane band's cell only; each lane x column cell is its own droppable/SortableContext with per-cell is_done date grouping; handleDragEnd parses the composite key back to {statusId,laneId} and sends both to dropStoryFree, keeping the existing TASK-22 await+revert-on-failure pattern.
8. dropStoryFree (board/actions.ts): read swimlane_id from formData (has() distinguishes 'no lanes on this board' from 'moved to No lane'); validate lane belongs to project like status; single update() for status+lane together; Slack notify only on status(column) change, not lane-only moves.
9. Tests: free-board lane rendering (0 lanes unchanged, >0 lanes bands + No-lane first), cross-band drag sends correct swimlane_id, within-band reorder unaffected, lane delete-with-stories blocked message, board.ts helper unit tests.
10. Run rls-security-reviewer on the migration before marking AC #1 done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per plan: swimlanes migration+RLS (reviewed clean by rls-security-reviewer), types regenerated, laneContainerKey/parseLaneContainerKey helpers + tests, lane CRUD actions + LaneManager settings UI, FreeBoard lanes rendering (column-header-once + lane bands, No lane first, quick-add only in No-lane cell, per-cell done-date grouping), dropStoryFree extended with swimlane_id (single update, status-only Slack notify), deterministic secondary sort key on stories query. tsc/lint/full test suite (247 tests) all pass.

Post-review fix: web-conventions-reviewer caught a TS error in free-board.test.tsx (Element vs HTMLElement from .closest()) that tsc hadn't been re-run against after adding the test file - fixed with .closest<HTMLElement>(). tsc/lint/vitest (247 tests) all clean after the fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added free-mode swimlanes end-to-end: swimlanes table + composite FK + RLS (rls-security-reviewer clean), Settings CRUD (LaneManager), and FreeBoard lane-band rendering (No lane shown first even empty, quick-add only in No-lane cell, per-cell WIP/done-date handling unchanged for the 0-lane case). dropStoryFree now carries swimlane_id alongside custom_status_id in one update, notifying Slack only on column change. Verified with tsc --noEmit, eslint, and the full vitest suite (247 passed), plus web-conventions-reviewer (caught and fixed one test typing issue).
<!-- SECTION:FINAL_SUMMARY:END -->
