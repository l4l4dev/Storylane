---
id: TASK-20
title: 'Fix: reordering while filters are active corrupts hidden stories'' positions'
status: To Do
assignee: []
created_date: '2026-07-08 05:29'
labels:
  - web
  - bug
dependencies: []
priority: high
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08. board/page.tsx applies filterStories BEFORE bucketing into containers (page.tsx:121), so drag handlers send ordered_ids containing only the visible subset; reorderPositions/persistBacklogOrder (actions.ts:309/435) then write those ids as a dense 0..n-1 sequence for the whole zone. Hidden stories keep stale positions that collide with the new ones, so their relative order scrambles nondeterministically on next load. In List view dividers are interleaved, so hidden stories also jump across notes/iteration breaks. Related display bug, same root: buildBacklogRows and the iteration bar's committed-points sum are computed on the filtered set (board-list-view.tsx:391/609, kanban-board.tsx:95), so virtual-iteration boundaries, point sums, and projected dates change whenever a filter is applied — spec/velocity.md's capacity walk is defined over the full backlog; filters should only hide rows visually.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reordering with an active filter preserves hidden rows' relative positions (merge visible-order changes into the full zone order server-side or client-side before persisting)
- [ ] #2 No two rows in a zone end up with the same position after any filtered drag (test with a hidden row between two visible ones)
- [ ] #3 Virtual-iteration groups, their point sums/dates, and the iteration bar's committed points are computed from the unfiltered sets; filters only hide rows
- [ ] #4 Tests cover filtered reorder in Kanban and List (with a divider adjacent to a hidden story) and filtered marker computation
<!-- AC:END -->
