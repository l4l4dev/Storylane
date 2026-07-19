---
id: TASK-19
title: 'Fix: Start on a Backlog story leaves it started with no iteration'
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-08 05:29'
updated_date: '2026-07-08 12:54'
labels:
  - web
  - bug
milestone: m-0
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08 (apps/web/app/projects/[id]/board/actions.ts). transitionStory (line 549) writes only { state }, unlike dropStory/dropStoryInList which also set iteration_id = currentIterationId when starting a backlog story. In List view TransitionButtons render on every row including Backlog rows (story-list-row.tsx:93; availableTransitions('unstarted')=['start']), so clicking Start on a Backlog story produces state=started, iteration_id=null. That story then: sits in the Backlog zone with a Started badge (wrong zone via zoneForStory/columnForStory), is never counted in the current iteration's points, is never carried/finalized by ensureCurrentIteration (which keys off iteration_id), and cannot be dragged back (evaluateListDrop to backlog/icebox requires unstarted). It is stuck. Downstream consequence: the Icebox-demotion guard (kanban.ts:173/84) only checks state==='unstarted' for Current-origin drops and lets Backlog-origin drops through unconditionally, so such a started/backlog story can then be dragged into the Icebox, silently resetting in-progress work to unscheduled. Related: fetchBacklogOrder (actions.ts:453) defines the backlog as state='unstarted' AND iteration_id IS NULL, narrower than the board's zone definition, so these stray rows are skipped by divider renumbering (before_item_id findIndex=-1 appends at end, stale positions collide).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Starting a Backlog story assigns it to the current iteration (iteration_id set), matching the drag path; or Start is not offered on Backlog rows — decide and make button/drag paths consistent
- [x] #2 No path can produce state not in (unstarted, unscheduled) with iteration_id=null in tracker mode
- [x] #3 evaluateListDrop/evaluateDrop reject demoting a non-unstarted story to the Icebox regardless of origin zone
- [x] #4 fetchBacklogOrder uses the same backlog-zone definition as zoneForStory/columnForStory
- [x] #5 Tests cover Start-from-backlog, started-to-icebox drag attempt, and divider insertion above a stray row
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause confirmed by reading the exact cited locations (all matched precisely): transitionStory (board/actions.ts) wrote only state, never iteration_id, unlike dropStory/dropStoryInList. TransitionButtons render on every List-view row including Backlog ones (story-list-row.tsx), so clicking Start on a Backlog story (state unstarted, iteration_id null) produced state=started with iteration_id still null. evaluateDrop/evaluateListDrop (kanban.ts) allowed demoting to the Icebox based on origin column/zone (from === BACKLOG_COLUMN_ID) rather than the storys actual state, so that stuck story could then be dragged to Icebox, silently discarding its started progress. fetchBacklogOrder queried state=unstarted AND iteration_id IS NULL, narrower than zoneForStory/columnForStorys actual backlog definition (not unscheduled AND iteration_id IS NULL), so the stray row was invisible to divider before_item_id lookups (findIndex=-1, new dividers always appended at the end instead of landing where dropped).

Fix: added a pure helper shouldAssignCurrentIteration(nextState, hasIterationId) in story-state.ts; transitionStory now fetches the current iteration id (same query dropStory/dropStoryInList already use) and includes iteration_id in the update whenever starting/restarting a story with none assigned yet. evaluateDrop/evaluateListgetDrops Icebox-demotion branches now check story.state === "unstarted" directly instead of the origin column/zone, so a started-but-backlog-column stray story is correctly rejected regardless of where it visually sits. fetchBacklogOrder now filters neq(state, unscheduled) + is(iteration_id, null), matching zoneForStory exactly (a done-iteration story is still excluded since its iteration_id is non-null, so no new bug introduced there).

AC#2 (DB-level invariant that no state outside unstarted/unscheduled can have iteration_id null) is closed at the app layer only by this task, per the priority-sequencing consult with fable-advisor: the DB-level trigger/constraint is deferred to TASK-10s migration (which already adds a done-iteration guard trigger, the natural place to add this one alongside it) rather than a third migration touching the same invariant space.

Tests: 4 new in story-state.test.ts for shouldAssignCurrentIteration, 2 new in kanban.test.ts (one per evaluateDrop/evaluateListDrop) reproducing the exact stuck-story-to-icebox scenario. Live-verified all three AC#5 scenarios end to end: (1) Start on a Backlog story now sets iteration_id to the current iteration and the card moves into the current-iteration zone with the correct Started badge; (2) a manually-constructed stray row (started, iteration_id null) correctly shows up in the Backlog zone as before (unrelated to this bug, just the pre-existing rendering) but a note inserted immediately before it via the + Note affordance landed in the exact correct position (position 1, between the normal story at 0 and the stray row now at 2) instead of appending after everything.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed three drift points around the "story stuck started with no iteration" bug: transitionStory now assigns the current iteration when starting/restarting a story that has none (matching the drag path), the Icebox-demotion guards in evaluateDrop/evaluateListDrop check the storys actual state instead of trusting its origin column/zone, and fetchBacklogOrder now matches zoneForStorys real backlog definition so a stray row is no longer invisible to divider position lookups. DB-level enforcement of the underlying invariant is deferred to TASK-10s migration per the priority-sequencing consult. Verified with tsc, eslint, vitest (213 passing, 6 new), and a live walkthrough of all three AC#5 scenarios (start-from-backlog, icebox-demotion rejection, divider insertion above a stray row).
<!-- SECTION:FINAL_SUMMARY:END -->
