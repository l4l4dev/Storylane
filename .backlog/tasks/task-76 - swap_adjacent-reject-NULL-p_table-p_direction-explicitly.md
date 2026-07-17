---
id: TASK-76
title: 'swap_adjacent: reject NULL p_table/p_direction explicitly'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 13:16'
labels:
  - db
milestone: m-2
dependencies: []
priority: low
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review 2026-07-17: in 20260716000002_swap_adjacent.sql the validation uses NOT IN, and NULL NOT IN (...) evaluates to NULL which IF treats as false — so p_table=NULL slides through as the swimlanes branch and p_direction=NULL as down, instead of raising invalid input. Add explicit IS NULL rejection (or coalesce) for both parameters, matching the RPC's stated contract; extend the existing swap_adjacent integration test with the NULL cases.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 swap_adjacent(p_table=>NULL) and (p_direction=>NULL) raise the invalid-input error; integration test covers both
<!-- AC:END -->
