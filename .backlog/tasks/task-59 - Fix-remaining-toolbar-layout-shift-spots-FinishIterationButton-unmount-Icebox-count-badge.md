---
id: TASK-59
title: >-
  Fix remaining toolbar layout-shift spots: FinishIterationButton unmount,
  Icebox count badge
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-12 09:27'
updated_date: '2026-07-15 23:54'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: low
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-35 fixed the Icebox toggle's own view-switch layout shift (fable-advisor review). Two related, lower-frequency principle-3 violations in the same toolbar row were flagged as out of scope for that fix and deferred here: (1) FinishIterationButton (kanban-board.tsx) returns null entirely when !visible, so IterationGoalBar shifts left/right whenever canFinishIteration flips (rare — only on a server-recomputed role change, not a view switch); (2) the Icebox toggle's own story-count badge ({iceboxStories.length > 0 && <span>...}) appears/disappears as the Icebox crosses the 0/1 boundary, nudging the view switcher by a few pixels. Apply the same always-mounted/reserve-space pattern TASK-35 established (kanban-board.tsx, invisible/aria-hidden rather than unmounting) to both.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FinishIterationButton reserves its layout space (or an equivalent fix) so canFinishIteration flipping never shifts IterationGoalBar
- [ ] #2 The Icebox toggle's count badge crossing 0/1 stories never shifts the view switcher's position
- [ ] #3 Tests cover both, following kanban-board-toolbar.test.tsx's pattern
<!-- AC:END -->
