---
id: TASK-160
title: >-
  My Work: small copy fixes (carry-over grammar, done-color token,
  unknown-project wording)
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-22 13:40'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-5
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: low
type: chore
ordinal: 860
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Low findings #35, #23 (numbered Medium in the doc but a mechanical one-line fix), and #40 -- three unrelated but trivially small copy/token fixes bundled together: (1) subject-verb disagreement in the carry-over prompt ('1 item were marked...'); (2) the Done completion marker uses a raw Tailwind green class instead of a semantic color token; (3) the 'Unknown project' fallback for a project the viewer has left reads as an error rather than an expected state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The carry-over prompt's grammar is correct for both singular and plural counts
- [ ] #2 The Done completion marker's color comes from a semantic token, not a raw Tailwind color class
- [ ] #3 The fallback label for a project the viewer no longer belongs to reads as an expected state, not an error
<!-- AC:END -->
