---
id: TASK-16.2
title: 'Free mode: WIP limits'
status: To Do
assignee: []
created_date: '2026-07-07 14:28'
labels:
  - web
  - db
dependencies: []
references:
  - spec/screens.md
  - spec/data-model.md
parent_task_id: TASK-16
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md and spec/data-model.md: custom_statuses.wip_limit (nullable, >0). Column header shows count/limit and turns warning-colored when count exceeds the limit; drops are never blocked (soft limit). Configured from the column header menu.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration adds custom_statuses.wip_limit; rls-security-reviewer has reviewed it
- [ ] #2 Column header shows count/limit when set and turns warning-colored when exceeded; drag-and-drop is never blocked
- [ ] #3 Limit editable (set/clear) from the column header menu
- [ ] #4 Tests cover the over-limit indicator and limit editing
<!-- AC:END -->
