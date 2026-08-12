---
id: TASK-232
title: >-
  Reduce board page-load work: dedupe auth/queries, parallelize fetch waves,
  trim story payload
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-12 15:05'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Opening a project page feels slow on the free tier. The board render currently issues ~20 Supabase queries in ~5 serial waves, calls auth.getUser() (an HTTP call to Supabase Auth) up to 4 times per request (middleware, layout, page, story peek), duplicates the projects/project_members queries between layout.tsx and board/page.tsx, and ships every story description (full body text) in the board select even though cards do not display it. Pinning the Vercel function region to hnd1 (commit 0efbc27) removed the trans-Pacific RTT; the remaining page-load cost is this per-request query fan-out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 auth.getUser() results in at most one Auth network call per server request (per-request memoization, e.g. React.cache), verified across middleware/layout/page
- [ ] #2 projects and project_members are fetched once per request, shared between layout and board page
- [ ] #3 Queries with no data dependency on each other run in parallel; remaining serial steps are only the truly dependent ones
- [ ] #4 Board story select no longer includes description; the story side peek still loads the full description on open
- [ ] #5 Full suite passes from apps/web/: pnpm test and pnpm run lint
<!-- AC:END -->
