---
id: TASK-74
title: >-
  Story transition/checklist/comment form actions: pending state + inline errors
  instead of route error boundary
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 13:15'
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
- [ ] #1 Transition buttons disable while pending; a rejected transition (e.g. concurrent state change) shows an inline/banner error and the board stays interactive
- [ ] #2 task-checklist and comment-thread submissions get the same pending + inline-error treatment
- [ ] #3 Tests cover double-click and server-rejection paths
<!-- AC:END -->
