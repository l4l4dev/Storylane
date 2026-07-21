---
id: TASK-113
title: >-
  Board drag concurrency hardening — failure rollback scope + realtime-vs-drag
  clobber
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 findings #4 and #5, both in the same board drag/realtime interaction. (1) kanban-columns-board.tsx:511 / board-list-view.tsx:1284: a rejected drag's catch handler reverts to the last server-confirmed snapshot (synced), not just this drag — a second, unrelated already-accepted drag can be visually undone until the next refresh. (2) kanban-columns-board.tsx:415 / board-list-view.tsx:1188: containers resync whenever initialContainers changes reference — including realtime updates from unrelated concurrent users — even mid-drag (activeId non-null), risking the dragged item's DOM node being pulled out from under dnd-kit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A rejected drag's rollback reverts only the dragged story to its pre-drag position, not the whole board to the last-synced snapshot
- [ ] #2 Realtime-driven container resync is deferred (or merged non-destructively) while a drag is in progress (activeId non-null)
- [ ] #3 Tests cover both kanban-columns-board.tsx and board-list-view.tsx (both are affected)
- [ ] #4 pnpm test + lint green
<!-- AC:END -->
