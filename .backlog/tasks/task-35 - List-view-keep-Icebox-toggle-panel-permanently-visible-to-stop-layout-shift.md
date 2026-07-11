---
id: TASK-35
title: 'List view: keep Icebox toggle/panel permanently visible to stop layout shift'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:17'
updated_date: '2026-07-11 17:26'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: switching between List, Kanban and Focus makes the Icebox button appear/disappear, shifting the surrounding layout and making the view switcher hard to use. In the List view the Icebox should always be visible (button and/or section permanently rendered), so nothing jumps when changing views. Check the conditional rendering in apps/web/app/projects/[id]/board/page.tsx and board-list-view.tsx / kanban-board.tsx toolbars.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Switching List <-> Kanban <-> Focus causes no horizontal/vertical shift of the view-switcher controls
- [ ] #2 Icebox is always reachable from the List view without toggling anything first
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principle 3 (conditional UI never shifts layout). End with a fable-advisor design review against that file before manual verification.
<!-- SECTION:NOTES:END -->
