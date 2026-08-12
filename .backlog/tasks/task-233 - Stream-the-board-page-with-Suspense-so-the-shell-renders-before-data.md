---
id: TASK-233
title: Stream the board page with Suspense so the shell renders before data
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-12 15:05'
labels: []
milestone: m-2
dependencies:
  - TASK-232
priority: medium
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The board page currently blocks on the slowest of all its queries before anything renders — loading.tsx exists but there is no Suspense boundary anywhere, so navigation shows a blank/stale view until every query resolves. Render the app shell (sidebar, header, board frame) immediately and stream the board content in when its data resolves, so the page feels responsive even when queries are slow. Follow-up to TASK-232; do after it lands so the streamed subtree wraps the already-slimmed data fetch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Navigating to /projects/[id]/board paints the sidebar and board frame before board data resolves (Suspense boundary with a skeleton fallback around the board content)
- [ ] #2 Story side peek (?story=) does not block the initial board paint
- [ ] #3 No behavior regression: board interactions (drag, quick-add, filters) work as before
- [ ] #4 Full suite passes from apps/web/: pnpm test and pnpm run lint
<!-- AC:END -->
