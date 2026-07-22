---
id: TASK-157
title: 'My Work: fix invalid role=button-wrapping-Link causing double tab stop'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:39'
labels: []
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: low
type: bug
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Low finding #43. The draggable card wrapper applies dnd-kit's role="button" around the story's own <Link>, producing invalid ARIA nesting (a link inside a button role) and a double tab stop per card -- keyboard/screen-reader users tab through the same card twice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each My Work card is a single tab stop with valid ARIA semantics (no button role wrapping a link)
<!-- AC:END -->
