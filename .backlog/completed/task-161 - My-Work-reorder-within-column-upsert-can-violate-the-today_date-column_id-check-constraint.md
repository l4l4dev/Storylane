---
id: TASK-161
title: >-
  My Work: reorder-within-column upsert can violate the today_date/column_id
  check constraint
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 16:49'
updated_date: '2026-07-22 17:08'
labels:
  - bug
  - my-work
milestone: m-5
dependencies: []
priority: medium
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dragging a card to reorder it WITHIN Today or a free column calls reorderMyWorkToday/reorderMyWorkColumn, which upserted only today_position/column_position. If the story's my_work_story_state row doesn't exist yet (e.g. it just landed in that column via a still-in-flight setMyWorkColumn write — runDrop doesn't block a new drag on the previous one's server round trip), the upsert INSERTs a row with the position set but the paired date/column_id left null, violating my_work_story_state_today_position_needs_date / _column_position_needs_column and surfacing as a raw Postgres error to the user. Reported by the owner: moving a just-added task in My Work threw this error and felt unreliable in general.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 reorderMyWorkToday's upsert payload always includes today_date alongside today_position
- [x] #2 reorderMyWorkColumn's upsert payload always includes column_id alongside column_position
- [x] #3 Reordering a card immediately after it's dropped into Today or a free column (before the drop's own write settles) no longer raises a check-constraint error
- [x] #4 Existing unit tests updated to assert the new payload shape; vitest suite passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: reorderMyWorkToday/reorderMyWorkColumn's upsert named only the position column. Fixed by threading clientToday into reorderMyWorkToday and columnId into reorderMyWorkColumn, so every upserted row carries its required paired field regardless of whether the row pre-existed.

Code landed already: the fix was made directly in the shared main working tree while another concurrent session was mid-flight on TASK-155; that session's own commit (f1585de, 'feat: My Work Done log reads as history + configurable archive') ended up including these exact changes to actions.ts/actions.test.ts/my-work-sections.tsx as part of its working-tree snapshot. Verified identical: no diff between this task's isolated branch (fix/my-work-reorder-check-constraint, commit 6ae5911) and main@f1585de for the three source files. Filing this task standalone (not squashed into a duplicate commit) purely for traceability of the bug/root-cause/fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed by passing clientToday to reorderMyWorkToday and the target columnId to reorderMyWorkColumn, so both are named in the upsert payload alongside their position field, closing the race with an in-flight setMyWorkColumn write for a card new to that column. Verified with vitest (apps/web: actions.test.ts, my-work-sections.test.tsx, my-work.test.ts, 92 tests) and eslint on the touched files.
<!-- SECTION:FINAL_SUMMARY:END -->
