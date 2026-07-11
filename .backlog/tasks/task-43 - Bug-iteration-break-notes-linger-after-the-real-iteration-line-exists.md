---
id: TASK-43
title: 'Bug: iteration break notes linger after the real iteration line exists'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:19'
updated_date: '2026-07-11 06:36'
labels:
  - web
  - bug
dependencies: []
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: after adding an iteration (break), the real iteration divider line renders but the 'iteration break' note rows also remain, duplicated across groups ('全てに表示されていてとても邪魔'). Investigate how iteration-break notes are stored and rendered in board-list-view.tsx and the backlog grouping logic (TASK-9 virtual iteration groups): expected behavior is that once a break has produced/aligned with a real iteration boundary, the break marker is consumed or rendered exactly once at its boundary — not repeated in every group. Reproduce first, then fix per spec/screens.md 'Backlog groups' (update the spec if it is silent on break lifecycle).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduction documented in the task (steps + observed vs expected)
- [ ] #2 After an iteration boundary exists, no duplicate/lingering break notes render
- [ ] #3 Regression test covers the break lifecycle
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46). End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
