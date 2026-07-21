---
id: TASK-76
title: 'swap_adjacent: reject NULL p_table/p_direction explicitly'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 13:16'
updated_date: '2026-07-21 10:07'
labels:
  - db
milestone: m-2
dependencies: []
priority: low
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review 2026-07-17: in 20260716000002_swap_adjacent.sql the validation uses NOT IN, and NULL NOT IN (...) evaluates to NULL which IF treats as false — so p_table=NULL slides through as the swimlanes branch and p_direction=NULL as down, instead of raising invalid input. Add explicit IS NULL rejection (or coalesce) for both parameters, matching the RPC's stated contract; extend the existing swap_adjacent integration test with the NULL cases.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 swap_adjacent(p_table=>NULL) and (p_direction=>NULL) raise the invalid-input error; integration test covers both
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Investigated 2026-07-21: swap_adjacent was created in 20260716000002_swap_adjacent.sql and DROPPED (drop function public.swap_adjacent(uuid, text, uuid, text)) in 20260718000001_remove_free_mode.sql — never recreated since (grep across all migrations confirms). Verified against local db reset: \df public.swap_adjacent returns 0 rows. The NULL-handling bug this task describes lives in code that no longer exists in the schema; there is nothing to fix.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Obsolete — target function was removed by the free-mode removal migration before this task could be picked up. No code change needed or possible; closing without implementation.
<!-- SECTION:FINAL_SUMMARY:END -->
