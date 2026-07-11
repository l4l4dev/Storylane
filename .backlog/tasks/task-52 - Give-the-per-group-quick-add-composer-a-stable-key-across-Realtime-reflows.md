---
id: TASK-52
title: Give the per-group quick-add composer a stable key across Realtime reflows
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 11:29'
updated_date: '2026-07-11 17:26'
labels:
  - web
  - bug
milestone: m-0
dependencies: []
priority: low
ordinal: 9500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
board-list-view.tsx's per-virtual-iteration-group '+ Add story' composer (TASK-36) is keyed inside the same Fragment as its group's last row. If another user's Realtime-driven change reshuffles which row ends a group, the composer's Fragment unmounts, closing it and discarding whatever the user had typed. Give it a stable key derived from the group number instead, rendered as its own sibling rather than nested in the boundary row's Fragment, so it survives a reflow while open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The open per-group composer (with in-progress typed text) survives a Realtime-driven reorder of its group's rows, as long as the group itself still exists
- [ ] #2 Existing per-group insertion behavior (before_item_id targeting that group's bottom) is unchanged
<!-- AC:END -->
