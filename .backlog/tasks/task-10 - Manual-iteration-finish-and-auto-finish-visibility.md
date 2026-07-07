---
id: TASK-10
title: Manual iteration finish and auto-finish visibility
status: To Do
assignee: []
created_date: '2026-07-07 14:26'
labels:
  - web
dependencies:
  - TASK-9
references:
  - spec/velocity.md
  - spec/screens.md
priority: high
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/velocity.md 'Manual finish' and spec/screens.md 'Board layout': add a Finish iteration button to the iteration bar (owner/member, confirmation dialog) that truncates end_date to today and runs the same shared finalization path as rollover (velocity, done, next row from tomorrow, iteration_goals adoption, carry-over). The bar always shows 'auto-finishes on <end_date>'. The current iteration goal input commits on Enter with a confirmation flash (Esc reverts) — no Save button.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Finish iteration button in the iteration bar with confirmation; reuses the shared finalization path (no second implementation)
- [ ] #2 Finished-early iteration's end_date is truncated to today; next iteration starts tomorrow with full iteration_length
- [ ] #3 Iteration bar always shows the auto-finish date
- [ ] #4 Goal input commits on Enter with visible confirmation, Esc reverts; Save button removed
- [ ] #5 Tests cover manual finish (velocity finalized, carry-over, goal adoption) and the goal commit UX
<!-- AC:END -->
