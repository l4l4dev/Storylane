---
id: TASK-10
title: Manual iteration finish and auto-finish visibility
status: To Do
assignee: []
created_date: '2026-07-07 14:26'
updated_date: '2026-07-08 12:37'
labels:
  - web
dependencies:
  - TASK-9
  - TASK-18
references:
  - spec/velocity.md
  - spec/screens.md
priority: high
ordinal: 4000
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
- [ ] #6 Finalization RPC is advisory-locked per project and idempotent (state<>'done' guard + UNIQUE(project_id,number)); concurrent Finish/rollover cannot double-finalize or double-create the next iteration — see spec/velocity.md 'Finalization concurrency'
- [ ] #7 Manual finish sets end_date = LEAST(end_date, today); lazy rollover fires for any member including viewers, manual finish requires owner/member (checked inside the SECURITY DEFINER RPC)
- [ ] #8 DB trigger rejects setting stories.iteration_id to a done iteration; a test covers a drop racing a finalization
<!-- AC:END -->
