---
id: TASK-87
title: >-
  Flexible cadence: changeable length, per-sprint override, 1-day working-day
  rule, terminology
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
updated_date: '2026-07-20 03:40'
labels:
  - web
  - db
milestone: m-5
dependencies:
  - TASK-86
priority: high
ordinal: 2000
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Design fixed by Fable advisor 2026-07-20 (consistent with doc8-locked-decisions). (1) Cadence change: plain projects.iteration_length UPDATE via existing settings action; new projects-UPDATE trigger records 'project.cadence_changed' (old/new days) into activity_logs — trigger, not RPC insert, so MCP/iOS writes are covered by the single recording path. (2) Per-sprint override: new RPC override_iteration_length(p_iteration_id, p_end_date) — pg_advisory_xact_lock(project), reject state='done', reject if p_end_date < start_date; whole-week overrides = UI computes end_date preserving start weekday, RPC just validates working-day math is NOT involved (boundaries are calendar-blind except 1-day rule). Next-iteration creation already derives from previous end_date so no other writes needed. Concurrency test: override vs finalize race under the lock. (3) 1-day rule lives inside the iteration-creation path in the finalize/ensure_current_iteration RPC (decision-1: DB-side): start_date = next working day per project calendar ONLY (working_weekdays + project_calendar_exceptions, never user_time_off), end_date = day before next working day (Fri spans Fri-Sun); lazy catch-up may create empty done rows (velocity window excludes them, TASK-86). Calendar edits never move existing rows. (4) Migration adds projects.iteration_term text NOT NULL DEFAULT 'Iteration' (free text); all client surfaces (board header, iterations page, Slack finalize message) render the term; 1-day projects title iterations by date. Order: migration -> RPC + trigger (rls-security-reviewer pass) -> integration tests (cadence change next-row-only, override, 1-day weekend span, calendar-edit immutability) -> UI term rendering -> full suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Constraint from TASK-86 RLS fix (d02f751): authenticated no longer holds UPDATE on iterations (only update(goal)), so the override_iteration_length RPC MUST be postgres-owned SECURITY DEFINER like finalize_iteration/skip_iteration — a SECURITY INVOKER RPC would get permission denied writing end_date.
<!-- SECTION:NOTES:END -->
