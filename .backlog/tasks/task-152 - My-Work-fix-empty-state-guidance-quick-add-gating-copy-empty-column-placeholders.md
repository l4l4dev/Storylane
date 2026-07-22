---
id: TASK-152
title: >-
  My Work: fix empty-state guidance (quick-add gating copy, empty column
  placeholders)
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
ordinal: 650
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 High-impact findings #4, #5. The empty-state copy tells every user to 'add a personal task above,' but the quick-add trigger only renders when the viewer has exactly one personal project -- for zero or multiple it silently disappears with no fallback explanation (6 experts). Separately, empty individual columns (notably an unplanned Today) render as a bare strip with no placeholder or prompt. Note: the quick-add gating itself is an intentional spec decision (screens.md:434-438, doc-8 section 10) -- fix the copy/placeholder, do not change the gating.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Empty-state copy branches on whether the quick-add is actually present; when absent it explains the alternative (add from a personal project's board)
- [ ] #2 Each empty column body shows a short placeholder/prompt instead of a bare empty strip
<!-- AC:END -->
