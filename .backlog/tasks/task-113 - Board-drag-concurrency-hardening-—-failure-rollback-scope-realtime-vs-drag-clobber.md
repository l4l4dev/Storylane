---
id: TASK-113
title: >-
  Board drag concurrency hardening — failure rollback scope + realtime-vs-drag
  clobber
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
updated_date: '2026-07-21 15:36'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 findings #4 and #5, both in the same board drag/realtime interaction. (1) kanban-columns-board.tsx:511 / board-list-view.tsx:1284: a rejected drag's catch handler reverts to the last server-confirmed snapshot (synced), not just this drag — a second, unrelated already-accepted drag can be visually undone until the next refresh. (2) kanban-columns-board.tsx:415 / board-list-view.tsx:1188: containers resync whenever initialContainers changes reference — including realtime updates from unrelated concurrent users — even mid-drag (activeId non-null), risking the dragged item's DOM node being pulled out from under dnd-kit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A rejected drag's rollback reverts only the dragged story to its pre-drag position, not the whole board to the last-synced snapshot
- [x] #2 Realtime-driven container resync is deferred (or merged non-destructively) while a drag is in progress (activeId non-null)
- [x] #3 Tests cover both kanban-columns-board.tsx and board-list-view.tsx (both are affected)
- [x] #4 pnpm test + lint green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ROOT CAUSE (both findings, both files — kanban-columns-board.tsx & board-list-view.tsx each own identical, duplicated drag state):
- Realtime: kanban-board.tsx useProjectBoardRealtime -> router.refresh() on any other user's change -> new initialContainers ref -> each view's render-time reconcile ('if (synced !== initialContainers)') fires unconditionally, INCLUDING mid-drag (activeId non-null) -> dnd-kit's dragged DOM node yanked (finding #5).
- Revert scope: handleDragEnd reverts a failed/invalid/no-over drop via setContainers(synced) (kanban) / fallback()=setContainers(toListItemContainers(synced,...)) (list). 'synced' is the last SERVER-confirmed snapshot, so it also discards any earlier optimistic drag whose dropStory is still in flight (not yet revalidated) -> that unrelated accepted drag is visually undone (finding #4).

FIX (apply to BOTH files):
1. Guard the render-time reconcile with activeId === null, so a realtime-driven prop change is deferred while a drag is in progress. (After drag ends, the next render still sees synced !== initialContainers and reconciles.)
2. Capture a pre-drag snapshot of containers at handleDragStart into a ref; revert to that ref (not synced) on the three failure paths (no-over / not-allowed / server-rejected). Given fix #1 defers realtime mid-drag and dnd-kit allows only one active drag, containers changes between drag-start and drag-end ONLY due to this drag, so reverting to the drag-start snapshot == reverting only this story, preserving prior in-flight optimistic drags.

OPEN DESIGN QUESTION (for advisor): the two files duplicate this orchestration (containers/synced/activeId + reconcile + revert). Option A: extract a shared generic hook (useOptimisticBoardOrder) — single root-cause fix, unit-testable via renderHook, de-dupes; but a cross-cutting refactor of concurrency-sensitive board state. Option B: fix in-place in both files; smaller diff but drag-path testing is harder (needs dnd-kit simulation or a per-file extracted hook). Leaning A. TASK-126 already notes de-duplicating evaluateDrop/evaluateListDrop across these two files, so shared board logic has precedent.

TESTS: cover both files (AC #3): (a) mid-drag prop change does NOT reconcile containers while activeId set, DOES after it clears; (b) a failed drop reverts only the dragged story, leaving a prior still-in-flight optimistic move intact.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED per advisor's 修正付き承認 (Option A, shared hook). Design decision on advisor's open point #5 (toListItemContainers/syncedBacklogItems): serverContainers = useMemo(toListItemContainers(initialContainers, initialBacklogItems, states)); reconcile token = raw initialContainers prop (both props refresh in lockstep from the same RSC fetch, so one token detects every server change; the freshly-built derived map can't be reference-compared). syncedBacklogItems state eliminated entirely.

Files: NEW components/features/board/use-optimistic-board-order.ts (shared state machine: optimistic containers, activeId+isPending-gated reconcile, per-drag snapshot, whole-board revert for sync invalid/cancel + per-item revert for async rejection) + .test.ts (6 renderHook tests). NEW pure helper lib/utils/board.ts restoreItemPosition() + 4 tests in board.test.ts. Wired both kanban-columns-board.tsx and board-list-view.tsx onto the hook; isAllowedMove now reads story data from containers (identical to old synced mid-drag) so synced/syncedBacklogItems are gone from both.

Applied both advisor corrections: (1) reconcile guard is activeId===null && !isPending (not just activeId), so the render right after a drag doesn't revert the just-made move before its own save's revalidate lands; verified overlapping startTransition keeps isPending true (hook test 'stays gated while two drops overlap'). (2) async rejection reverts ONLY the dragged item via restoreItemPosition, not the whole board. Also caught+fixed a bug in my first cut: revertItem must use the snapshot captured at THIS drag's end (preDragSnapshot()), not a later shared-ref read — an overlapping second drag's beginDrag overwrites the ref; covered by hook test 'revertItem uses the caller''s captured snapshot, not a later ref overwritten by drag B'.

Verified: pnpm exec vitest run on board.test.ts (18 pass) + use-optimistic-board-order.test.ts (6 pass); pnpm exec tsc --noEmit clean; pnpm run lint clean; full pnpm test 573 passed / 186 pre-existing skips / 0 failed.

/code-review high (8-angle finder + verify) on the uncommitted change. Verified findings + resolutions:
- REFUTED: list isAllowedMove switching from synced to containers was flagged as changing backlog-story drags; direct check of board/page.tsx:200,208,216 shows initialContainers[BACKLOG_COLUMN_ID] holds backlog stories, so old synced contained them too — equivalent, no behavior change.
- FIXED (correctness): onDragCancel only cleared activeId, leaving an onDragOver-floated card stranded until the next refresh (pre-existing). Now reverts to the pre-drag snapshot on cancel, in both views.
- FIXED (latent coupling, 3 finders): the list's reconcile token was the raw initialContainers prop while the reconcile target derived from 3 inputs (initialContainers, initialBacklogItems, states) — a backlog/states-only server change with a stable initialContainers ref would have stopped reconciling. Collapsed the hook to a single reference-stable serverContainers param (the list memoizes it; its ref changes iff any of the 3 inputs change), which is its own token. Removed the two-param API.
- FIXED (cleanup): the drag-end drop orchestration (snapshot capture + runDrop + try/catch + per-item revert + setError) was duplicated near-verbatim in both views. Folded into runDrop(id, action, onError); the snapshot-timing invariant now lives in one place. Hook public API shrank 9→7 members (preDragSnapshot/revertItem gone).
- NO CHANGE (transient): restoreItemPosition re-inserts the snapshot's item copy; during a drag a story's data is never mutated by a reorder, so it equals the current copy and self-heals on reconcile.
- By-design costs (deferring a co-user mid-drag delete; isPending widening the stale window for unrelated updates) are the intended, documented trade-offs of findings #4/#5.
Re-verified after fixes: use-optimistic-board-order.test.ts 6 pass, full pnpm test 573 passed, tsc + lint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Both board views (kanban + list) now share one optimistic-order hook (useOptimisticBoardOrder). A realtime router.refresh() mid-drag no longer yanks dnd-kit's node — reconcile is deferred while activeId is set OR a drop is still saving (isPending). A failed drop reverts only the dragged story (restoreItemPosition), preserving a sibling drag whose save is still in flight, instead of snapping the whole board to the last server snapshot. Advisor-reviewed (修正付き承認, Option A); both mandated corrections applied plus an overlapping-drag snapshot bug caught in implementation. Verified via new renderHook + pure-helper tests (10 new) and full suite (573 passed), tsc, lint all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
