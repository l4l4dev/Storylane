---
id: TASK-11
title: Quick-add composer revamp (all boards)
status: To Do
assignee: []
created_date: '2026-07-07 14:26'
updated_date: '2026-07-08 12:38'
labels:
  - web
dependencies:
  - TASK-22
references:
  - spec/screens.md
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md 'Quick-add composer': the '+ Add story' trigger must never morph into an input. Clicking reveals a separate card-shaped composer beneath it (title input, 'Enter to add / Esc to close' hint); Enter creates and keeps it open for consecutive adds, Esc or outside click closes, empty Enter does nothing. Applies to List sections, the Kanban Unstarted column, and free-mode columns (quick-add-composer.tsx).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Trigger stays visible and unchanged; composer appears as a separate card below it in all three board contexts
- [ ] #2 Enter adds and keeps the composer open; Esc and outside click close it; empty Enter is a no-op
- [ ] #3 Component tests updated for the new open/add/close behavior
<!-- AC:END -->
