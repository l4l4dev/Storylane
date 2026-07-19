---
id: TASK-21
title: >-
  Fix: List view current zone renders state-bucket order and persists it on
  first drag
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-08 05:30'
updated_date: '2026-07-08 08:41'
labels:
  - web
  - bug
milestone: m-0
dependencies: []
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08. toListItemContainers (board-list-view.tsx:63) builds the current zone as STATE_COLUMNS.flatMap(...) — unstarted, then started, then finished, etc. — instead of the flat priority (position) order that spec/screens.md 'List view' requires ('every state ... in one flat, priority-ordered list'). Display bug: a started story at position 0 renders below an unstarted story at position 1. Data bug: after any single drag inside the current zone, dropStoryInList persists the displayed (state-bucketed) order as dense positions for ALL current-zone rows, silently rewriting priorities the user never touched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Current zone renders in position order regardless of state (matching spec/screens.md List view)
- [x] #2 A drag inside the current zone only persists an order consistent with what was displayed, and the display was position-ordered — no untouched rows change relative priority
- [x] #3 Test covers mixed-state current-zone ordering and a reorder that must not reshuffle other rows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: board-list-view.tsx's toListItemContainers built the List view's 'current' zone via STATE_COLUMNS.flatMap(...) — concatenating per-state buckets (each internally position-ordered) in board-column order, losing cross-state priority. Added position to BoardStory (kanban-board.tsx) and to the card mapping in board/page.tsx, and a new pure helper flattenCurrentZone (lib/utils/kanban.ts) that merges the state buckets and sorts by position — this is what toListItemContainers now uses. Persist logic (dropStoryInList -> persistBacklogOrder) was already correct once fed the right displayed order, so AC#2 needed no server-side change. Added 3 unit tests (mixed-state ordering, empty, single-item reorder leaves others' relative order intact). Verified live: inserted a started story at position 0 and an unstarted story at position 1 into the current iteration — board now shows started-story above unstarted-story (previously reversed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the List view's current-zone ordering to be flat priority (position) order instead of state-bucket order, by adding a position field to BoardStory and a new flattenCurrentZone helper. Verified with tsc, eslint, vitest (184 passing incl. 3 new), and a live browser check with mixed-state/position test stories.
<!-- SECTION:FINAL_SUMMARY:END -->
