---
id: TASK-207
title: Burndown / cumulative flow chart for the current iteration
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 01:48'
labels: []
milestone: m-0
dependencies: []
priority: medium
ordinal: 2100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SPEC.md lists a burndown chart under Phase 2 (spec/features.md) but it was never built. activity_logs already records story.state_changed events with before/after payload (spec/data-model.md 'activity_logs'), so a day-by-day remaining-points burndown (or a cumulative flow diagram across state categories) can be derived from existing event history without a new snapshot table. This gives the team the standard sprint-review artifact ('how much is left, how did we track against the plan') that the tool currently has no answer for.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A chart on the board/iteration view (see spec/screens.md 'Board layout') shows, for the current iteration, remaining done-category points per day since the iteration's start_date, derived from activity_logs.story.state_changed history plus the iteration's snapshotted capacity/velocity (spec/velocity.md)
- [ ] #2 Ideal-pace reference line uses the iteration's capacity the same way spec/velocity.md's forecast formula does, so the chart is consistent with the existing velocity math rather than a second parallel calculation
- [ ] #3 Works for past done iterations too (viewing history), not just the live current one
- [ ] #4 Handles iterations with no activity_logs coverage (pre-dating this feature) by showing a partial/empty chart rather than erroring
- [ ] #5 spec/features.md is updated to move this out of Phase 2, and spec/screens.md documents where the chart lives
- [ ] #6 Tests cover the remaining-points derivation from a fixture set of activity_logs rows
<!-- AC:END -->
