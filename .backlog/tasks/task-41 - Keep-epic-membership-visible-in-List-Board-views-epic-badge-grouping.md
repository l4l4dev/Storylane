---
id: TASK-41
title: Keep epic membership visible in List/Board views (epic badge + grouping)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:19'
updated_date: '2026-07-11 17:26'
labels:
  - web
  - ux
  - feature
milestone: m-0
dependencies: []
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: promoting a story to an epic (TASK-13 promote_story_to_epic) removed it from List/Board and jumped to the epic screen — from the boards you can no longer see which stories belong to which epic.

Desired: List/Board views show epic membership on each story (epic name badge/chip on rows and cards, colored per epic label), plus a way to see an epic's stories from the board context — e.g. an epic filter in the toolbar and/or clicking the badge filters to that epic. The epic itself is not a story and stays off the boards; what must be visible is its member stories and their grouping. Also reconsider the post-promote navigation: staying on the board with a toast link ('View epic') may be less disorienting than the current jump.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Stories assigned to an epic display the epic's name on List rows and Kanban/Focus cards
- [ ] #2 The board toolbar can filter stories by epic
- [ ] #3 After promoting a story to an epic the user is not silently ejected from the board (navigation behavior decided and consistent)
- [ ] #4 Tests cover badge rendering and epic filter
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principle 8 (relations stay visible; never teleport the user out of context). End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
