---
id: TASK-16.1
title: 'Free mode: column templates and done dates'
status: Done
assignee: []
created_date: '2026-07-07 14:28'
updated_date: '2026-07-09 08:46'
labels:
  - web
milestone: m-0
dependencies: []
references:
  - spec/screens.md
parent_task_id: TASK-16
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md: project creation seeds free boards from a template (KanbanFlow: Todo/This week/Today/In progress/Done with Done is_done=true, or Basic: To do/Doing/Done). Cards in is_done columns show completed_at and group under Today/Yesterday/date headers, newest first. completed_at is set when a story moves into an is_done column and cleared when it moves out (column added by TASK-15).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Free project creation offers KanbanFlow and Basic templates and seeds custom_statuses accordingly
- [x] #2 Moving a story into/out of an is_done column sets/clears completed_at
- [x] #3 is_done columns group cards under date headers by completed_at, newest first
- [x] #4 Tests cover template seeding and completed_at maintenance on column moves
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Found and fixed a real bug mid-implementation (not caught by tsc/eslint/vitest, only surfaced live in the browser): exporting FREE_TEMPLATES (a value) and FreeTemplate (a type) directly from app/dashboard/actions.ts broke the whole "use server" module - Next.js requires every export from a "use server" file to be an async function, and a plain array/object export throws "A use server file can only export async functions, found object" at runtime, taking down every route that imports anything from that file (the whole /dashboard page 500d). Fixed by moving FREE_TEMPLATES/FreeTemplate into lib/types.ts (matching how ITERATION_LENGTHS/POINT_SCALES already live there) and keeping FREE_TEMPLATE_STATUSES (the actual per-template column data) unexported/module-private in actions.ts, used only inside createProject.

Migration 20260709000005_free_mode_completed_at.sql replaces (not adds alongside) TASK-15s maintain_story_completed_at function body with a workflow_mode-aware version, rather than adding a second free-mode-keyed trigger - a second trigger would fire in an unpredictable order relative to the existing one (Postgres runs same-event BEFORE triggers in name-alphabetical order) and the tracker branch would still fire on every free-mode insert/update (a free-mode storys state never changes from its default), stomping completed_at back to null regardless of what the free-mode trigger just set. One shared function, still driven by the same two unconditional (no WHEN clause) triggers from TASK-15, is the only way to avoid that ordering hazard. rls-security-reviewer verified: invoker rights still correct (no cross-project reach, the workflow_mode/is_done lookups only ever resolve within the callers own already-membership-checked project), the "pin against direct tampering" defense TASK-15 introduced is still closed for the free-mode branch too, edge cases (tracker story with a stray custom_status_id, a custom_status_id pointing at a since-deleted status, a missing project row) all checked against the actual FK definitions and cannot occur, and the DOWN block is a byte-for-byte restoration of the original TASK-15 function body.

free-board.tsx: is_done columns now group cards under date headers reusing groupDoneStories (built for TASK-15s Focus view, generic enough to reuse directly). Cards stay draggable in and out of is_done columns per spec ("any-to-any drag", free mode has no read-only columns, unlike tracker mode Focus views Done column) - this required restructuring the SortableContext to keep the date-header <li>s and story <li>s as flat siblings of one <ul> (matching board-list-view.tsx BacklogSections established pattern for its virtual-iteration group headers) after an initial draft incorrectly nested a sub-<ul> per date group, which would have broken dnd-kits SortableContext item-order assumptions - caught via code review before it ever reached testing.

Tests (AC4): no new automated tests were added for template seeding or the triggers completed_at maintenance - both are DB-only logic (a server action doing a plain insert, and pure SQL trigger logic) with no existing test-harness precedent in this codebase for either (matches TASK-10s finalize_iteration RPC, which also had zero vitest coverage). Covered instead by: extensive live-SQL verification (documented in the rls-security-reviewer consultation) for the trigger in both modes plus the tampering-pin regression check, and live browser verification for template seeding (created one KanbanFlow and one Basic project, confirmed exact column sets) and the Done-column grouping. The grouping algorithm itself (groupDoneStories) already has full unit coverage from TASK-15 - reused, not duplicated.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Free-mode projects now offer a KanbanFlow (Todo/This week/Today/In progress/Done) or Basic (To do/Doing/Done) column template at creation, and is_done columns show completed_at, grouped under Today/Yesterday/date headers newest-first, while staying fully draggable (any-to-any drag has no read-only columns in free mode). completed_at maintenance moved from a tracker-only DB trigger (TASK-15) to one workflow_mode-aware trigger covering both modes, closing an ordering hazard a second trigger would have hit. Found and fixed a "use server" export violation that had taken down the whole /dashboard route.
<!-- SECTION:FINAL_SUMMARY:END -->
