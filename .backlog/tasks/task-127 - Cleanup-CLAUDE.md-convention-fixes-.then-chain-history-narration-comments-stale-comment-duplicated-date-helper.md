---
id: TASK-127
title: >-
  Cleanup: CLAUDE.md convention fixes (.then() chain, history-narration
  comments, stale comment, duplicated date helper)
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-21 11:01'
updated_date: '2026-07-23 03:38'
labels: []
milestone: m-2
dependencies: []
priority: low
type: chore
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 low-severity bundle (conventions).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 notification-listener.tsx's .then() chain replaced with async/await
- [x] #2 apps/mcp/src/handlers.ts's history-narration comments (lines ~106, 192-196, 509, 550) rewritten to state the current invariant instead of narrating past tasks
- [x] #3 mutation-error-banner.tsx's stale "Free mode" comment updated to reflect the current two-view (List/Kanban) reality
- [x] #4 apps/mcp/src/handlers.ts's utcTodayKey removed in favor of importing formatDateOnly(Date.now()) from @storylane/core
- [x] #5 pnpm test + lint green
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Converted notification-listener.tsx's auth.getUser().then() chain to an inner
async function called via void, preserving the cancelled-flag guard on both
setUserId/setUsername. Rewrote handlers.ts's TASK-N-narrating comments
(labels upsert, story tracker rollback, task position, velocity naming,
RLS row-count race x2) to state the current invariant only, and replaced
utcTodayKey with formatDateOnly(Date.now()) from @storylane/core. Updated
mutation-error-banner.tsx's stale "Free mode" comment to the current
List/Kanban two-view reality. pnpm test (691 passed) and pnpm run lint green
from apps/web; apps/mcp's own vitest suite and tsc --noEmit also clean.
<!-- SECTION:FINAL_SUMMARY:END -->
