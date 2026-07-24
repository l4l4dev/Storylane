---
id: TASK-166
title: >-
  Board and My Work reads silently drop rows past PostgREST's 1,000-row default
  limit
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
updated_date: '2026-07-23 04:58'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review (2026-07-23) found apps/web/app/projects/[id]/board/page.tsx:102's all-stories board query and apps/web/app/my-work/page.tsx:79's assigned-stories/state/story_completions queries have no pagination against PostgREST's default max-rows (supabase/config.toml:16 = 1000). In a project or user history crossing that count, later rows silently disappear from the Board and My Work with no error.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Board's story fetch and My Work's story/story_completions fetches page through all matching rows instead of only the first 1000
- [x] #2 A test seeds a fixture past 1000 rows and asserts every row is present (documenting the pre-fix truncation as the regression this closes)
- [x] #3 pnpm test and pnpm run lint are green from apps/web
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added apps/web/lib/utils/supabase-pagination.ts's fetchAllRows() -- a small
generic helper that pages a Supabase query via .range() until a page
returns fewer than max_rows (1000, supabase/config.toml), instead of
relying on a single unbounded select that PostgREST silently truncates.

Wired it into the three flagged unbounded reads: Board's story fetch
(app/projects/[id]/board/page.tsx), and My Work's assigned-story and
story_completions fetches (app/my-work/page.tsx). All three now aggregate
every matching row regardless of count. Left my_work_story_state,
my_work_columns, and project_states queries alone -- their row counts are
bounded by other constraints (per-user marks/columns, per-project state
lists) and were not part of Codex's finding.

Verified: new unit tests (supabase-pagination.test.ts) simulate a 2,500-row
fixture past two full pages and assert every row survives, plus a
single-partial-page case and an error-propagation case. pnpm test (694
passed, up from 691), pnpm run lint, and pnpm run build all green from
apps/web. tsc --noEmit clean (dropped now-redundant `?? []` guards on the
three call sites since fetchAllRows never resolves null).
<!-- SECTION:FINAL_SUMMARY:END -->
