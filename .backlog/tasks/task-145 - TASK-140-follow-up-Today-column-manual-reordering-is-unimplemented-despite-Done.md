---
id: TASK-145
title: >-
  TASK-140 follow-up: Today column manual reordering is unimplemented despite
  Done
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 11:14'
updated_date: '2026-07-22 11:53'
labels: []
dependencies:
  - TASK-140
priority: medium
type: bug
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Re-verification of TASK-140 (2026-07-22) found its AC #3 ('Today column supports manual reordering persisted in today_position') was checked off Done but the behavior does not exist. resolveDragEndTarget (apps/web/lib/utils/my-work.ts:222) returns null whenever a drag starts and ends in the same column, and handleDragEnd (my-work-sections.tsx) does nothing on null -- no setMyWorkColumn call, no today_position write. There is no other write path for within-column reordering (nextTodayPosition only appends on cross-column entry). spec/screens.md:399 documents this as shipped, so spec and code currently disagree. Another session is currently doing test-related work in this area (My Work) -- do not start until that lands, then first re-check whether this gap was already closed as a side effect before implementing anything new.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dragging a card to a new position within the Today column persists the new order via today_position
- [x] #2 A test covers within-Today-column reordering (drag to a new index, reload, order persists)
- [x] #3 If re-verification after the other session's work shows this is already fixed, this task is closed noting where/how it was resolved instead
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause confirmed exactly as reported: resolveDragEndTarget returns null for any same-container drop (correct for Todo/Done/free columns, which have no order of their own), so a within-Today drag never called the server — nextTodayPosition only ever ran on cross-column ENTRY into Today, never on a same-column reorder.

Fix: new pure isTodayReorder(start, over) in lib/utils/my-work.ts (true only for today->today), new server action reorderMyWorkToday(orderedStoryIds) in app/my-work/actions.ts (dense 0-based today_position rewrite for the full Today list, mirroring TASK-135's full-redensify precedent; only today_position is named in the upsert payload so column_id/today_date stay untouched on existing rows). my-work-sections.tsx's handleDragEnd now branches on isTodayReorder BEFORE the cross-column path, reusing reorderContainer (dnd-kit arrayMove, same helper the project board's own Kanban reorder uses) and the SAME runDrop/MutationErrorBanner optimistic-revert machinery every other My Work drag already uses — no new interaction pattern.

fable-advisor: approve. Confirmed (1) runDrop's restoreItemPosition already reverts just the dragged card to its pre-drag INDEX within Today on failure (no whole-column revert), matching every other drag's failure semantics; (2) no silent-success/failure risk — today_position is read directly by classifyMyWork's Today sort, so a successful write always reflects in the displayed order; (3) Today reuses the exact same SortableContext/SortableItem/verticalListSortingStrategy as the project board's own Kanban column reorder, so no missing drop-indicator/handle affordance — nothing My-Work-specific needed.

Tests: isTodayReorder unit tests (routing: today/today true, any other same-container false, cross-container false, null-either-side false) + reorderMyWorkToday action tests (dense position write, column_id/today_date left unnamed/untouched, empty-list no-op, error surfacing). tsc + lint clean; full suite 630/630 (69 files, 31 skipped=integration). No DB/migration change (today_position column already existed from TASK-138), so no rls-security-reviewer needed. doc-16 walkthrough step A3 is the manual acceptance test — left for the owner to run per doc-16's own convention (agent sessions link it, don't re-derive it).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed: Today's manual drag-reordering (doc-15 decision 4) never actually persisted — resolveDragEndTarget's same-container null short-circuit correctly blocked Todo/Done/free-column reorders (which have no order of their own) but ALSO silently blocked Today's, which does. New isTodayReorder(start,over) routes a today->today drop to a new reorderMyWorkToday server action (dense 0-based today_position rewrite, column_id/today_date left untouched), reusing the existing reorderContainer/runDrop/MutationErrorBanner machinery — no new interaction pattern. fable-advisor: approve (existing revert-on-failure, no-silent-write-risk, and drag affordance are all already correct/shared with the board's own Kanban reorder). Verified: new unit tests for both new functions, tsc+lint clean, full suite 630/630. No migration involved. Manual acceptance is doc-16 walkthrough step A3, left for the owner per that doc's own convention.
<!-- SECTION:FINAL_SUMMARY:END -->
