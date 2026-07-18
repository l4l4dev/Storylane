---
id: TASK-86
title: 'Velocity rework: person-day rate with capacity snapshot'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
updated_date: '2026-07-18 03:19'
labels:
  - web
  - db
dependencies:
  - TASK-85
  - TASK-91
priority: high
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §7 with advisor corrections. Add iterations.capacity (person-days), written once by the finalization RPC (frozen at finalize time; later member/calendar changes never rewrite history). Rate = sum of accepted points / sum of capacity over the last velocity_window non-skipped capacity>0 done iterations (ratio of sums, not average of ratios). Forecast and backlog virtual-group computation change from max(velocity,1) points per group to rate x planned capacity per future sprint. Planned capacity of future sprints derives from the calendar (TASK-85) including personal time off (team-strength compensation). This math is a per-client pure function (web now, iOS later): produce shared golden fixtures covering weekday defaults, project exceptions, personal time off, member joins, capacity-0 sprints, and cadence changes. Update the Slack finalize message wording where it reports velocity (absorbs the TASK-62 re-check).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Finalization writes capacity once; re-finalization or later calendar edits cannot change a done iterations capacity (test proves it)
- [ ] #2 Rate excludes skipped and capacity-0 iterations; zero-division impossible (test with empty 1-day catch-up rows)
- [ ] #3 Virtual groups and auto-planning use rate x planned capacity; golden fixtures shared and passing
- [ ] #4 pnpm test passes
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 03:19
---
Dep added (advisor 2nd pass): the finalize RPC and rate formula must be built on category=done from the start (TASK-91), not accepted-literals, to avoid rebuilding it twice.
---
<!-- COMMENTS:END -->
