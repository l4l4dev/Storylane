---
id: TASK-125
title: 'Efficiency: batch N+1 queries (dashboard fetch loop, invite RPCs)'
status: To Do
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-22 05:23'
labels: []
dependencies: []
priority: low
type: enhancement
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 low-severity bundle (efficiency).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dashboard's per-project fetchIterations/fetchMembers loop (apps/web/app/dashboard/page.tsx) replaced with batched .in("project_id", ...) queries
- [ ] #2 Project-creation's sequential invite_member RPC loop (apps/web/app/dashboard/actions.ts) runs concurrently via Promise.all
- [ ] #3 pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-21 12:34
---
Descoped: AC #3 (my-work story query .in filter) and #4 (hasFilterableItems double-recompute) removed — doc-14 (My Work Kanban rework) replaces my-work/page.tsx's queries and my-work-sections.tsx wholesale, making both moot. Kept #1/#2 (dashboard N+1, sequential invite RPC), unrelated to My Work.
---
<!-- COMMENTS:END -->
