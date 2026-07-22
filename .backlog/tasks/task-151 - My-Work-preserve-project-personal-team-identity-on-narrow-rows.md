---
id: TASK-151
title: 'My Work: preserve project & personal/team identity on narrow rows'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:33'
labels: []
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: medium
type: bug
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 High-impact findings #2, #3. Below the sm breakpoint a cross-project row collapses to an unlabeled color stripe -- the project chip and points are hidden entirely, losing identity, not just density (6 experts). Separately, the personal-vs-team category -- which governs whether a drag can complete the card in Done -- has no visible signifier on the card at any width; the two behavior classes look identical.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A compact project identifier (initials/code or accessible name) remains visible at all widths, not just chip/points
- [ ] #2 Personal-project rows carry a persistent, labeled signifier distinguishing them from team-story rows
<!-- AC:END -->
