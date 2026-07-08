---
id: TASK-17
title: Project switcher polish
status: To Do
assignee: []
created_date: '2026-07-07 14:29'
updated_date: '2026-07-08 12:39'
labels:
  - web
dependencies:
  - TASK-8
references:
  - spec/screens.md
priority: low
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The sidebar project switcher already exists (app-sidebar.tsx) but owner didn't discover it — it reads as a label, not a control. Per spec/screens.md 'Project switcher': add a chevron affordance, list favorites first with pin icons, show each project's mode badge, and exclude archived projects.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Switcher trigger shows a visible chevron and hover state so it reads as a control
- [ ] #2 Dropdown lists favorites first with a pin icon, shows mode badges, and excludes archived projects
- [ ] #3 Component test covers ordering and archived exclusion
<!-- AC:END -->
