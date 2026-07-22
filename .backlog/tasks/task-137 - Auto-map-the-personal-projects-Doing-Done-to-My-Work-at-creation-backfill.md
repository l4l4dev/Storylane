---
id: TASK-137
title: Auto-map the personal project's Doing/Done to My Work at creation + backfill
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 05:24'
updated_date: '2026-07-22 08:54'
labels: []
dependencies:
  - TASK-131
priority: medium
type: feature
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-14 round-5 addendum (owner decision 2026-07-22). The auto-created personal project ('My Tasks') has no reachable Settings page (TASK-103 hiding + TASK-129 back-link), so it can never be mapped by hand -- personal-task Done would stay a cancellable local mark forever and never enter the permanent Done log (story_completions), defeating My Work's primary use case. Fix: give the personal project a default project_my_work_mapping automatically. Creation path lives in supabase/migrations/20260721000001_personal_project_on_signup.sql (signup function -- redefine in a NEW migration, full-function replacement per this repo's precedent). Also backfill existing personal projects. If the mapped states later drift (delete/recategorize via direct URL or MCP), the standard broken-mapping behavior applies unchanged (read-side unmapped + My Work banner) -- no personal-specific mechanism.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new migration redefines the personal-project signup function so project creation also inserts a project_my_work_mapping row: doing_state_id = the project's in_progress-category state, done_state_id = its done-category state (first by position if several), configured_by = the new user
- [x] #2 The same migration (or a sibling) backfills project_my_work_mapping for existing is_personal projects lacking a row, using the same selection rule; personal projects lacking a matching-category state are skipped, not errored
- [x] #3 No personal-specific broken-mapping code: a drifted personal mapping behaves exactly like any broken mapping (unmapped classification + My Work banner) -- verify by test or existing coverage, do not add a new mechanism
- [x] #4 rls-security-reviewer pass on the new migration(s)
- [x] #5 supabase db reset green; pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Migration 20260722000004 implemented: handle_new_user() (based on the CURRENT 20260721000004 definition, not the superseded 20260721000001) now also inserts project_my_work_mapping for the new personal project (doing/done state ids picked by lowest position within category), plus a backfill INSERT for existing is_personal projects lacking a row. Verified via supabase db reset: fresh dev-user signup auto-mapped correctly (Doing/Done state ids match). Backfill logic independently verified by stripping the mapping and re-running the exact backfill query -- repopulated identically. AC #3 (no personal-specific special-casing) verified by code inspection (brokenMappingProjectIds has no isPersonal parameter at all) plus a new explicit test. tsc/lint green, full suite 596 passed. rls-security-reviewer pass in progress.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-fable-5
created: 2026-07-22 08:53
---
Cancelled before implementation: doc-15 (My Work redesign, 2026-07-22) removes the project_my_work_mapping machinery entirely - personal tasks now write real state directly via category resolution (TASK-139), so no mapping row is ever needed. Superseded by TASK-138/139.
---

author: @claude-fable-5
created: 2026-07-22 08:54
---
Correction to the previous comment: TASK-137 WAS implemented (20260722000004_personal_project_my_work_mapping.sql, merged to main) before the doc-15 decision landed. The redesign supersedes it at runtime instead: TASK-138 drops project_my_work_mapping (forward-only, including this backfill's rows) and TASK-139's category-resolved real-state writes take over the personal Done-log behavior this task provided. No action needed here.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New migration 20260722000004: handle_new_user() (redefined from the current 20260721000004 base) now also inserts project_my_work_mapping for a new personal project at signup (doing/done state ids by lowest position within category), plus a one-time backfill for existing is_personal projects lacking a row (same rule, skips rather than errors when a matching-category state is missing). No personal-specific broken-mapping mechanism added -- brokenMappingProjectIds handles a drifted personal mapping identically to any project's (verified by code inspection + new test, since the function has no isPersonal parameter at all). Verified: supabase db reset applies cleanly; fresh dev-user signup auto-mapped correctly (confirmed via db query); backfill logic independently verified by stripping and re-running the exact query; rls-security-reviewer pass clean (SECURITY DEFINER bypass matches the sibling handle_new_project_states trigger's established pattern, configured_by correctly credits the project's own creator); tsc/lint green; full suite 596 passed.
<!-- SECTION:FINAL_SUMMARY:END -->
