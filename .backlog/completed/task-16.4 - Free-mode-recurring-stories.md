---
id: TASK-16.4
title: 'Free mode: recurring stories'
status: Done
assignee: []
created_date: '2026-07-07 14:28'
updated_date: '2026-07-09 14:06'
labels:
  - web
  - db
milestone: m-0
dependencies: []
references:
  - spec/data-model.md
  - spec/screens.md
parent_task_id: TASK-16
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/data-model.md recurring_stories: recurrence rules (daily / weekly+weekday / monthly+day) managed in a free-project Settings section. Generation is lazy on board access — one instance per due rule, only the most recent missed occurrence (no flooding), placed in the rule's column/lane, last_generated_on advanced.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration adds recurring_stories with RLS; rls-security-reviewer has reviewed it
- [x] #2 Settings section (free projects only) creates/edits/toggles/deletes rules with cadence fields per spec
- [x] #3 Board access generates due instances lazily: at most one per rule regardless of missed occurrences; last_generated_on advances; day_of_month > 28 clamps to month end
- [x] #4 Tests cover daily/weekly/monthly due calculation, the no-flooding rule, and clamping
- [x] #5 Generation claims each due rule via conditional UPDATE on last_generated_on before inserting — two parallel generation calls produce exactly one instance (covered by a test)
- [x] #6 Generation RPC is SECURITY DEFINER with membership check (any role triggers it, same as lazy rollover); due dates computed in UTC per spec/data-model.md
- [x] #7 is_done columns are not offered as generation targets; deleting a generated instance does not regenerate it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260709000008_recurring_stories.sql: recurring_stories table per spec/data-model.md (id, project_id NOT NULL CASCADE, title, description, custom_status_id + composite FK to custom_statuses(id,project_id) ON DELETE SET NULL (custom_status_id) [column-specific syntax, PG15+], swimlane_id + composite FK to swimlanes(id,project_id) ON DELETE SET NULL (swimlane_id), cadence CHECK in (daily,weekly,monthly), weekday CHECK 0-6, day_of_month CHECK 1-31, is_active bool default true, last_generated_on date, created_at) + cadence-consistency CHECKs (weekly requires weekday, monthly requires day_of_month) + project_id index; RLS: same 4 policies as swimlanes (member select, owner/member insert/update, owner delete); no advisory lock needed (per-row conditional UPDATE claim suffices, unlike finalize_iteration's multi-row chain); DOWN comment block. Note the ON DELETE SET NULL deviation from stories' NO ACTION pattern in a migration comment (spec doesn't define this, decided here for UX: a rule shouldn't block deleting an otherwise-empty column).
2. generate_recurring_stories(p_project_id uuid) RPC: SECURITY DEFINER, set search_path=public, is_project_member membership check (any role, mirrors ensureCurrentIteration's lazy-rollover reasoning). v_today := (now() at time zone 'utc')::date. Per active rule: compute most-recent-occurrence in SQL only (never client-supplied - a spoofed future date could stall generation permanently, and iOS calls this same RPC per decision-1): daily=today; weekly=most recent date<=today matching weekday; monthly=least(day_of_month, last day of month) this month if <=today else last month's clamped day. Resolve effective target BEFORE claiming: rule's custom_status_id if it exists and is_done=false, else project's leftmost is_done=false column, else skip without claiming (AC #7 is_done exclusion enforced in the RPC itself, not just the UI, since the free_mode_completed_at trigger would otherwise birth a completed card if the column was toggled is_done after rule creation). If last_generated_on IS NULL OR < most-recent-occurrence: attempt UPDATE...WHERE(same condition)...RETURNING id claim; only on successful claim INSERT the story (title/description copied, story_type='feature', resolved custom_status_id, rule's swimlane_id, position = project-wide max+1, matching quickCreateStoryFree's convention not per-column).
3. Regenerate apps/web/lib/database.types.ts.
4. apps/web/lib/utils/recurring.ts: mostRecentOccurrence(rule, today) pure TS shadow function manually cross-checked against the SQL (Date.UTC-based, TZ-independent) for testing only (AC #4) - never fed back into the RPC; separate nextOccurrence(rule, today) UI-only preview function (not cross-checked against SQL, clearly commented as preview-only).
5. recurring.test.ts: mostRecentOccurrence for daily/weekly/monthly + day>28 clamping (e.g. day_of_month=31 in Feb) + no-flooding (a rule untouched for a month only advances to the single most recent missed occurrence, not one per missed day).
6. Settings CRUD actions (createRecurringStory/updateRecurringStory/deleteRecurringStory/toggleRecurringStory) in settings/actions.ts, modeled on the custom_statuses/lane actions. New RecurringStoryManager component + 'Recurring stories' section in settings/page.tsx (free-mode only); target column select excludes is_done columns; cadence select conditionally shows weekday or day_of_month input; active toggle.
7. generateRecurringStories(projectId) action in board/actions.ts wrapping supabase.rpc('generate_recurring_stories', {p_project_id: projectId}); called at the top of FreeBoardPage (board/page.tsx) before its Promise.all fetch, same lazy pattern as ensureCurrentIteration - guarded by a cheap 'any active rules exist' head-count query first (no date-math duplication in TS, avoids drift risk).
8. New integration test file gated by SUPABASE_INTEGRATION env var (skipped by default pnpm test, since this codebase has no precedent for automated DB-RPC testing - finalize_iteration's identical claim pattern also has zero automated tests): two concurrent generate_recurring_stories RPC calls against local Supabase produce exactly one story instance (AC #5); deleting the generated instance then re-running the RPC does not regenerate it (AC #7 second half). Clean up test rows by id after.
9. Run rls-security-reviewer on the migration before marking AC #1 done.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per plan: recurring_stories migration + generate_recurring_stories SECURITY DEFINER RPC (rls-security-reviewer clean - verified fail-closed membership check, no cross-project leakage, ON DELETE SET NULL correctly clears only the referencing column). Deviated from stories' NO ACTION FK pattern to ON DELETE SET NULL for custom_status_id/swimlane_id (advisor-approved: a forgotten rule shouldn't block deleting an otherwise-empty column). Due-date math (daily/weekly/monthly incl. month-end clamping) computed server-side only, verified exhaustively against real Postgres (11k+ combinations, 0 violations) before writing the TS shadow helper (recurring.ts) used for unit tests + UI preview. is_done-column exclusion enforced inside the RPC itself, not just the UI (advisor caught this: the free_mode_completed_at trigger would otherwise birth a completed card if a rule's target column was toggled is_done after creation). AC #5's concurrent-claim guarantee verified with a new SUPABASE_INTEGRATION-gated integration test (this codebase's first automated DB-RPC test - finalize_iteration's identical pattern was previously only verified manually) - ran 4x locally against real concurrent RPC calls, consistently exactly 1 story generated. web-conventions-reviewer also clean. tsc/lint/full vitest suite (263 passed, 2 integration tests correctly skipped by default) all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added free-mode recurring stories end-to-end: recurring_stories table + generate_recurring_stories SECURITY DEFINER RPC (rls-security-reviewer clean) that lazily generates due instances on board access, claiming each rule via a conditional UPDATE so concurrent calls never double-generate (verified with a new gated integration test). Due-date math (daily/weekly/monthly, month-end clamping) lives server-side only and is mirrored by a unit-tested TS helper for UI preview. is_done columns are excluded as generation targets inside the RPC itself, not just the UI, so a rule can't birth a completed card if its target column changes later. Settings CRUD (RecurringStoryManager) lets free-mode projects manage rules with cadence-conditional fields. Verified with tsc --noEmit, eslint, the full vitest suite (263 passed), a 4x-repeated concurrent-claim integration test, plus rls-security-reviewer and web-conventions-reviewer (both clean).
<!-- SECTION:FINAL_SUMMARY:END -->
