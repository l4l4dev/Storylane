---
id: TASK-22
title: >-
  Fix: board mutations fired as void, so server-side failures leave UI silently
  diverged
status: To Do
assignee: []
created_date: '2026-07-08 05:30'
labels:
  - web
  - bug
dependencies: []
priority: high
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code review 2026-07-08. All drag/quick-add callers invoke server actions as void action(formData) inside startTransition (board-list-view.tsx:582, kanban-columns-board.tsx:289, free-board.tsx:132, quick-add-composer.tsx:54). Server-side throws — evaluateDrop rejection, 'No active iteration', 'Cannot move a story into a finalized iteration', DB errors — become unhandled promise rejections: no snap-back, no revalidation, no user feedback. Scenario: user A's board is stale (B already accepted story X); A drags X and the server re-derives from=accepted and throws; A's card stays in the wrong column with zero feedback until a full navigation. Quick-add is worse: quick-add-composer.tsx clears the input (setTitle('')) BEFORE void quickCreateStory(...), so if creation throws the typed title is lost and no story exists. Separately, persistBacklogOrder/carry-move/dropStoryFree do Promise.all over Supabase builders and never check the per-row { error } results (actions.ts:435, 654, 231, 309) — a failed/RLS-filtered UPDATE yields a partial renumber that 'succeeds' and revalidates; in ensureCurrentIteration a swallowed carry-move error means an unaccepted story is not carried and vanishes (its old iteration is now done and filtered out at page.tsx:95).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A rejected/failed board mutation restores the pre-drag UI (snap-back or revalidate) and surfaces an error to the user
- [ ] #2 Quick-add preserves the typed title until the create succeeds; on failure the composer keeps the text and shows an error
- [ ] #3 persistBacklogOrder and the carry-move loop check every write's error and fail loudly (or transactionally) instead of partial-renumbering
- [ ] #4 Tests cover a stale-board rejected drag, a failed quick-add, and a failed carry-move during rollover
<!-- AC:END -->
