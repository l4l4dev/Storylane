---
id: TASK-64
title: Board render efficiency cleanups (code review 2026-07-16)
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-15 23:54'
updated_date: '2026-07-16 03:07'
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
- [x] #1 BacklogSection render does no repeated O(n) forward scans (one precomputed pass per render); existing board-list-view tests pass unchanged
- [x] #2 Free-mode board page issues no duplicate auth.getUser() and starts its parallel fetches without a serialized auth round-trip
- [x] #3 canEdit/canDelete reach their consumers without pass-through-only props; no visible permission behavior change
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by Codex (--write, fresh thread). (1) BacklogSection: nextRealRowIds precomputed in one backward pass, shared by quick-add anchors, InsertBetweenRows (reuses belowId), and the row menu. (2) FreeBoardPage receives the parent-fetched user (User | null prop) — duplicate auth.getUser() and its serial await removed. (3) canEdit/canDelete moved to BoardPermissionsContext (default most-restrictive false/false); pass-through props dropped from FreeBoardLanes/FreeColumn/LaneColumnHeader/ColumnHeaderContent/ColumnMenu; free-board.test.tsx wraps ColumnMenu in the Provider. Optional patch-style updateCustomStatus deliberately skipped — it would ripple into the settings-side server action contract, beyond a mechanical change (candidate follow-up). Verification: Codex ran targeted vitest (41/41) + tsc --noEmit; coordinator ran full pnpm test (440 passed / 76 skipped) and web-conventions-reviewer found no issues (algorithm equivalence incl. last-row edge case, auth semantics, context default all verified).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-fable-5
created: 2026-07-16 02:23
---
Reassigned sonnet→codex (2026-07-16): Codex CLI is now connected. Precisely-scoped, behavior-preserving refactor/perf work with exact file/line targets and existing tests — ideal for Codex, and runs on the separate ChatGPT quota instead of Claude tokens.
---

author: @claude-fable-5
created: 2026-07-16 02:56
---
Delegated to Codex (2026-07-16, second Codex delegation after TASK-65). Lessons applied: run with --write; Codex's sandbox cannot switch pnpm via corepack, so targeted tests run via ./node_modules/.bin/vitest; coordinator (Claude) verifies with grep/diff review + full pnpm test before finalization.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Board render efficiency refactor by Codex: O(n^2) row-anchor scans replaced with a precomputed array, duplicate auth.getUser() on free-mode board removed, canEdit/canDelete prop-drilling replaced with BoardPermissionsContext. Behavior-preserving; verified with full test suite (440 passed), tsc, and a conventions review.
<!-- SECTION:FINAL_SUMMARY:END -->
