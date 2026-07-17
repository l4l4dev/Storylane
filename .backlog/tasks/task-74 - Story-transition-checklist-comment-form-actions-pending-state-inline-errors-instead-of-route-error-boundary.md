---
id: TASK-74
title: >-
  Story transition/checklist/comment form actions: pending state + inline errors
  instead of route error boundary
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 13:15'
updated_date: '2026-07-17 14:06'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor UX review 2026-07-17 (should-fix before deploy). transition-buttons.tsx:47,71 renders Start/Finish/Deliver/Accept/Reject/estimate as bare <form action> with no pending state and no error handling — a double-click double-submits (the second call now rejects at the transition_story RPC) and any failure, including the everyday race where another user transitioned first, throws into projects/[id]/error.tsx and replaces the whole board with 'Something went wrong loading this view.' Same pattern in task-checklist.tsx, comment-thread.tsx, and the epic delete form (the latter handled in TASK-72). Convert to useTransition + try/catch: disable while pending, surface failures inline or via the shared MutationErrorBanner (the TASK-22 pattern RowInsertMenu uses), never the route boundary.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Transition buttons disable while pending; a rejected transition (e.g. concurrent state change) shows an inline/banner error and the board stays interactive
- [x] #2 task-checklist and comment-thread submissions get the same pending + inline-error treatment
- [ ] #3 Tests cover double-click and server-rejection paths
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
transition-buttons.tsx, task-checklist.tsx, comment-thread.tsx converted from bare <form action={serverAction}> to onClick/onSubmit handlers that build FormData locally and call the server action inside useTransition + try/catch (same shape as TASK-72's epic delete and the pre-existing free-board drag/settings pattern). Each control tracks its own pendingKey so only the clicked button disables, not the whole row/list; failures render inline via a role="alert" paragraph instead of the route error boundary. comment-thread.tsx's textarea and task-checklist.tsx's add-input became controlled so a failed submit keeps the typed draft (previously relied on the uncontrolled field never getting reset by a throwing action, not a guarantee).

No change needed to the actions themselves (transitionStory/estimateStory/addTask/toggleTask/deleteTask/addComment) — they already throw Error on failure and revalidatePath on success; the fix is entirely that callers now catch instead of leaking the throw into the route boundary.

Tests: added double-click (asserts the mocked action is called exactly once and the clicked control disables) and server-rejection (asserts the error renders inline via role="alert" and the control re-enables, board stays interactive) cases to transition-buttons.test.tsx (+4), task-checklist.test.tsx (+4), comment-thread.test.tsx (+3). All pre-existing tests in these files plus downstream renderers (story-detail-panel, story-list-row, board-list-view) still pass unmodified. 42/42 relevant tests pass; tsc --noEmit and eslint clean.

fable-advisor design review (2026-07-17, post-implementation): approve-with-fixes. Required fix applied: transition-buttons.tsx disabled the whole group only via isPending && pendingKey===key (per-button), which left concurrent Accept+Reject clickable during another transition's flight -- a real risk since transition_story has no FOR UPDATE lock yet (TASK-48 AC#5, reproduced lost-update). Changed both branches (estimate/transition) to disabled={isPending} (whole group), kept pendingKey to label which specific button is in flight ("Accept…"). task-checklist.tsx/comment-thread.tsx were confirmed fine as-is -- each row's mutation is independent, no shared-resource race.

Also fixed 3 tests that assumed React's useTransition isPending flips false in the same microtask as an explicit setState (error) -- true under light load, not guaranteed under the scheduler contention a full-suite run introduces. Replaced act()+Promise.resolve() flushes with waitFor() polling; confirmed stable across 3 consecutive full-suite runs (413/413) after the fix, where it had flaked once before.

Advisor also flagged (non-blocking, tracked separately): production Server Actions mask thrown Error messages behind a generic message + digest (Next.js default), so the try/catch here only recovers the real message in dev. deleteEpic (TASK-72) already uses the correct result-object pattern; the rest of board/actions.ts and stories/[id]/actions.ts still throw. Not fixed in this batch -- see task comment.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: fable-advisor via @claude-sonnet-5
created: 2026-07-17 14:06
---
fable-advisor follow-up recommendation (not applied in this batch, needs owner decision): in production, Next.js Server Actions mask thrown Error messages behind a generic message + digest -- so the try/catch pattern this task introduced only surfaces the real failure reason in dev, not prod. deleteEpic (TASK-72) already avoids this by returning a {ok:true}/{ok:false,message} result object instead of throwing; transitionStory/estimateStory/addTask/toggleTask/deleteTask/addComment (and the pre-existing free-board/quick-add mutations) still throw. Advisor suggests a follow-up task to convert the remaining throw-based server actions to the result-object pattern, assignee @claude-sonnet-5, placed before TASK-3 (deploy). Not created yet -- asking the owner first per the "no follow-up tasks without approval" rule.
---
<!-- COMMENTS:END -->
