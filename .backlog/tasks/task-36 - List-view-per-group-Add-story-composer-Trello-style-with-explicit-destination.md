---
id: TASK-36
title: >-
  List view: per-group Add story composer (Trello-style) with explicit
  destination
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:17'
updated_date: '2026-07-11 17:26'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11, two related complaints about the List view quick-add (apps/web/components/features/board/quick-add-composer.tsx, board-list-view.tsx):
1. Nothing is added until Enter is pressed, and the composer rows ('Iteration #1 - current - 0 pts Add story' / 'Backlog Add story') run together visually, so it is hard to tell what you are doing.
2. Add story only targets the Backlog; with future iterations present it is unclear where a new story will land.

Adopt the pattern common to Trello/Linear-style boards: each group (current iteration, each future iteration, Backlog, Icebox) gets its own '+ Add story' button at the BOTTOM of the group. Clicking opens an inline card composer scoped to that group with a visible 'Add' button (Enter also submits), Esc/blur cancels, and the composer stays open after submit for rapid consecutive entry. New stories append to the bottom of that group. The button must be visually separated from the group header line.

Design options were proposed to the owner (2026-07-11 review reply) — confirm chosen variant in the task before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every List-view group has its own Add story affordance at the group's bottom edge
- [x] #2 Composer shows an explicit Add button; Enter submits, Esc cancels, composer remains open after each add
- [x] #3 A story added from a group lands in that group (correct iteration_id/backlog/icebox) at its bottom
- [x] #4 Tests cover per-group destination and consecutive adds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. quick-add-composer.tsx: drop the `compact` prop (its only 3 call sites are all being redesigned below to the bottom-anchored style). Add an explicit `Add` submit Button next to the existing hint text. Add optional `beforeItemId?: string` prop -> hidden `before_item_id` field (backlog-only; harmless/unused for other targets).
2. board/actions.ts `quickCreateStory`: accept optional `before_item_id`. For target "backlog": switch to the same insert-at-exact-spot pattern createBacklogDivider already uses (fetchBacklogOrder -> insert placeholder position -> splice at beforeItemId's index (or end) -> persistBacklogOrder). Unifies with today's plain-append behavior when beforeItemId is omitted. icebox/unstarted/free-mode targets unchanged (nextPosition append).
3. board-list-view.tsx:
   - ListSection (Current): move composer out of the header row to below the <ul>, drop `compact`.
   - IceboxColumn: move composer out of the header to below its <ul>, drop `compact`.
   - BacklogSection: remove the single header-level composer. Render one QuickAddComposer(target="backlog", beforeItemId=nextRealRowId(rows, index+1)) at the end of every group (last content row, or right after the header for an empty group) — skip when that group is collapsed. If the whole backlog has zero rows (no groups render at all), render one fallback composer with no beforeItemId.
4. Tests:
   - quick-add-composer.test.tsx: update the trigger-stays-visible test's assertions if hint text changes; add a test for the explicit Add button submitting, and one confirming `before_item_id` is included in the FormData when the prop is passed.
   - board/actions.test.ts: add quickCreateStory tests — inserting into an empty backlog (no before_item_id), inserting before a specific existing item (position ends up between its neighbors), and confirming icebox/unstarted targets are unaffected.
5. Run pnpm vitest for touched files, tsc --noEmit, eslint.
6. fable-advisor design review, then hand off manual verification steps.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principle 4 (create destination visible at point of action) and 7 (honest hit targets). Check original Tracker's adding_stories help via the Wayback procedure in that file. End with a fable-advisor design review before manual verification.

Design decisions confirmed with owner (this session, since the prior 2026-07-11 review reply wasn't recorded anywhere retrievable): (1) trigger style = full-width dashed-border button per group (matches the existing non-compact QuickAddComposer style), opening an inline form with an explicit 'Add' button + 'Esc to close' hint (Enter still submits too); (2) virtual future-iteration groups inside Backlog DO get their own per-group composer with correct in-group insertion, implemented now (not deferred).

fable-advisor review: 修正付き承認。ブロッキング指摘(反映済み): spec/screens.md 190-193/196-210行が旧デザイン(ヘッダー内テキストリンク、Enterのみ)のままで実装と矛盾していたため、新デザイン(グループ下端の点線ボタン、明示的Addボタン、collapse中は非表示)に合わせて改訂した。

既知の挙動(ブロッキングではないが記録): (1) velocity超過グループ(例: capacity 8に13pt storyが1件)のcomposerから追加すると、buildBacklogRowsの容量ベース分割により新storyは次番号の新グループ先頭として再表示される — 優先順位上の位置(その直後)は正しく、容量ベース分割という既存仕様に内在する挙動でバグではない。(2) collapse中のグループはcomposerも非表示にした — 中身が見えない状態でaddすると行き先が見えなくなり principle 4 に反するため意図的な挙動。

Non-blocking follow-up候補(advisorが提案、オーナー確認待ち): (a) quickCreateStoryのbacklog分岐がinsert→persistBacklogOrderの2段非トランザクションで、persist失敗時にstoryだけ作成済みのままリトライを促す文言が出て二重作成の恐れがある — decision-1に沿ってinsert+resequenceを1つのRPCにまとめる(createBacklogDivider/dropStoryInListも含め統一)。(b) composerの<li>が隣接行のFragment内にあるため、他ユーザーのRealtime更新でグループ終端行が変わるとcomposerがunmountして入力中のドラフトが消えうる — グループ番号ベースの安定keyでul直下siblingに変更。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
List view: every group (Current, each virtual future-iteration group inside Backlog, Icebox) now gets its own full-width dashed '+ Add story' button at that group's bottom edge instead of a subtle header text link. The composer shows an explicit Add button (Enter still works too) and stays open after each add for consecutive entry. A story added from a specific virtual-iteration group's composer lands at that exact group's bottom via a new before_item_id mechanism on quickCreateStory, reusing createBacklogDivider's fetch-merge-splice-persist pattern. Verified in the browser (dev login, local Supabase): Current-group add, per-virtual-group add landing in the right group, estimate-then-Start still works alongside it, and the Icebox composer pinned below its scroll area. fable-advisor review (approve with corrections) found spec/screens.md documented the old header-link design — updated it to match. Two non-blocking follow-ups flagged (backlog insert RPC-ification, composer key stability under Realtime reflow) — deferred pending owner decision. Full pnpm vitest (362 passed), tsc --noEmit, eslint on touched files all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
