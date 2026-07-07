---
id: TASK-16.3
title: 'Free mode: swimlanes'
status: To Do
assignee: []
created_date: '2026-07-07 14:28'
labels:
  - web
  - db
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
- [ ] #1 Migration adds swimlanes and stories.swimlane_id with composite FK and RLS; rls-security-reviewer has reviewed it
- [ ] #2 Board renders lanes × columns with a No-lane band when lanes exist; unchanged single-band board when none
- [ ] #3 Dragging a card across bands sets swimlane_id; within-band drags keep existing column/reorder behavior
- [ ] #4 Lanes are created/renamed/reordered/deleted in Settings; delete with stories shows the move-off message
- [ ] #5 Tests cover lane rendering, cross-band drag, and delete blocking
<!-- AC:END -->
