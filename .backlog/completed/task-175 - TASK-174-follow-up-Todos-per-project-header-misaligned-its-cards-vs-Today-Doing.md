---
id: TASK-175
title: >-
  TASK-174 follow-up: Todo's per-project header misaligned its cards vs
  Today/Doing
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 14:19'
updated_date: '2026-07-23 14:20'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/components/features/my-work/my-work-sections.tsx
priority: low
type: bug
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner-reported after TASK-174 shipped: Todo's per-project group header (<h3>{projectName}</h3>, always rendered even for a single project) pushed Todo's first card lower than Today/Doing, which have no such header — a visible top misalignment across columns. Root cause: TodoColumn (my-work-sections.tsx TodoColumn) rendered the header unconditionally per group.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Todo's cards start at the same vertical position as Today/Doing when there is only one project group
- [x] #2 The per-project header still renders when Todo actually has stories from more than one project (grouping still needed to disambiguate)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Only show the per-project <h3> header when groups.length > 1. Verified: new test 'omits the per-project header when Todo has only one project group' + existing 2-project test still passes; full suite 717 pass; live Playwright screenshot confirms Todo/Today/Doing card tops now align.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Todo's per-project header now only renders when there's more than one project group, so its cards align with Today/Doing when (as is typical) there's just one.
<!-- SECTION:FINAL_SUMMARY:END -->
