---
id: TASK-127
title: >-
  Cleanup: CLAUDE.md convention fixes (.then() chain, history-narration
  comments, stale comment, duplicated date helper)
status: To Do
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-21 11:01'
labels: []
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
- [ ] #1 notification-listener.tsx's .then() chain replaced with async/await
- [ ] #2 apps/mcp/src/handlers.ts's history-narration comments (lines ~106, 192-196, 509, 550) rewritten to state the current invariant instead of narrating past tasks
- [ ] #3 mutation-error-banner.tsx's stale "Free mode" comment updated to reflect the current two-view (List/Kanban) reality
- [ ] #4 apps/mcp/src/handlers.ts's utcTodayKey removed in favor of importing formatDateOnly(Date.now()) from @storylane/core
- [ ] #5 pnpm test + lint green
<!-- AC:END -->
