---
id: TASK-21
title: >-
  Fix: List view current zone renders state-bucket order and persists it on
  first drag
status: To Do
assignee: []
created_date: '2026-07-08 05:30'
labels:
  - web
  - bug
dependencies: []
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08. toListItemContainers (board-list-view.tsx:63) builds the current zone as STATE_COLUMNS.flatMap(...) — unstarted, then started, then finished, etc. — instead of the flat priority (position) order that spec/screens.md 'List view' requires ('every state ... in one flat, priority-ordered list'). Display bug: a started story at position 0 renders below an unstarted story at position 1. Data bug: after any single drag inside the current zone, dropStoryInList persists the displayed (state-bucketed) order as dense positions for ALL current-zone rows, silently rewriting priorities the user never touched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Current zone renders in position order regardless of state (matching spec/screens.md List view)
- [ ] #2 A drag inside the current zone only persists an order consistent with what was displayed, and the display was position-ordered — no untouched rows change relative priority
- [ ] #3 Test covers mixed-state current-zone ordering and a reorder that must not reshuffle other rows
<!-- AC:END -->
