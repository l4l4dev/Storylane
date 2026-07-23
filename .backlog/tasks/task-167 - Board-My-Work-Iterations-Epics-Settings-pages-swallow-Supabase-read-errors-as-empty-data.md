---
id: TASK-167
title: >-
  Board/My Work/Iterations/Epics/Settings pages swallow Supabase read errors as
  empty data
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review (2026-07-23) found several server-component pages destructure only 'data' from Supabase reads and discard 'error' — e.g. apps/web/app/projects/[id]/board/page.tsx:66. A transient DB outage therefore renders as a 404 (project not found) or an empty board/list instead of reaching the existing error.tsx boundary. The same pattern is present on My Work, Iterations, Epics, and Settings pages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every top-level Supabase read across the Board, My Work, Iterations, Epics, and Settings pages throws when its 'error' is non-null instead of proceeding on 'data' alone
- [ ] #2 A thrown read error reaches the route's error.tsx, verified by a test or a documented manual repro per page
- [ ] #3 pnpm test and pnpm run lint are green from apps/web
<!-- AC:END -->
