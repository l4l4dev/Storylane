---
id: TASK-52
title: Give the per-group quick-add composer a stable key across Realtime reflows
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-11 11:29'
updated_date: '2026-07-18 02:03'
labels:
  - web
  - bug
milestone: m-0
dependencies:
  - TASK-79
priority: low
ordinal: 900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
board-list-view.tsx's per-virtual-iteration-group '+ Add story' composer (TASK-36) is keyed inside the same Fragment as its group's last row. If another user's Realtime-driven change reshuffles which row ends a group, the composer's Fragment unmounts, closing it and discarding whatever the user had typed. Give it a stable key derived from the group number instead, rendered as its own sibling rather than nested in the boundary row's Fragment, so it survives a reflow while open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The open per-group composer (with in-progress typed text) survives a Realtime-driven reorder of its group's rows, as long as the group itself still exists
- [x] #2 Existing per-group insertion behavior (before_item_id targeting that group's bottom) is unchanged
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 01:05
---
Implemented as 621d959 on feat/ux-panel-high-fixes (Codex gpt-5). Composer no longer remounts on Realtime reflow; 2 tests added. Verified: vitest 428 passed / 102 skipped, 0 failures. Pending: review + merge together with TASK-79/61.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Composer moved out of the group-tail Fragment to a stable sibling keyed by virtual iteration number; open state and typed title survive Realtime reflows, beforeItemId recomputed from the latest boundary (621d959, Codex gpt-5). Verified: 2 new tests simulating Realtime rerenders; suite 442 passed / 0 failures.
<!-- SECTION:FINAL_SUMMARY:END -->
