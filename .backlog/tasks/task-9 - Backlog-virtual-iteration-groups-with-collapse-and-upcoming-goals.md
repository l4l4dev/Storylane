---
id: TASK-9
title: Backlog virtual-iteration groups with collapse and upcoming goals
status: To Do
assignee: []
created_date: '2026-07-07 14:25'
labels:
  - web
  - db
dependencies: []
references:
  - spec/screens.md
  - spec/velocity.md
  - spec/data-model.md
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the boundary-marker rendering in the List view Backlog with collapsible numbered groups per spec/screens.md 'Backlog groups' and spec/velocity.md 'Virtual-group computation'. Fixes the 'where did Iteration #2 go' confusion: every group renders under its own header (triangle, Iteration #N, projected dates, inline goal, point sum), starting at current+1. Upcoming goals live in the new iteration_goals table (spec/data-model.md) and are adopted into the real iteration row on rollover. Also: note/divider labels flush left, story rows slightly indented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration adds iteration_goals (PK project_id+number) with RLS; rls-security-reviewer has reviewed it; adoption on rollover implemented in the shared finalization path
- [ ] #2 Each virtual iteration renders as a group with header: collapse triangle, Iteration #N, projected dates, inline-editable goal (Enter commits, Esc reverts), point sum; first group is numbered current+1
- [ ] #3 Current iteration section header is collapsible too; collapse state persists per user in localStorage
- [ ] #4 Manual iteration break still closes a group at its spot and stays draggable/deletable; numbering shows no gaps
- [ ] #5 Divider/note labels start flush at the left edge; story rows are indented slightly
- [ ] #6 buildBacklogRows unit tests updated for group headers and numbering
<!-- AC:END -->
