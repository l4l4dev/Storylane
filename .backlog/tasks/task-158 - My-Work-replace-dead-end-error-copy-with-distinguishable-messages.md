---
id: TASK-158
title: 'My Work: replace dead-end error copy with distinguishable messages'
status: To Do
assignee:
  - '@claude-sonnet-5'
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
type: bug
ordinal: 820
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Low finding #37. Error banners on the My Work screen show generic dead-end copy ('Failed to save') or render raw server strings verbatim, giving the user no way to tell what actually went wrong or what to do next. Map error cases to distinguishable, actionable user-facing messages, following the project convention of distinguishing error causes rather than showing one generic message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Column-manager and My Work error banners show distinguishable, actionable messages instead of a generic 'Failed to save' or a raw server string
<!-- AC:END -->
