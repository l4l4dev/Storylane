---
id: TASK-87
title: >-
  Flexible cadence: changeable length, per-sprint override, 1-day working-day
  rule, terminology
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
labels:
  - web
  - db
dependencies:
  - TASK-86
priority: high
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §3-§5 with advisor corrections. (1) iteration_length becomes changeable any time, allowing 1 day; the change applies to the next created iteration row (no effective-date scheduling; lazy catch-up uses length at access time — accepted); log old/new to activity_logs. (2) Per-sprint manual override (e.g. this sprint 2w->3w) via a new RPC using the existing pg_advisory_xact_lock finalization pattern; rejected if the iteration is already done; whole-week overrides preserve the start weekday. (3) 1-day cadence: iteration start_date = a working day per the PROJECT-level calendar only, end_date = day before the next working day (Friday spans Fri-Sun); calendar edits never move or delete existing iteration rows; lazy catch-up may create empty done rows (velocity window already excludes them, TASK-86). (4) Terminology: project setting for the display term (free text, e.g. Sprint); 1-day projects show the date as the iteration title.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cadence change takes effect on the next created iteration; existing rows untouched; activity_logs row recorded
- [ ] #2 Override RPC extends/shortens only the targeted non-done iteration under the advisory lock; concurrent finalize/override cannot corrupt boundaries (test)
- [ ] #3 1-day project skips non-working days per project calendar; Friday iteration spans the weekend; no boundary changes from calendar edits (test)
- [ ] #4 Display term and 1-day date titles render across board, iterations list, and Slack messages
- [ ] #5 pnpm test passes
<!-- AC:END -->
