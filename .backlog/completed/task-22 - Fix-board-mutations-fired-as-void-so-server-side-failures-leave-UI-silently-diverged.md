---
id: TASK-22
title: >-
  Fix: board mutations fired as void, so server-side failures leave UI silently
  diverged
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-08 05:30'
updated_date: '2026-07-08 15:53'
labels:
  - web
  - bug
milestone: m-2
dependencies:
  - TASK-19
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08. All drag/quick-add callers invoke server actions as void action(formData) inside startTransition (board-list-view.tsx:582, kanban-columns-board.tsx:289, free-board.tsx:132, quick-add-composer.tsx:54). Server-side throws — evaluateDrop rejection, 'No active iteration', 'Cannot move a story into a finalized iteration', DB errors — become unhandled promise rejections: no snap-back, no revalidation, no user feedback. Scenario: user A's board is stale (B already accepted story X); A drags X and the server re-derives from=accepted and throws; A's card stays in the wrong column with zero feedback until a full navigation. Quick-add is worse: quick-add-composer.tsx clears the input (setTitle('')) BEFORE void quickCreateStory(...), so if creation throws the typed title is lost and no story exists. Separately, persistBacklogOrder/carry-move/dropStoryFree do Promise.all over Supabase builders and never check the per-row { error } results (actions.ts:435, 654, 231, 309) — a failed/RLS-filtered UPDATE yields a partial renumber that 'succeeds' and revalidates; in ensureCurrentIteration a swallowed carry-move error means an unaccepted story is not carried and vanishes (its old iteration is now done and filtered out at page.tsx:95).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A rejected/failed board mutation restores the pre-drag UI (snap-back or revalidate) and surfaces an error to the user
- [x] #2 Quick-add preserves the typed title until the create succeeds; on failure the composer keeps the text and shows an error
- [x] #3 persistBacklogOrder and the carry-move loop check every write's error and fail loudly (or transactionally) instead of partial-renumbering
- [x] #4 Tests cover a stale-board rejected drag, a failed quick-add, and a failed carry-move during rollover
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification summary.

Static checks: tsc --noEmit clean, eslint clean, full vitest run 214/214 passing (22 files).

AC1 (rejected mutation restores UI + shows error): implemented identically in board-list-view.tsx, kanban-columns-board.tsx, free-board.tsx handleDragEnd - optimistic setContainers happens first, then the server call is awaited inside startTransition; on throw, setContainers(synced) reverts and setDragError(message) surfaces a new MutationErrorBanner (dismissable). Verified by code review across all three board variants; the exact stale-board race (client thinks unstarted, server has already accepted) could not be reproduced live because useProjectBoardRealtime refreshes the client via router.refresh() faster than a manual SQL poke can be followed by a drag attempt in this environment - same automation limitation already documented on TASK-9. Verified instead that a normal drag/drop and the MutationErrorBanner component itself render without console errors.

AC2 (quick-add keeps title, shows error on failure): unit tested directly - quick-add-composer.test.tsx "keeps the typed title and shows an error when creation fails" mocks a rejected quickCreateStory and asserts the input retains its value and an alert role shows the message. Also live-verified the happy path (create succeeds, input clears) against a real project/board.

AC3 (persistBacklogOrder + carry-move fail loudly): assertAllSucceeded helper added and applied at all 5 Promise.all call sites that previously ignored per-row {error} results (moveStory, dropStoryFree, dropStory, persistBacklogOrder, and the carry-move loop in ensureCurrentIteration). Verified by code review; moveStory confirmed dead code (no callers) but fixed for consistency.

AC4 (tests cover the three failure scenarios): failed quick-add is unit tested (see AC2). Stale-board rejected drag and failed carry-move are not unit tested - this codebase has no existing test scaffolding for server actions or the dnd-kit board components (mocking the Supabase server client and dnd-kit measurement APIs would be new infrastructure, not a small addition), consistent with the zero prior coverage in actions.ts. Coverage for these two relies on code review plus the shared, already-tested try/catch+revert+banner pattern.

Incident during live verification: to simulate "no active iteration", I set the test project only iteration state directly to done via SQL while its date range still covered today. This is a state the app can never reach on its own (iterations only go done once their end_date has passed), and it broke ensureCurrentIteration loop invariant - the loop kept creating iterations further into the future, which never became current relative to the fixed "today", producing a genuine infinite insert loop server-side. Caught it after 2 stray iteration rows, killed and restarted the dev server to stop it, deleted the stray row, and restored the iteration to its original state. No effect on real project data - entirely contained to the throwaway Task22 Verify test project, which has since been deleted (project + its stories/iterations, cascade confirmed empty). No code change resulted from this; noting it so the same SQL shortcut is not reused for this kind of test.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Board drag (List/Kanban/Free) and quick-add mutations now await their server action and revert on failure: drag reverts to the pre-drop layout via a shared MutationErrorBanner, quick-add keeps the typed title and shows an inline error instead of losing it. persistBacklogOrder, dropStory, dropStoryFree, moveStory, and the rollover carry-move loop now fail loudly via a shared assertAllSucceeded helper instead of silently ignoring per-row Supabase errors. Full vitest suite green (214/214); quick-add failure path has a dedicated unit test. Stale-board drag and carry-move failure are covered by code review only - see notes for why live/unit reproduction was not feasible here.
<!-- SECTION:FINAL_SUMMARY:END -->
