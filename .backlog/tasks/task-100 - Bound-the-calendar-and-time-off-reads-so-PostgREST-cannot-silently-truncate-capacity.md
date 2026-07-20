---
id: TASK-100
title: >-
  Bound the calendar and time-off reads so PostgREST cannot silently truncate
  capacity
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-20 03:13'
labels:
  - web
milestone: m-5
dependencies:
  - TASK-86
priority: medium
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The board's planning-capacity queries (project_calendar_exceptions and user_time_off, added in TASK-86) have no explicit range guard. With MAX_PROJECTED_SPRINTS=26 at a 14-day cadence the window spans roughly 364 days; a large team plus many holiday rows can approach PostgREST's default max-rows limit.

Why it matters: rows past the cap are dropped with no error and no signal. Missing time-off rows silently INFLATE capacity, which over-commits the team — the same failure direction TASK-86 deliberately guarded against for the error case (it degrades to the minimum-1 fallback instead of pretending nobody is away). The truncation path has no such guard because the code never inspects a count or compares the returned length against a limit.

Decide the fix: request an exact count and detect truncation, page the reads, or shorten the planning horizon so the range cannot realistically overflow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A truncated calendar or time-off read is detected rather than silently treated as complete data
- [ ] #2 On detection, planning capacity degrades conservatively (never overstates) — matching the existing calendarUnavailable fallback
- [ ] #3 A test proves the truncation path does not inflate capacity
<!-- AC:END -->
