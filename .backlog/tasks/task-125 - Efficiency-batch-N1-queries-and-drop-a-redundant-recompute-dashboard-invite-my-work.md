---
id: TASK-125
title: >-
  Efficiency: batch N+1 queries and drop a redundant recompute (dashboard,
  invite, my-work)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
labels: []
dependencies: []
priority: low
type: enhancement
ordinal: 12200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 low-severity bundle (efficiency).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dashboard's per-project fetchIterations/fetchMembers loop (apps/web/app/dashboard/page.tsx) replaced with batched .in("project_id", ...) queries
- [ ] #2 Project-creation's sequential invite_member RPC loop (apps/web/app/dashboard/actions.ts) runs concurrently via Promise.all
- [ ] #3 My Work's story query (apps/web/app/my-work/page.tsx) adds a .in("project_id", projectIds) filter instead of over-fetching then discarding in JS
- [ ] #4 MyWorkSections' hasFilterableItems (apps/web/components/features/my-work/my-work-sections.tsx) no longer recomputes buildMyWorkSections a second time
- [ ] #5 pnpm test + lint green
<!-- AC:END -->
