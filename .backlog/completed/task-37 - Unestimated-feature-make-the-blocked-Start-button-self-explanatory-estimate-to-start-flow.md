---
id: TASK-37
title: >-
  Unestimated feature: make the blocked Start button self-explanatory
  (estimate-to-start flow)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:18'
updated_date: '2026-07-11 17:26'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: adding a feature story to the current iteration shows a warning triangle and a disabled Start button with no explanation of what to do — user is stuck. Root cause: spec/features.md forbids starting an unestimated feature; apps/web/components/features/story/transition-buttons.tsx renders Start disabled with only a hover title.

DECIDED (owner, 2026-07-11): implement Pivotal Tracker's original pattern (two-step, no auto-start). Wherever the action buttons render (story detail, list row, card), an unestimated feature shows the project's point-scale buttons (e.g. 0 1 2 3 5 8 13) in place of Start — no disabled button, no warning triangle. Clicking a point estimates the story; the buttons are then replaced by the normal Start button, which the user clicks as a second step. Estimating never auto-starts the story (estimating from the backlog must not start work). Bugs/chores are unaffected (not estimateable, Start as today).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An unestimated feature shows point-scale estimation buttons in place of Start (no disabled Start, no hover-only hint) wherever transition buttons render
- [x] #2 Clicking a point estimates the story and reveals the Start button; the story is NOT auto-started
- [x] #3 Bug/chore stories keep their current immediate Start behavior
- [x] #4 Tests cover estimate-then-start and no-auto-start
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/utils/stories.ts: no new helpers needed — reuse existing isUnestimatedFeature, pointScaleValues, parsePoints.
2. board/actions.ts: add `estimateStory(formData)` server action — fetch story (story_type, points) + project (point_scale, custom_points), guard isUnestimatedFeature, parsePoints against the project's scale, raw UPDATE points only (no state change, no auto-start), revalidate board/project/story paths.
3. transition-buttons.tsx: when isUnestimatedFeature(storyType, points), render the project's point-scale buttons (one <form action={estimateStory}> with a submit button per value) instead of the single blocked Start/Restart button. Drop the TriangleAlert/disabled/title styling entirely (replaced, not disabled). Add `pointScale: number[]` prop.
4. Thread `pointScale: number[]` down to every TransitionButtons render site:
   - story-detail-panel.tsx: pass `detail.pointScale` (already computed).
   - story-list-row.tsx: new prop, pass through.
   - board-list-view.tsx: new prop on BoardListView, ListSection, SortableListRow, BacklogSection, SortableBacklogRow, IceboxColumn, and the DragOverlay's direct StoryListRow.
   - focus-board.tsx: new prop on FocusBoard, passed directly to its two StoryListRow call sites.
   - kanban-board.tsx: new prop on KanbanBoard, passed to BoardListView and FocusBoard.
   - board/page.tsx: select point_scale, custom_points on the project query, compute pointScaleValues(...), pass to KanbanBoard.
5. Update transition-buttons.test.tsx: pass pointScale to every render call; replace the two unestimated-feature tests (disabled Start) with tests asserting the point-scale buttons render instead of Start, and that a bug/chore still gets an immediate enabled Start.
6. Add tests for estimateStory in board/actions.test.ts (guard rejects non-feature/estimated stories, rejects off-scale points, accepts a valid point and does not touch state).
7. Run pnpm vitest for the touched files, then pnpm build/typecheck.
8. fable-advisor design review (per CLAUDE.md UI rule + task notes), then hand off manual verification steps.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified against Pivotal Tracker's official help (story_states, archived 2024): 'Story state action buttons will not appear on estimateable stories that have yet to be estimated - estimation buttons will appear instead.' Tracker never showed a disabled Start button — the collapsed story card showed the point-scale buttons (0/1/2/3...) in the Start button's place; one click estimated the story and the Start button then appeared. Implement that exact pattern: replace the disabled Start + warning triangle with inline estimation buttons (project point scale) on card/row/detail; after estimating, show Start. Note Tracker did NOT auto-start after estimating — estimate first, Start appears as a second click (keep two steps for parity, or offer estimate+start in one popover; confirm with the owner).

Follow spec/ux-principles.md (landed with TASK-46), especially principle 1 (no dead controls) — this task is its defining example. End with a fable-advisor design review before manual verification.

Implemented: estimateStory server action (board/actions.ts) validates isUnestimatedFeature + parsePoints against the project's point scale, updates only points (never state). transition-buttons.tsx replaces the blocked Start/Restart with pointScale.map buttons when isUnestimatedFeature; removed TriangleAlert/disabled styling entirely. pointScale threaded through story-detail-panel, story-list-row, board-list-view (ListSection/BacklogSection/IceboxColumn/SortableListRow/SortableBacklogRow/DragOverlay), focus-board, kanban-board, board/page.tsx (new point_scale/custom_points select). Tests: transition-buttons.test.tsx rewritten for the new picker; 4 new estimateStory tests in board/actions.test.ts. Full pnpm vitest (356 passed) + tsc --noEmit + eslint on touched files all clean.

fable-advisor review: 修正付き承認 (approve with corrections). Applied: (1) aria-label/title 'Estimate: N point(s)' on each estimation button — formatPoints renders 1-3 as bare dots, which is not a valid accessible name on its own; (2) flex-wrap + unified gap-1 on both button groups — fibonacci is 7 buttons and projects.custom_points has no length cap, so the row can overflow the list-row/side-peek slot; (3) estimateStory now no-ops (revalidate, return, no throw) when the story already has points instead of throwing — an already-estimated story reaching this action is a benign race (another tab/user estimated first, or a resubmit after the first click landed), not a user error, so it must not surface as a Next.js error boundary (spec/ux-principles.md principle 2). Only a non-'feature' story_type is still a hard error now. Tests updated to match (16 tests across the two files); full suite still green (356 passed), tsc/eslint clean.

NOT applied — flagged as scope question, not silently implemented: advisor also wants points-scale validation moved from this TS-only guard into a new estimate_story Postgres RPC (mirroring update_story's server-side check), for parity with the update_story RPC pattern. That's a new migration, which is scope beyond this task's ACs and a DB change — needs your call: fold into TASK-37 now, or file as a follow-up task? Note transitionStory's existing state-guard has the same TS-only-validation shape already, so this isn't a regression this task introduces, just an existing pattern this task continued.

Scope decision (owner): DB側RPC化は今回見送り。transitionStoryも含めた検証の統一が必要になった時点で別タスクとして起票する。TASK-37はこのままクローズ。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Unestimated feature stories (unstarted/rejected) now show the project's point-scale buttons in place of the blocked Start/Restart button, matching Pivotal Tracker's original two-step estimate-then-start pattern (no auto-start). New estimateStory server action (board/actions.ts) validates the story is a feature and the point is on the project's scale, sets only points, and no-ops (no error) if the story was already estimated by a race. pointScale threaded through every TransitionButtons render site (story detail panel, list row, board card side-peek, focus board). fable-advisor design review (approve with corrections) resulted in added aria-label/title on estimation buttons, flex-wrap for long/custom point scales, and the no-op-on-race fix above. Verified: full pnpm vitest (356 passed), tsc --noEmit, eslint on touched files all clean. DB-side (RPC) validation of the point scale was flagged by the advisor as a nice-to-have parity improvement with update_story; owner decided to skip it for this task (transitionStory already has the same TS-only-validation shape) — file separately if it becomes a real need.
<!-- SECTION:FINAL_SUMMARY:END -->
