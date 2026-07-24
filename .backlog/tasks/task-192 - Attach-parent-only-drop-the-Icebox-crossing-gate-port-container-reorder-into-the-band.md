---
id: TASK-192
title: >-
  Attach = parent only: drop the Icebox-crossing gate, port container reorder
  into the band
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-24 18:15'
labels:
  - web
  - db
milestone: m-6
dependencies:
  - TASK-189
  - TASK-190
documentation:
  - doc-20
type: feature
ordinal: 1760
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §5 and §7. TASK-187 made attaching a board story to an epic move it into the container's Icebox nest, which contradicts Tracker (dragging a story onto an epic links it and does not move it) and re-creates defect 3: the story leaves the zone the team scheduled it into.

New rule: dropping a story on an epic row writes parent_id and nothing else. The Icebox-crossing gate that existed only to support the old behaviour goes away, and the container-row reorder built in TASK-188 moves from the Icebox block to the Epics band.

doc-20 §7 lists what survives, moves, and is deleted — read it before touching kanban.ts or board-list-view.tsx. Stories already relocated to the Icebox by the retired behaviour are not restored retroactively.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dropping a story on an epic row sets parent_id only; state_id, iteration_id and position are unchanged, proven by an integration test
- [ ] #2 isAllowedEpicNestDrop and the Icebox-crossing attach path are deleted, not left dormant
- [ ] #3 Container-row reordering (CONTAINER_ROWS_ZONE_ID, isDisallowedContainerRowDrop and the collision filter) works inside the Epics band
- [ ] #4 The attach-crosses-into-Icebox assertions in kanban.test.ts and move-story-board.integration.test.ts are replaced by the new contract, not extended alongside it
- [ ] #5 Detaching is available from the row menu and the Parent picker; band child rows stay non-draggable in v1
- [ ] #6 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->
