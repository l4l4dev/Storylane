---
id: TASK-44
title: 'Free mode: add and edit columns directly on the board'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:20'
updated_date: '2026-07-11 06:37'
labels:
  - web
  - ux
  - feature
dependencies: []
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: free-mode Board statuses can only be created one by one in Settings. Bring column management onto the board itself (apps/web/components/features/board/free-board.tsx): an '+ Add column' affordance at the right end of the board (inline name input, default color, appended last), inline rename on the column header, and access to color/is_done/delete via a small column menu (can reuse the Settings form logic in a popover). Keep Settings as the full editor; the board affordances are shortcuts to the same server actions — no new write paths.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A column can be created from the board without visiting Settings
- [ ] #2 A column can be renamed inline from its header
- [ ] #3 Column menu exposes color, done-column flag, and delete (existing rules for is_done/deletion still enforced)
- [ ] #4 Tests cover add and rename from the board
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principles 4 (create destination visible) and 5 (saved values render as values). End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
