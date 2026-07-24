---
id: TASK-180
title: Roll-up + board/velocity/My Work integration for containers
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
updated_date: '2026-07-24 06:38'
labels: []
milestone: m-6
dependencies:
  - TASK-179
documentation:
  - doc-18
type: feature
ordinal: 1900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Exclude containers from board/velocity/My Work via one is_container=false filter, and compute container progress as a read-side roll-up (doc-18 §5).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 backlog zone predicate gains is_container=false, mirrored in _splice_backlog, move_story_board, buildBacklogRows, zoneForStory
- [x] #2 velocity points-counted, auto-assign, and virtual-group walk exclude containers; children count as terminal stories
- [x] #3 My Work assigned-stories query excludes containers
- [x] #4 container roll-up (headline state + point sum from children per doc-18 §5 rule) is a packages/core pure function with golden fixtures (Web/iOS parity); never fed into velocity
- [x] #5 set_story_state rejects is_container=true stories with a clear message (container has no board state) — the guard is in the RPC, not only the UI (doc-18 §4)
- [x] #6 roll-up rule handles partial completion: not-all-done + any done/in_progress/rejected child => in_progress (never falls through to unstarted); matches doc-18 §5
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (branch feat/epic-story-unification, awaiting chain merge per doc-19).

Roll-up (AC#4/#6): packages/core/src/container-rollup.ts (rollupContainer) + golden fixture spec/fixtures/container-rollup.json (10 cases, Web/iOS parity like computeStateGate). doc-18 §5 headline ladder: all-done→done; else any done/in_progress/rejected→in_progress (covers partial '3 done+2 unstarted' AC#6, and all-rejected→in_progress — headline never rejected); else every-icebox→icebox / else unstarted. Point sum (null→0), per-category breakdown incl. rejected+icebox. Display-only, never fed to velocity.

set_story_state guard (AC#5, §4): migration 20260724061745 redefines set_story_state (SECURITY INVOKER, grants preserved, already on grant-lockdown allowlist), adding an is_container reject after the locked read with the doc-18 §4 message before the raw CHECK fires. Integration test in nesting.integration.test.ts.

Board/My Work (AC#1/#3): .eq('is_container', false) added to board/page.tsx stories fetch (the real fix — that query has no state_id filter, so a NULL-state container would bucket into the Icebox via columnForStory) and my-work/page.tsx assigned query.

Owner decision (this session): SKIP the redundant is_container=false additions to _splice_backlog / move_story_board / velocity finalize_iteration that doc-18 §5/AC#1-#2 enumerate. Containers are DB-guaranteed state_id/iteration_id/points = NULL (stories_container_off_board CHECK from TASK-178 + triggers from TASK-179), so those functions already exclude containers by construction (backlog walk = 'state_id is not null'; velocity = INNER JOIN on state_id + category='done'). Adding no-op clauses would mean redefining ~200-line function bodies verbatim (transcription risk) for zero behavior change. Outcome of AC#1/#2 (containers off board/velocity/virtual-group walk) is achieved and verified; the literal per-function mirror was deliberately not done.

Verified: supabase db reset clean; types regenerated; packages/core 77 pass (incl. rollup 10/10); apps/web pnpm test 703 pass / 217 skip; SUPABASE_INTEGRATION=1 nesting.integration 6/6 (incl. container guard); grant-lockdown 3/3; eslint + tsc clean. HIGH-effort code review: clean, no blocking findings (only note: My Work filter is defensively redundant, kept per §5). Migration rls-security-reviewer pass deferred to TASK-182 per doc-19.

Official /code-review (high) run by owner: 3 findings.
- #2 (my code): My Work .eq('is_container', false) was dead (state_id filter + CHECK already exclude). REMOVED — AC#3 still holds via the state_id-null filter. Consistent with this session's owner decision to not add redundant filters.
- #3 (my code): headlineFor did up to 4 array passes. Refactored to derive the headline from the single-pass breakdown counts (O(1), same result — all 10 fixtures green).
- #1 (NOT this task — TASK-178 code, story-detail-panel.tsx:157): field autosave resends the initial detail.parentId, which realtime mergeRemote never reconciles (parentId not in LOCKABLE_FIELDS). Latent now (nothing writes parent_id server-side yet); becomes active with the TASK-184 Parent picker and concurrent-session reparents — a stale autosave would revert a server-side reparent and could flip is_container back. Surfaced to owner for handling in TASK-184 (or a dedicated fix); not a TASK-180 blocker.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Container roll-up pure fn + golden fixtures (packages/core), set_story_state container guard (migration 20260724061745), and is_container=false board/My Work fetch filters. Redundant SQL-function filters (_splice_backlog/move_story_board/velocity) skipped per owner decision — containers excluded by the TASK-178 CHECK invariant. Verified via db reset, packages/core 10/10 rollup, web 703 unit, 6/6 nesting integration incl. guard, lint+tsc clean, high-effort review clean.
<!-- SECTION:FINAL_SUMMARY:END -->
