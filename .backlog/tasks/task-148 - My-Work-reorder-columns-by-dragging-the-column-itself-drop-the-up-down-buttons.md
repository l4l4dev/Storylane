---
id: TASK-148
title: >-
  My Work: reorder columns by dragging the column itself (drop the up/down
  buttons)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 11:22'
labels: []
dependencies: []
priority: medium
type: enhancement
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner feedback 2026-07-22: the dedicated up/down move controls for column display order are hard to use. Replace with the standard kanban pattern - grab the column (header) and drag it horizontally to reorder, like Trello/Linear. Reuse dnd-kit (horizontal SortableContext on columns) rather than a new library; check common implementations for the interaction details (drag handle on the header, drop indicator between columns). CAREFUL: column dragging must coexist with card dragging - separate activation (e.g. header-only drag handle) so grabbing a card never moves a column and vice versa. Keyboard accessibility must not regress when the buttons are removed (dnd-kit keyboard sensor covers sortable).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Columns (fixed Todo/Today/Done and free columns alike) reorder by dragging the column header; the up/down buttons are removed
- [ ] #2 Card drag-and-drop is unaffected (column grab only activates on the header/handle); a drop indicator or equivalent shows the insertion point while dragging
- [ ] #3 Reordering persists via the existing display-order storage; keyboard-based reordering still possible (dnd-kit keyboard sensor)
- [ ] #4 fable-advisor design review against spec/ux-principles.md passes
- [ ] #5 pnpm test + lint green (from apps/web/)
<!-- AC:END -->
