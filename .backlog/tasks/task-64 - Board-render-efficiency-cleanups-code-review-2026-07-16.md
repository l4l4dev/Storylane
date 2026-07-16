---
id: TASK-64
title: Board render efficiency cleanups (code review 2026-07-16)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-15 23:54'
labels:
  - web
  - refactor
  - performance
milestone: m-0
dependencies: []
priority: low
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Full-range code review (d023d88..HEAD, 2026-07-16) flagged three wasted-work spots on the board rendering path. None is a correctness bug; together they make large boards janky and every free-mode page load slower.

1. board-list-view.tsx BacklogSection: rows.map calls the O(n) nextRealRowId forward scan multiple times per row (directly at lines ~839/859/879 and again inside rowInsertAnchors at ~865), making each render O(n^2). Precompute a nextRealRowId[] array in one backward pass per render and index into it; reuse rowInsertAnchors' belowId for InsertBetweenRows instead of recomputing.
2. board/page.tsx FreeBoardPage (~line 320): re-calls supabase.auth.getUser() although parent BoardPage already fetched the user (~line 59), and awaits it serially before generateRecurringStories and the main Promise.all. Pass the user down (or fold getUser into the Promise.all).
3. free-board.tsx: canEdit/canDelete are threaded through six component signatures (FreeBoard → FreeBoardLanes → LaneColumnHeader → ColumnHeaderContent → ColumnMenu, plus FreeColumn) but consumed only at the leaves; derive once (context or a single derived object) to drop the pass-through plumbing. Optionally in the same pass: ColumnNameEditor and ColumnMenu.submitSettings both write the full custom_status row purely to avoid clobbering each other's fields — a patch-style updateCustomStatus (only provided fields) removes the dance.

Behavior must not change; this is refactor + perf only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 BacklogSection render does no repeated O(n) forward scans (one precomputed pass per render); existing board-list-view tests pass unchanged
- [ ] #2 Free-mode board page issues no duplicate auth.getUser() and starts its parallel fetches without a serialized auth round-trip
- [ ] #3 canEdit/canDelete reach their consumers without pass-through-only props; no visible permission behavior change
<!-- AC:END -->
