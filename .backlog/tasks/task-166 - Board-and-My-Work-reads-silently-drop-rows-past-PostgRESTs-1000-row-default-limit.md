---
id: TASK-166
title: >-
  Board and My Work reads silently drop rows past PostgREST's 1,000-row default
  limit
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
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
- [ ] #1 Board's story fetch and My Work's story/story_completions fetches page through all matching rows instead of only the first 1000
- [ ] #2 A test seeds a fixture past 1000 rows and asserts every row is present (documenting the pre-fix truncation as the regression this closes)
- [ ] #3 pnpm test and pnpm run lint are green from apps/web
<!-- AC:END -->
