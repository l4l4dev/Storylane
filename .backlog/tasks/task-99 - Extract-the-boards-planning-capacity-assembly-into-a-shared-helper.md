---
id: TASK-99
title: Extract the board's planning-capacity assembly into a shared helper
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
ordinal: 11200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-86 left ~50 lines in apps/web/app/projects/[id]/board/page.tsx that decide which calendar dates to query, assemble memberCalendars, and map projected sprints to point budgets. The pure math lives in packages/core (projectCapacity/forecastPoints), but this assembly does not, so the next consumer cannot reuse it.

Why it matters: spec/velocity.md states the calendar/capacity math ships as a shared per-client function. TASK-89 (My Work) and any future auto-assignment path will otherwise re-derive the assembly and drift on exactly the questions the TASK-86 code review already surfaced — whether viewers count, and what happens when the calendar read fails.

Two smaller findings from the same review belong with this work:
- The two calendar queries run in a second round trip after the main Promise.all, because calendarStart/calendarEnd derive from currentIteration. project.iteration_length is known beforehand, so a conservative over-fetched range could join the first batch and be filtered in memory, removing one full RTT from the hottest page.
- parseDateOnly/formatDateOnly/MS_PER_DAY are now byte-identical in packages/core/src/capacity.ts and apps/web/lib/utils/iterations.ts. TASK-85 fixed a timezone bug in this exact arithmetic; two copies means the next fix reaches only one. Export them from packages/core and have iterations.ts import them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The board page no longer contains calendar-fetching or budget-mapping logic; it calls one helper
- [ ] #2 The helper is covered by tests that do not require rendering the board page
- [ ] #3 Board planning capacity is fetched without adding a serial round trip after the main query batch
- [ ] #4 parseDateOnly/formatDateOnly exist in exactly one place and both packages use it
<!-- AC:END -->
