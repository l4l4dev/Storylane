---
id: TASK-190
title: 'List: Epics band — expand every child, drop containers from the Icebox'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:15'
updated_date: '2026-07-25 03:23'
labels:
  - web
milestone: m-6
dependencies:
  - TASK-189
documentation:
  - doc-20
type: feature
ordinal: 1740
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §3. Containers currently render inside the Icebox column and expand only their Icebox children, so an epic looks like frozen work and its contents vanish as they get scheduled (owner defects 2 and 3).

Move them into a dedicated collapsible Epics section at the top of the List view, ordered independently, and expand every child regardless of zone. Tracker parity: epics live in their own panel and never appear in the Backlog/Icebox panels (doc-20 §1).

The band's child rows are a deliberately lighter mirror of the real zone rows — the real row stays in Current/Backlog/Icebox and remains the thing you drag and act on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A collapsible Epics section renders at the top of the List view; collapse state persists in localStorage like the existing groups
- [x] #2 An epic row shows its epic_color chip, #number + title, the roll-up progress bar (doc-18 §5) and its point total
- [x] #3 Expanding lists every child regardless of zone, ordered by position, as a light row: location dot (Current/Backlog/Icebox/Done) + #number + title + points, with the precise location (e.g. Backlog #3) on hover
- [x] #4 Container rows no longer render in the Icebox column; the Icebox shows only plain unscheduled stories
- [x] #5 Band child rows are not drag sources and render no drag handle (ux-principles §1 — no control that looks grabbable but refuses)
- [x] #6 + Add Epic calls create_epic (TASK-189) and lands with the new epic expanded (ux-principles §10); an empty epic shows a no-stories-yet state
- [x] #7 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/utils/epics-list.ts: delete buildContainerAccordionRows/AccordionChild/ContainerAccordionRow
   (iceboxChildIds is dead once the band shows every zone, not just Icebox — the band's
   children are derived client-side in step 3 from data already on the page, no new
   server-side child dataset needed). Keep buildContainerListItems/ContainerListItem
   (rollup already covers all zones, used as-is by /epics already).
2. app/projects/[id]/board/page.tsx: call buildContainerListItems instead of
   buildContainerAccordionRows (same container/children query, trimmed literal to
   parentId/category/points — id/stateId/position drop out since nothing consumes them
   now). Rename the containerAccordionRows local/prop to containerListItems.
3. components/features/board/board-list-view.tsx:
   - toListItemContainers: drop the epicIceboxZoneId nested-child loop and the
     CONTAINER_ROWS_ZONE_ID "container" ListItem bucket (doc-20 §7: this zone-key
     scheme is replaced, not ported — TASK-192 owns porting CONTAINER_ROWS_ZONE_ID
     reordering into the band separately). Remove the Icebox zone's
     `.filter(s => s.parentId === null)` so a container's Icebox children render as
     plain rows in their real zone (mirror-row model, doc-20 §3).
   - Delete EpicAccordionRow/ContainerRowHeader and the container block out of
     IceboxColumn (AC#4); IceboxColumn goes back to a plain flat list.
   - isAllowedMove/handleDragEnd/collisionDetection/DragOverlay: drop the now-dead
     "container" ListItem branches (isDisallowedContainerRowDrop,
     isContainerBlockDroppable, the `item.kind === "container"` cases) — nothing
     produces that kind anymore in this task's scope. kanban.ts itself (exports,
     CONTAINER_ROWS_ZONE_ID, isDisallowedContainerRowDrop, classifyNestDrop) is left
     alone for TASK-192 to reuse.
   - New EpicsBand component rendered above ListSection, driven by containerListItems
     (rollup + identity) plus children computed with a small helper that scans
     containers.current/backlog/icebox for story.parentId === row.id, grouped and
     position-sorted (all data already client-side, no new prop). Per-child row: a
     4-way location dot (done / current / backlog / icebox, done takes precedence over
     zone) + #number + title + points, title="<Location> #<number>" for the hover
     detail (AC#3), no drag handle and not a SortableItem (AC#5). Band-level collapse
     persists via the existing useCollapsedGroups under a new "epics-band" key; each
     epic row keeps reusing its existing `epic:<id>` collapse key. Empty epic renders a
     "No stories yet" line (AC#6).
   - useCollapsedGroups: add an `expand(key)` that removes a key from the set
     (idempotent) — used by "+ Add Epic" to force the band and the new row open
     (ux-principles §10) even if the band was previously collapsed.
   - "+ Add Epic" trigger in the band header: reuse DraftStoryTrigger's Plus-icon
     button + useInlineEdit (resetAfterCommit, same shape as IterationGoalInput) for a
     title-only inline input; onCommit calls a new createEpic server action, then
     expand("epics-band").
4. app/projects/[id]/board/actions.ts: add `createEpic({ projectId, title })` calling
   `supabase.rpc("create_epic", { p_project_id, p_title })`, revalidatePath the board —
   same shape as the existing action functions (ActionResult return).
5. components/features/board/kanban-board.tsx: rename the passthrough
   containerAccordionRows prop/type to containerListItems/ContainerListItem (Kanban
   view still never renders it — doc-18 §1 — just threads it to BoardListView).
6. Tests:
   - lib/utils/epics-list.test.ts: drop the buildContainerAccordionRows describe block.
   - components/features/board/board-list-view.test.tsx: update the four
     iceboxChildIds fixtures to containerListItems (no iceboxChildIds field), add
     coverage for the band rendering a cross-zone child and the Icebox column no
     longer rendering container rows.
   - New/updated coverage for createEpic (actions or a light component test) and for
     the "no drag handle on band child rows" / "empty epic" states.
7. Full suite + lint from apps/web/, then fable-advisor design review against
   spec/ux-principles.md (AC#7), then hand off to the owner for /code-review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per plan (steps 1-6). Key files:
- lib/utils/epics-list.ts: buildContainerAccordionRows/AccordionChild/ContainerAccordionRow
  deleted — buildContainerListItems (rollup, all-zone) is now shared by /epics and the band.
- app/projects/[id]/board/page.tsx: containerAccordionRows -> containerListItems.
- app/projects/[id]/board/actions.ts: new createEpic({projectId, title}) calling create_epic RPC.
- components/features/board/board-list-view.tsx: new EpicsBand/EpicBandRow/EpicBandChildRow/
  AddEpicButton; toListItemContainers drops the epicIceboxZoneId nested-child machinery and
  the CONTAINER_ROWS_ZONE_ID "container" ListItem kind entirely (mirror-row model makes the
  old nest-as-drag-container approach structurally incompatible — a child can't be a real drag
  source both nested AND in its own zone). isAllowedMove/handleDragEnd's nest/attach branch
  (classifyNestDrop) removed too: with Icebox now showing parented children flatly (AC#4),
  the old "parented story dropped into flat Icebox = rejected" rule would have made every
  parented Icebox story permanently undraggable, and attach's only entry point (the nested
  drop zone) no longer exists — this wasn't optional cleanup, the old gate was actively wrong
  under doc-20's model. isDisallowedContainerRowDrop/CONTAINER_ROWS_ZONE_ID/
  isContainerBlockDroppable kept defined in kanban.ts (unused for now, own unit tests still
  cover them) for TASK-192 to port into the band per doc-20 §7/§8 phase 4 — epic-row
  drag-reorder is out of scope here.
- components/features/board/story-list-row.tsx + kanban-board.tsx: hideEpicLink prop removed
  (its only caller was the deleted accordion nesting); containerAccordionRows/ContainerAccordionRow
  renamed to containerListItems/ContainerListItem; kanban-board.tsx's iceboxRowCount badge
  simplified to iceboxStories.length (no more accordion grouping to account for).
- Tests updated: kanban.test.ts (dropped epicIceboxZoneId/classifyNestDrop/toServerZone
  describes), epics-list.test.ts (dropped buildContainerAccordionRows describe),
  story-list-row.test.tsx (dropped hideEpicLink test), board-list-view.test.tsx (rewrote the
  4 old accordion tests for the band + added empty-epic and +Add Epic coverage),
  kanban-board-toolbar.test.tsx (prop rename only).
- move-story-board.integration.test.ts left untouched: its attach assertions exercise
  dropStoryInList's server-side behavior directly, which this task didn't change (only the
  client stopped voluntarily sending parent_id via drag) — still valid until TASK-192
  redesigns the attach caller per doc-20 §5.

Verified: full suite (apps/web) 785 passed / 250 skipped (SUPABASE_INTEGRATION-gated,
unaffected), lint clean, tsc clean. Next: fable-advisor design review (AC#7) against
spec/ux-principles.md, then hand off for manual browser verification.

fable-advisor design review (AC#7): 承認, no corrections. Verdict: epic row's missing drag affordance is not a principle-1 dead control (nothing implies grabbability — it's deferred functionality, not a refusing control); mirror child rows correctly render no drag handle (AC#5); +Add Epic's forced expand satisfies principles 8/10; Icebox's now-flat parented children keep their epic-link chip (principle 8) via the existing parentEpicTitle plumbing. One note for TASK-192: when re-adding container-row drag, build on the frozen CONTAINER_ROWS_ZONE_ID/isDisallowedContainerRowDrop in kanban.ts, not the deleted epicIceboxZoneId/classifyNestDrop.

AC#1-6 checked against board-list-view.test.tsx (40 tests, all passing): band collapse/expand (own test added), epic row collapse/expand with mirror-vs-real row counting, no-drag-handle assertion contrasting mirror vs real row, empty-epic no-stories-yet state, +Add Epic -> createEpic call assertion. Full apps/web suite 785 passed/250 skipped (integration, DB-gated, unaffected), lint clean, tsc clean.

/code-review findings addressed (in this task's diff):
- CONFIRMED (high severity): band children were derived client-side from `containers`
  (built from page.tsx's `cards`, which excludes stories in a finalized iteration) while
  the epic's own rollup (containerListItems) is deliberately built from the unfiltered raw
  `stories` query -- so a child whose iteration finalized and rolled off the board would
  still count in the roll-up but silently vanish from the expanded band list, reproducing
  owner defect 3 for a different trigger. Fixed by moving child computation server-side:
  new epics-list.ts `buildEpicBandChildren` runs over the same unfiltered `stories` query
  as the rollup, threaded down as a new `epicBandChildren` prop (page.tsx -> KanbanBoard ->
  BoardListView). The old client-side `collectEpicBandChildren` is deleted.
- CONFIRMED: the deleted function also sorted children pooled from 3 zones by raw
  `position`, but spec/data-model.md's Position ordering invariant states position is
  scoped per zone, not one sequence comparable across zones -- so a raw cross-zone sort
  was meaningless. Fixed in the same rewrite: `buildEpicBandChildren` groups by location
  (current/backlog/icebox/done) first, sorting by position only within each group.
- Resolved as a byproduct: children are no longer recomputed by scanning+sorting on every
  render (they're a stable server-supplied prop now).
- Duplicated "open StoryPeek via URL param" logic between EpicBandRow/EpicBandChildRow:
  extracted a shared `useOpenPeek()` hook in board-list-view.tsx.
- kanban.ts CONTAINER_ROWS_ZONE_ID comment narrated task/doc history (banned by CLAUDE.md's
  Code Comment Policy) -- trimmed to state only the current constraint.

Test coverage added: epics-list.test.ts (buildEpicBandChildren -- location classification,
group-before-position-sort with an explicit position-collision case, finalized-iteration
inclusion, empty case), board-list-view.test.tsx updated to pass epicBandChildren as its
own prop (independent of initialContainers, matching the new server/client split).

NOT addressed here (out of TASK-190's diff -- flagged to the owner separately, not fixed
silently): 4 findings against supabase/migrations/20260724181957_epic_pinned.sql
(TASK-189, already Done/shipped) -- a DOWN-block ordering bug, a trigger-ordering
fragility note, two Code Comment Policy citations, and one SQL duplication finding.
Accepted as-is (deliberate, doc-20-approved phasing, not a defect): epic-row drag-reorder
capability is gone until TASK-192 explicitly ports it into the band.

Re-verified after fixes: full apps/web suite 791 passed / 250 skipped (unaffected
integration tests), lint clean, tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
List view に Epics バンド(doc-20 §3)を実装。コンテナ行を Icebox 列から分離し、折りたたみ可能なバンドとして上部に表示。展開すると子ストーリーをゾーン問わず全て(Current/Backlog/Icebox/Done)ミラー表示(位置ドット+#番号+タイトル+ポイント、非ドラッグ)。実ゾーンの行は変わらず実体・ドラッグソースのまま(mirror-row モデル)。+ Add Epic で create_epic RPC を呼び、作成後はバンドと新規行を自動展開。

/code-review で2件の実バグを検出・修正: (1) バンドの子リストをクライアント側の containers から作っていたため、確定済みイテレーションにロールオーバーした子がロールアップには数えられるのにバンド展開には出ない不整合があった → サーバー側 buildEpicBandChildren(epics-list.ts)に統一。(2) ゾーンをまたいだ position の直接比較は spec/data-model.md の invariant(position はゾーン単位)に反していた → ロケーションでグループ化してからグループ内のみ position ソートに修正。ピーク起動ロジックの重複を useOpenPeek に共通化、kanban.ts のコメントから履歴叙述を除去。

TASK-189 マイグレーションへの残り4件(DOWN順序バグ等)は別タスク化(TASK-195)。

検証: fable-advisor 設計レビュー承認(ux-principles 1/8/10 違反なし)。apps/web 全体テスト 791 passed / 250 skipped(DB連携テストで今回変更の影響なし)、lint clean、tsc clean。手動ブラウザ確認は未実施(確認手順を別途提示)。
<!-- SECTION:FINAL_SUMMARY:END -->
