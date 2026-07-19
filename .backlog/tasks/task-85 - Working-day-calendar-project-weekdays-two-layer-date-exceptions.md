---
id: TASK-85
title: 'Working-day calendar: project weekdays + two-layer date exceptions'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
updated_date: '2026-07-19 06:29'
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
- [ ] #1 Migrations add the weekday setting and both exception tables with RLS; rls-security-reviewer pass
- [ ] #2 user_time_off has no free-text column; READ self-or-shared-project, WRITE self-only, proven by RLS tests
- [ ] #3 Project settings and profile UI can maintain weekdays, project exceptions, and personal time off
- [ ] #4 pnpm test passes
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
