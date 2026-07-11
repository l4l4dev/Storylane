---
id: TASK-32
title: >-
  Projects page UX fixes: post-create redirect, full title display, archived
  grouping
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:16'
updated_date: '2026-07-11 06:36'
labels:
  - web
  - ux
dependencies: []
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three UX problems on the Projects page (user review 2026-07-11).

1. Creating a project returns to /dashboard (apps/web/app/dashboard/actions.ts:152 'redirect(/dashboard)') instead of opening the new project. Redirect to the new project's board.
2. Project titles are truncated on cards (apps/web/components/features/projects/project-card.tsx) and hard to read. Widen the card/title area so the full name is visible in the list (wrapping to multiple lines is acceptable).
3. When 'show archived' is on, archived projects appear first. Active boards and archived ones must be clearly distinguishable: group archived projects in a separate section at the BOTTOM of the list (e.g. 'Archived' heading), never mixed with active ones.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After creating a project the browser lands on the new project's board page
- [ ] #2 Full project name is readable on the projects list (no ellipsis truncation for typical-length names)
- [ ] #3 Archived projects render in a separate section below all active projects when visible
- [ ] #4 Tests cover redirect target and archived-section grouping
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46): design language (4px radius tokens, YYYY/M/D dates), no dead controls, no silent no-ops, no layout shift, archived-below-active. End with a fable-advisor design review against that file before manual verification.
<!-- SECTION:NOTES:END -->
