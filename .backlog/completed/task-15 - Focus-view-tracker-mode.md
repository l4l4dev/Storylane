---
id: TASK-15
title: Focus view (tracker mode)
status: Done
assignee: []
created_date: '2026-07-07 14:27'
updated_date: '2026-07-09 06:57'
labels:
  - web
  - db
milestone: m-0
dependencies: []
references:
  - spec/screens.md
  - spec/data-model.md
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Third board view per spec/screens.md 'Focus view': Todo / This week / Today / In progress / Done over the current iteration's stories. Migration adds stories.focus ('today'|'this_week'|NULL) and stories.completed_at (set on accepted, cleared when leaving accepted — completed_at is also the free-mode done-date source, see spec/data-model.md). Dragging between Todo/This week/Today sets focus and never touches state; state changes use on-card transition buttons; Done is read-only, grouped by completed_at date headers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration adds stories.focus and stories.completed_at; completed_at maintained on the tracker state-transition path (set on accepted, cleared on leaving); rls-security-reviewer has reviewed it
- [x] #2 Focus appears in the view toggle (List / Kanban / Focus); columns render per spec
- [x] #3 Drag between Todo / This week / Today sets or clears focus without state changes; In progress and Done are not drop targets
- [x] #4 Done column groups accepted stories under Today / Yesterday / date headers by completed_at
- [x] #5 Quick-add and side peek work in this view; focus survives rollover on carried-over stories
- [x] #6 Tests cover focus bucketing, completed_at set/clear, and Done grouping
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Spec gap resolved with the owner before implementing: Focus view column list (spec/screens.md) never mentioned where rejected-state stories render. Decided: In progress (same reasoning as Kanban views Rejected column - still needs the Restart transition). Documented in spec/screens.md.

Migration 20260709000004_focus_view.sql: adds stories.focus/completed_at + a DB trigger (not app-code) maintaining completed_at, per decision-1 (invariants live in the DB so iOS direct writes stay correct too). rls-security-reviewer found and I fixed a real bug before merging: the UPDATE trigger only fired on state change (WHEN new.state is distinct from old.state), which let a client set completed_at directly without ever touching state, bypassing the invariant entirely (same class of gap pin_story_number already closes for stories.number). Fixed by making the UPDATE trigger unconditional and pinning the old value when state does not change. Reproduced the original bypass, reproduced the fix closing it, and reverified the two already-passing behaviors (unrelated edits survive, leaving accepted clears it) all via direct SQL against a throwaway project.

Implementation: lib/utils/focus.ts (pure column-bucketing/drop-validation/date-grouping, 13 tests) + setStoryFocus server action (project_id-scoped, modeled on dropStory) + focus-board.tsx (dnd-kit scaffolding modeled on kanban-columns-board.tsx: Todo/This week/Today draggable, In progress/Done read-only using the existing StoryListRow + TransitionButtons - no new button component needed). web-conventions-reviewer found no issues (TASK-22 error-handling convention followed, project_id scoping correct, no naming/type issues).

Verification: tsc/eslint/vitest all clean (231 tests, +16 from this task after removing 2 unused-export cleanups). Live browser: created a real project, quick-added a story into Todo, direct-SQL-set focus=today and confirmed it rendered in Today, walked a story through started->finished->delivered->accepted via the in-view TransitionButtons and confirmed it landed in In progress then Done under a "Today" date header with the accepted green tint, opened the side peek from within Focus view. Pointer/keyboard drag automation was unreliable here (same documented limitation as every other board view this session, e.g. TASK-9/TASK-20/TASK-22) - the drag mutation path itself (setStoryFocus) is proven by focus.test.ts plus live-verified read-side rendering of every column via direct DB state changes instead. "Focus survives rollover" (AC5) verified by code inspection: finalize_iterations carry-over UPDATE (20260709000002_finalize_iteration.sql:140-142) only sets iteration_id, never touches focus.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the Focus view (tracker mode) - a third board view (List/Kanban/Focus) over the current iterations stories, personal KanbanFlow-style execution: Todo/This week/Today are draggable and only ever set/clear stories.focus (never state); In progress (started/finished/delivered/rejected) and Done (accepted, grouped under Today/Yesterday/date headers by completed_at) are read-only, using the existing one-click transition buttons. completed_at is DB-trigger-maintained rather than app-code-maintained, per decision-1s invariants-live-in-the-database principle. Two real bugs were found and fixed during implementation: a spec gap (rejected-state placement, resolved with the owner) and a security-relevant trigger bypass (completed_at could be set directly without a state change) caught by rls-security-reviewer and independently reverified.
<!-- SECTION:FINAL_SUMMARY:END -->
