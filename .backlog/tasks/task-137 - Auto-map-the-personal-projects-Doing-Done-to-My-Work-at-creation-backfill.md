---
id: TASK-137
title: Auto-map the personal project's Doing/Done to My Work at creation + backfill
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 05:24'
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
- [ ] #1 A new migration redefines the personal-project signup function so project creation also inserts a project_my_work_mapping row: doing_state_id = the project's in_progress-category state, done_state_id = its done-category state (first by position if several), configured_by = the new user
- [ ] #2 The same migration (or a sibling) backfills project_my_work_mapping for existing is_personal projects lacking a row, using the same selection rule; personal projects lacking a matching-category state are skipped, not errored
- [ ] #3 No personal-specific broken-mapping code: a drifted personal mapping behaves exactly like any broken mapping (unmapped classification + My Work banner) -- verify by test or existing coverage, do not add a new mechanism
- [ ] #4 rls-security-reviewer pass on the new migration(s)
- [ ] #5 supabase db reset green; pnpm test + lint green (from apps/web/)
<!-- AC:END -->
