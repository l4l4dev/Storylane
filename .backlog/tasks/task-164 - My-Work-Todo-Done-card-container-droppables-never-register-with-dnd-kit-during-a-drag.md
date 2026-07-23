---
id: TASK-164
title: >-
  My Work: Todo/Done card-container droppables never register with dnd-kit
  during a drag
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 23:56'
labels:
  - bug
  - my-work
milestone: m-5
dependencies:
  - TASK-162
priority: high
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered while verifying TASK-162 live in the browser: even after fixing the card-vs-column-header collision contamination, dragging a card from Today toward Todo (near-center point of Todo's own bounding box, well past any column-header row) still fails silently -- the card stays in Today, no error. Instrumented collisionDetectionByDragKind directly (temporarily, reverted, not committed) and confirmed via console output during a live drag that args.droppableContainers / args.droppableRects NEVER contain the bare 'todo' or 'done' ids at all -- not merely a losing closestCenter candidate, genuinely absent from dnd-kit's own registry for the whole duration of the drag. 'today' and every free column's bare id (registered the same way, via FlatColumn's useDroppable({id})) DO appear reliably. Confirmed this is independent of Todo being empty vs non-empty (added a card to Todo, still absent) and predates this session's work (present already at commit b4514cb, before TASK-155/156). The setTodoRef/setDoneRef ref callbacks DO fire and attach a DOM node (confirmed via a temporary wrapped ref callback) -- so the div is mounted, but dnd-kit doesn't count it as an active droppable during a drag.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root cause identified: why useDroppable({id:'todo'}) / ({id:'done'}) don't appear in DndContext's active-drag droppableContainers/droppableRects, despite FlatColumn's structurally-similar useDroppable({id}) working
- [ ] #2 Dragging any card from Today (or a free column) into Todo succeeds via a real multi-step pointer drag targeting any point within Todo's bounds, not just a specific lucky coordinate
- [ ] #3 Same for Done (verify a personal-project card drag there, since team-card Done entry is gated separately per TASK-154)
- [ ] #4 No regression to Today/free-column drags or to TASK-162's card/column collision fix
<!-- AC:END -->
