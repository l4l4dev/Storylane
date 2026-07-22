---
id: TASK-145
title: >-
  TASK-140 follow-up: Today column manual reordering is unimplemented despite
  Done
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 11:14'
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
- [ ] #1 Dragging a card to a new position within the Today column persists the new order via today_position
- [ ] #2 A test covers within-Today-column reordering (drag to a new index, reload, order persists)
- [ ] #3 If re-verification after the other session's work shows this is already fixed, this task is closed noting where/how it was resolved instead
<!-- AC:END -->
