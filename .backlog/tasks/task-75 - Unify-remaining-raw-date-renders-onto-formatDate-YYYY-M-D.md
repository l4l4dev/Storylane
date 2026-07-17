---
id: TASK-75
title: Unify remaining raw date renders onto formatDate (YYYY/M/D)
status: In Progress
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-17 13:15'
updated_date: '2026-07-17 13:54'
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
- [x] #1 No user-visible date renders as YYYY-MM-DD in board, iterations, or focus views (grep for toISOString/slice-style date rendering in those files comes back clean)
- [x] #2 Existing date-related tests updated/passing
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Routed all 4 spots through the shared formatter: kanban-board.tsx:153,159 (iteration bar range + auto-finishes date), board-list-view.tsx:379 (virtual-group projected dates), iterations/page.tsx:111 -- all via lib/utils/format.ts formatDate(), already imported or newly imported per file.

lib/utils/focus.ts:117 (Focus Done-group date label) deliberately does NOT call formatDate(): that module's own header comment states it "never touches Date/Intl itself" to avoid local-timezone drift in tests, and formatDate(dateKey) would parse a date-only "YYYY-MM-DD" as UTC midnight then re-read it through local getters -- a double conversion that can shift the label by a day depending on server/client timezone, which is exactly the class of bug this module was written to avoid. Added a local formatDateKey() doing plain string math (same "YYYY/M/D" output shape as formatDate, no Date object involved), consistent with the file's existing dateKeyMinusOneDay() pattern.

Tests: updated focus.test.ts's raw-date label assertion from "2026-07-07" to "2026/7/7". All other date-adjacent suites (kanban-board, board-list-view) pass unmodified since they only asserted on iteration numbers/points, not date text. tsc --noEmit and eslint clean.
<!-- SECTION:NOTES:END -->
