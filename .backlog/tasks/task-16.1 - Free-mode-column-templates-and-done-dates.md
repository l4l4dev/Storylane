---
id: TASK-16.1
title: 'Free mode: column templates and done dates'
status: To Do
assignee: []
created_date: '2026-07-07 14:28'
labels:
  - web
dependencies: []
references:
  - spec/screens.md
parent_task_id: TASK-16
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md: project creation seeds free boards from a template (KanbanFlow: Todo/This week/Today/In progress/Done with Done is_done=true, or Basic: To do/Doing/Done). Cards in is_done columns show completed_at and group under Today/Yesterday/date headers, newest first. completed_at is set when a story moves into an is_done column and cleared when it moves out (column added by TASK-15).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Free project creation offers KanbanFlow and Basic templates and seeds custom_statuses accordingly
- [ ] #2 Moving a story into/out of an is_done column sets/clears completed_at
- [ ] #3 is_done columns group cards under date headers by completed_at, newest first
- [ ] #4 Tests cover template seeding and completed_at maintenance on column moves
<!-- AC:END -->
