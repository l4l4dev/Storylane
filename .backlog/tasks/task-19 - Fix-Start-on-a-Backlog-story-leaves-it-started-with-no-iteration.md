---
id: TASK-19
title: 'Fix: Start on a Backlog story leaves it started with no iteration'
status: To Do
assignee: []
created_date: '2026-07-08 05:29'
labels:
  - web
  - bug
dependencies: []
priority: high
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08 (apps/web/app/projects/[id]/board/actions.ts). transitionStory (line 549) writes only { state }, unlike dropStory/dropStoryInList which also set iteration_id = currentIterationId when starting a backlog story. In List view TransitionButtons render on every row including Backlog rows (story-list-row.tsx:93; availableTransitions('unstarted')=['start']), so clicking Start on a Backlog story produces state=started, iteration_id=null. That story then: sits in the Backlog zone with a Started badge (wrong zone via zoneForStory/columnForStory), is never counted in the current iteration's points, is never carried/finalized by ensureCurrentIteration (which keys off iteration_id), and cannot be dragged back (evaluateListDrop to backlog/icebox requires unstarted). It is stuck. Downstream consequence: the Icebox-demotion guard (kanban.ts:173/84) only checks state==='unstarted' for Current-origin drops and lets Backlog-origin drops through unconditionally, so such a started/backlog story can then be dragged into the Icebox, silently resetting in-progress work to unscheduled. Related: fetchBacklogOrder (actions.ts:453) defines the backlog as state='unstarted' AND iteration_id IS NULL, narrower than the board's zone definition, so these stray rows are skipped by divider renumbering (before_item_id findIndex=-1 appends at end, stale positions collide).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Starting a Backlog story assigns it to the current iteration (iteration_id set), matching the drag path; or Start is not offered on Backlog rows — decide and make button/drag paths consistent
- [ ] #2 No path can produce state not in (unstarted, unscheduled) with iteration_id=null in tracker mode
- [ ] #3 evaluateListDrop/evaluateDrop reject demoting a non-unstarted story to the Icebox regardless of origin zone
- [ ] #4 fetchBacklogOrder uses the same backlog-zone definition as zoneForStory/columnForStory
- [ ] #5 Tests cover Start-from-backlog, started-to-icebox drag attempt, and divider insertion above a stray row
<!-- AC:END -->
