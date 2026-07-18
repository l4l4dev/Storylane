---
id: TASK-80
title: >-
  Story rows overflow at 360px: collapse estimate scale into a Popover, demote
  trailing controls
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 01:57'
labels:
  - web
  - ux
dependencies:
  - TASK-79
priority: low
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two merged findings. (a) UX panel Medium #26 (doc-7, Wroblewski): an unestimated feature renders the entire point scale inline via TransitionButtons, overflowing the row on phones — put the estimate buttons behind a single 'Estimate' trigger using the existing Popover (board-filters precedent). (b) Codex adversarial review 2026-07-18 of feat/ux-panel-high-fixes: even after TASK-79's responsive demotion, state/assignee/actions remain shrink-0 while the title holds min-w-[7rem], so worst-case rows exceed the ~312px content area at 360px with no horizontal overflow handling (story-list-row.tsx:59-115). Fix both together; verify with a 360px layout regression test asserting scrollWidth <= clientWidth for a long-title unestimated feature row.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Unestimated feature at 360px shows a single Estimate trigger; point buttons open in a Popover
- [ ] #2 Worst-case story row (long title, all chips, transition controls) fits 360px without clipping or page-level horizontal scroll, asserted by a regression test
- [ ] #3 pnpm test passes
<!-- AC:END -->
