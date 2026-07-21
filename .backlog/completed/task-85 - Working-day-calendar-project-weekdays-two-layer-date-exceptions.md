---
id: TASK-85
title: 'Working-day calendar: project weekdays + two-layer date exceptions'
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
updated_date: '2026-07-20 00:40'
labels:
  - web
  - db
milestone: m-5
dependencies:
  - TASK-83
priority: high
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §6: project setting for default working weekdays; project-level date exceptions (holiday / extra workday); user-level time off table storing dates and kind ONLY (no reason/notes column — co-members read it for capacity math). RLS per doc-8: project exceptions follow project membership; user_time_off READ is self OR shares_project_with(user_id) (helper exists in 20260709000001_rls_hardening.sql), WRITE self-only. Settings UI: project settings section for weekdays + exceptions; profile section for personal time off. Calendar data must not influence iteration boundaries anywhere (only §4 1-day start-date selection, implemented in TASK-87).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migrations add the weekday setting and both exception tables with RLS; rls-security-reviewer pass
- [x] #2 user_time_off has no free-text column; READ self-or-shared-project, WRITE self-only, proven by RLS tests
- [x] #3 Project settings and profile UI can maintain weekdays, project exceptions, and personal time off
- [x] #4 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ORDERING: implement only AFTER TASK-84 (free-mode drop, in progress on Codex) lands — migration must be numbered after the drop, and database.types.ts regen would otherwise race. Get fable-advisor review (new tables + RLS) before implementing; rls-security-reviewer on the migration (AC#1).

1. Migration supabase/migrations/<after-84>_working_day_calendar.sql (pure additive):
   - ALTER projects ADD working_weekdays int[] NOT NULL DEFAULT '{1,2,3,4,5}' (ISO 1=Mon..7=Sun). spec/data-model.md already documents it.
   - CREATE project_calendar_exceptions(id uuid pk, project_id uuid FK projects ON DELETE CASCADE, date date, kind text CHECK IN ('holiday','extra_workday'), UNIQUE(project_id,date)). RLS: members SELECT; owner/member INSERT/UPDATE/DELETE (standard project-role pattern, use require_project_role helper per TASK-58 convention).
   - CREATE user_time_off(user_id uuid FK profiles ON DELETE CASCADE, date date, kind text CHECK IN ('off'), PK(user_id,date)). NO free-text column (AC#2). RLS: SELECT USING (user_id = auth.uid() OR shares_project_with(user_id)) [helper in 20260709000001]; INSERT/UPDATE/DELETE self-only (user_id = auth.uid()).
   - Enable RLS on both; explicit EXECUTE/table grants per not-private-by-default convention (db-migrate.md item 5); grant-lockdown test is backstop.
   - Calendar data must NOT touch iteration boundaries anywhere (1-day start-date selection is TASK-87, not here).
2. Regenerate apps/web/lib/database.types.ts.
3. Web repository + types: add read/write for weekdays, project exceptions, user_time_off in apps/web/lib/supabase layer only.
4. Settings UI: project settings section (working weekdays checkboxes + exceptions add/remove list); account/profile settings section for personal time off (date list add/remove, no reason field). Follow spec/ux-principles.md; end with fable-advisor design review.
5. Tests: RLS integration tests — user_time_off cross-user READ visible only via shared project, self-only WRITE, project-exception membership gating (AC#2); component tests for both settings UIs; full pnpm test before commit (AC#4).
6. rls-security-reviewer pass on the migration (AC#1); hold merge on findings.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation (2026-07-20): migration 20260720000001_working_day_calendar.sql adds projects.working_weekdays int[] (range CHECK, dedup/sort enforced in the action since no immutable single-row expression rejects repeats), project_calendar_exceptions (members read / owner+member write), user_time_off (READ self-or-shares_project_with, WRITE self-only, no free-text column). database.types.ts regenerated. Settings UI: WorkingDaysSettings in project settings 'Calendar' section, TimeOffSettings in account settings. New tests: working-day-calendar.integration.test.ts (6 RLS cases incl. non-member/viewer/member gating, cross-user read gated by shared project, self-only write, absent reason column), plus component tests for both UIs. Full suite green: 70 files / 559 tests with SUPABASE_INTEGRATION=1; eslint clean. Pre-existing (not from this task): 3 tsc errors in lib/utils/project-states.integration.test.ts from the TASK-91 commit.

Review passes (2026-07-20). rls-security-reviewer: one minor non-blocking finding — project_calendar_exceptions UPDATE did not pin project_id, letting a user with owner/member in two projects teleport a row between them (no privilege escalation; equivalent to delete+insert, but keeps id/created_at). Fixed by adding a BEFORE UPDATE reject trigger matching the project_states precedent, plus an integration regression test. Everything else passed (all four commands covered on both tables, user_time_off UPDATE pinned, table grants covered by 20260630000002_grants.sql default privileges, no new functions so no grant checklist item). fable-advisor design review: approved with corrections, all 5 applied — (1) dates now rendered via the shared formatDate (YYYY/M/D) in both components, both aria-labels, and both duplicate-date error strings; (2) weekday form converted to useActionState with pending/Saved./error feedback; (3) updateWorkingWeekdays rejects an empty weekday set (and reports the zero-row RLS no-op a non-owner would otherwise get silently); (4) non-owners see the weekday value as text instead of disabled checkboxes; (5) added a capacity-only caption clarifying iteration dates are unaffected. Weekday parsing extracted to lib/utils/working-days.ts with its own unit test (a sync export is illegal in a 'use server' module). Non-blocking advisor note deferred: past-dated exception/time-off rows accumulate at the top of both lists — revisit after a season of real use. Verification: 71 files / 565 tests with SUPABASE_INTEGRATION=1, eslint clean, tsc clean apart from the pre-existing project-states.integration.test.ts errors, and pnpm run build succeeds. STILL PENDING: /code-review (owner-invocable only) before commit.

Code review (/code-review high, 2026-07-20): 8 findings; owner chose to fix 1/2/3/5 now. (1) formatDate parsed date-only strings as UTC midnight and read them back with local getters, rendering every calendar date a day early west of UTC — a pre-existing bug this task spread to six new call sites and which also affected iteration start/end dates on the iterations page and board. Fixed in lib/utils/format.ts by formatting YYYY-MM-DD from its digits (wall date, not instant); new lib/utils/format.test.ts pins it under TZ=America/Los_Angeles (runtime TZ change verified effective in Node, so the test genuinely fails against the old implementation). (2) The empty-weekday invariant lived only in the server action, bypassable by an owner PATCHing the column with the public anon key; moved into the CHECK as cardinality(working_weekdays) > 0 with a DB-level integration test. (3) removeTimeOff discarded its delete error; now throws on a real failure while still treating zero rows as the intended already-gone end state. (5) Dropped the created_at columns from both new tables — spec/data-model.md's DDL does not declare them, and matching the spec beat editing it. Verification after fixes: 75 files / 590 tests with SUPABASE_INTEGRATION=1, eslint clean, tsc clean apart from the pre-existing project-states.integration.test.ts errors, pnpm run build succeeds, supabase db reset applies cleanly. DEFERRED (owner not yet asked): finding 4 deleteCalendarException 500s on a concurrent delete instead of an inline message; finding 6 bare <Label> elements bound to no control in WorkingDaysSettings; finding 7 raw Postgres error text surfaced on unexpected write failures; finding 8 shares_project_with evaluated per row in the user_time_off SELECT policy (measure during TASK-86).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Adds the doc-8 §6 working-day calendar. Migration 20260720000001 adds projects.working_weekdays int[] (ISO 1-7, CHECK bounds the range and requires at least one day), project_calendar_exceptions (holiday / extra_workday, one per project-date, members read and owner+member write, project_id immutable via a reject trigger), and user_time_off (per-user and cross-project, dates and kind only with no free-text column, READ self-or-shares_project_with, WRITE self-only). Settings UI exposes weekdays and exceptions as two permission surfaces because projects UPDATE is owner-only while exceptions accept member writes; personal time off lives in account settings. Calendar data feeds capacity math only and never moves an iteration's dates. Verified with 75 test files / 591 tests (SUPABASE_INTEGRATION=1, including 8 RLS integration cases proving non-member/viewer/member gating, cross-user time-off reads gated by a shared project, self-only writes, the absent reason column, DB-level rejection of an empty weekday set, and the re-parent guard), eslint clean, pnpm run build succeeds, and supabase db reset applying every migration from empty. rls-security-reviewer and fable-advisor design review both passed after their findings were fixed; /code-review high raised 8 findings of which 1/2/3/5 plus the accessibility one were fixed. Browser verification not yet performed. Also fixes formatDate, which parsed date-only strings as UTC midnight and read them back with local getters, rendering every calendar date a day early west of UTC - this corrected iteration start/end dates on the iterations page and board as well.
<!-- SECTION:FINAL_SUMMARY:END -->
