---
id: TASK-125
title: 'Efficiency: batch N+1 queries (dashboard fetch loop, invite RPCs)'
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-2
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
- [x] #1 Dashboard's per-project fetchIterations/fetchMembers loop (apps/web/app/dashboard/page.tsx) replaced with batched .in("project_id", ...) queries
- [x] #2 Project-creation's sequential invite_member RPC loop (apps/web/app/dashboard/actions.ts) runs concurrently via Promise.all
- [x] #3 pnpm test + lint green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented via Codex (ChatGPT quota): dashboard's per-project fetchIterations/fetchMembers loop replaced with two batched .in('project_id', projectIds) queries (guarded against an empty projectIds array), regrouped into per-project Maps in memory; downstream reads already used ?? [] fallback so a project with zero matching rows behaves identically to before. Project-creation's sequential invite_member RPC loop now runs via Promise.all, with the same failure-counting semantics (verified: the pre-existing 'some invites fail -> invite_failed=1' test still passes) plus a new test proving genuine concurrency (both invites dispatched before either resolves). Verified: apps/web tsc + lint clean, full suite 622/622.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-21 12:34
---
Descoped: AC #3 (my-work story query .in filter) and #4 (hasFilterableItems double-recompute) removed — doc-14 (My Work Kanban rework) replaces my-work/page.tsx's queries and my-work-sections.tsx wholesale, making both moot. Kept #1/#2 (dashboard N+1, sequential invite RPC), unrelated to My Work.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Batched the dashboard's per-project N+1 (iterations/members) into two .in() queries regrouped in memory, and parallelized project-creation's sequential invite_member RPC loop via Promise.all (same failure-counting semantics, now proven concurrent by a new test). apps/web tsc+lint clean, suite 622/622. Implemented by Codex (ChatGPT quota), diff-reviewed and verified by Claude before commit.
<!-- SECTION:FINAL_SUMMARY:END -->
