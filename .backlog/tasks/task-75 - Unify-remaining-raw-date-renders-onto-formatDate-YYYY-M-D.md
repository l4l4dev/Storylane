---
id: TASK-75
title: Unify remaining raw date renders onto formatDate (YYYY/M/D)
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-17 13:15'
labels:
  - web
  - ux
  - copy
milestone: m-0
dependencies: []
priority: low
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor UX review 2026-07-17: TASK-39 introduced the shared formatter but four spots still render raw YYYY-MM-DD, so both formats coexist on the same board: kanban-board.tsx:152,158 (iteration bar start–end), board-list-view.tsx:374 (virtual-group projected dates), iterations/page.tsx:110, lib/utils/focus.ts:117 (Focus Done-group past-date label falls back to the raw dateKey). Route each through formatDate(). Mechanical change; follow existing formatDate call sites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No user-visible date renders as YYYY-MM-DD in board, iterations, or focus views (grep for toISOString/slice-style date rendering in those files comes back clean)
- [ ] #2 Existing date-related tests updated/passing
<!-- AC:END -->
