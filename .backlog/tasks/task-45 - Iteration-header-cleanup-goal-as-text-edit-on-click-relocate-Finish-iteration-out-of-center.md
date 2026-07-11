---
id: TASK-45
title: >-
  Iteration header cleanup: goal as text (edit on click), relocate Finish
  iteration out of center
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:20'
updated_date: '2026-07-11 06:37'
labels:
  - web
  - ux
dependencies: []
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11, current iteration header (kanban-board.tsx and List view header):
1. The iteration goal saves fine but keeps looking like a text field after save — render the saved goal as plain text (with a subtle edit affordance) and switch to an input only on click; empty state shows 'Add goal…' ghost text.
2. Finish iteration sits at the horizontal center of the screen and is easy to hit by accident even with the confirm dialog — move it to the header's right edge (or into an overflow '…' menu) away from primary actions.
3. General layout: the screen is minimal but key information is cramped; give iteration number, date range, points, and goal deliberate spacing/hierarchy in the header.
Present before/after to the owner for approval before merging (design change).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Saved goal renders as text, not a live input; clicking it enters edit mode
- [ ] #2 Finish iteration is no longer centered; accidental-press risk visibly reduced
- [ ] #3 Header shows iteration number, dates, points, goal with clear hierarchy
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principles 5 (saved values render as values) and 6 (irreversible actions out of the primary click path). End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
