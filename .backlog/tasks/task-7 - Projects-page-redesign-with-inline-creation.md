---
id: TASK-7
title: Projects page redesign with inline creation
status: To Do
assignee: []
created_date: '2026-07-07 14:25'
labels:
  - web
dependencies:
  - TASK-5
  - TASK-6
references:
  - spec/screens.md
priority: high
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rebuild /dashboard per spec/screens.md 'Projects page': inline creation panel (no overlay dialog), mode selection as Tracker/Free comparison cards, all initial settings in the form (iteration length, point scale, velocity window / free column template), optional initial member invites via the user-search picker, and project cards with mode badge, mode-specific summary, member avatars, and last-updated. Design language unified with the project pages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New project creation happens in an inline panel on /dashboard; create-project-dialog overlay is removed
- [ ] #2 Mode is chosen via comparison cards; Tracker shows iteration length / point scale / velocity window fields, Free shows column template choice (KanbanFlow / Basic per spec)
- [ ] #3 Members can be invited from the creation panel (optional) using the user-search picker
- [ ] #4 Project cards show mode badge, mode-specific summary line, overlapping member avatars capped with +N, and last-updated time
- [ ] #5 Page uses the same design tokens/card styles as project pages (visual unification)
- [ ] #6 Tests cover the creation form (both modes) and card rendering
<!-- AC:END -->
