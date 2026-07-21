---
id: TASK-111
title: Kanban/List position-scope mismatch corrupts List-view story order
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 10800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #2. apps/web/lib/utils/kanban.ts:254 (flattenCurrentZone) sorts merged stories by raw position assuming one shared sequence, but Kanban drags reset position per-state-column while List drags use one project-wide sequence — the two scopes are incompatible, so switching Kanban->List can interleave stories from different columns out of order.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 flattenCurrentZone (or move_story_board) reconciles the two position scopes so switching Kanban->List never interleaves stories from different columns out of column-order
- [ ] #2 A test reproduces doc-13's scenario (reorder within two Kanban columns, then flatten for List) and proves correct grouping
- [ ] #3 kanban.test.ts's flattenCurrentZone test is extended to catch column-local (non-globally-unique) positions, not just the hand-picked globally-unique case
- [ ] #4 pnpm test + lint green
<!-- AC:END -->
