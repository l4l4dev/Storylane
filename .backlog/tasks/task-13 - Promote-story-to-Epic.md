---
id: TASK-13
title: Promote story to Epic
status: To Do
assignee: []
created_date: '2026-07-07 14:26'
labels:
  - web
  - db
dependencies: []
references:
  - spec/features.md
priority: medium
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/features.md 'Promote to Epic': a story that grew too big converts into a new epic (title/description carried over); its tasks expand into new stories at the original story's backlog position (task order preserved, original labels copied, linked to the new epic); the original story is deleted after a confirmation dialog that warns about comment deletion. Points/assignee discarded. Activity log records the promotion. Entry point: overflow menu in the side peek.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Promote to Epic appears in the side peek overflow menu with a confirmation dialog spelling out the conversion (and warning when comments exist)
- [ ] #2 New epic gets the story's title/description; each task becomes an unestimated feature story at the original backlog position preserving order, linked to the epic, with labels copied
- [ ] #3 Original story is deleted; promotion is atomic (single RPC/transaction) and recorded in the activity log
- [ ] #4 A story with no tasks promotes to an empty epic (dialog says so)
- [ ] #5 Tests cover promotion with tasks, without tasks, and with comments (warning path)
<!-- AC:END -->
