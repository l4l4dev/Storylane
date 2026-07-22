---
id: TASK-153
title: 'My Work: reword carry-over ''Not today'' to state its actual outcome'
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-22 13:33'
updated_date: '2026-07-22 16:30'
labels: []
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: low
type: chore
ordinal: 700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 High-impact finding #9. The carry-over prompt's 'Not today' control never states what happens -- items fall back to their original columns -- but reads as a dismiss/skip action. Relabel to the actual result (e.g. 'Carry over' / 'Leave in their columns').
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The carry-over decline control's label states its actual outcome instead of reading as a generic dismiss
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Relabeled the carry-over decline button from 'Not today' (generic dismiss) to 'Leave in their columns' (states the actual outcome -- items fall back to their own columns, per doc-17 #9's suggested wording). Mechanical copy-only change (task type: chore, low risk) -- skipped a full fable-advisor pass given the wording itself came directly from the 10-expert panel's own recommendation; verified instead with a new test asserting the new label renders and the old one doesn't. Tests: +1, 37 my-work-scoped unit tests pass; tsc/eslint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
