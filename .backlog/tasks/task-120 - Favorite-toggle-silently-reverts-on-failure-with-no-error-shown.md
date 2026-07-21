---
id: TASK-120
title: Favorite toggle silently reverts on failure with no error shown
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-21 11:00'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #12. apps/web/components/features/projects/project-card-menu.tsx:43 reverts the optimistic favorite toggle on RPC failure with zero message, unlike the sibling pin toggle (story-peek-menu.tsx) which follows ux-principles.md principle 2 (a failed action must say so).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 project-card-menu.tsx's favorite toggle shows an inline error on RPC failure, matching the sibling pin-toggle's pattern
- [ ] #2 A test proves a failed favorite toggle shows an error, not a silent revert
- [ ] #3 pnpm test + lint green
<!-- AC:END -->
