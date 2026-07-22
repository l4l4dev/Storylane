---
id: TASK-159
title: 'My Work: gate debug source link to non-production'
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
ordinal: 840
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Medium finding #15. A debug link sits in the primary title row beside the <h1>. Owner decision 2026-07-22: it's fine as-is as long as it does not render in production -- gate it behind a non-production check rather than redesigning its placement or wording.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The debug link does not render when the app is running in production
<!-- AC:END -->
