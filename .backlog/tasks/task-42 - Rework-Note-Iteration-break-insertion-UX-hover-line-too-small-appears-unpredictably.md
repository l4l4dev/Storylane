---
id: TASK-42
title: >-
  Rework Note / Iteration break insertion UX (hover line too small, appears
  unpredictably)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:19'
updated_date: '2026-07-12 10:30'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: the '+ Note / + Iteration break' inline hover line in the List view is hard to use — the hit target is a thin line, and it flickering in/out on focus confuses the user, even though positional insertion itself works.

Direction (options proposed to the owner 2026-07-11; confirm variant before implementing): keep positional insertion but make it discoverable and stable —
A) row context menu ('Insert note above/below', 'Insert iteration break above/below') as the primary path, hover line stays as a power-user shortcut with a taller hit area;
B) persistent small '+' handle in the row gutter that opens the same menu;
C) move Note/Break into the group-level Add composer (type selector) and drop the hover line.
Whatever variant: hit target at least a full row height on hover, no layout shift when it appears.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Notes and iteration breaks can be inserted at a chosen position without pixel-hunting a thin line
- [x] #2 The affordance does not shift surrounding rows when appearing
- [x] #3 Tests cover insertion at top, middle, and bottom positions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECIDED (owner, 2026-07-11): variant A — row-menu insertion. Each List row's '…' (or right-click) menu gets 'Insert note above/below' and 'Insert iteration break here'. The hover line stays as a secondary shortcut with a taller hit target (full row-gap height) and must not shift layout when appearing.

Follow spec/ux-principles.md (landed with TASK-46), especially principles 3 (no layout shift) and 7 (honest hit targets). End with a fable-advisor design review before manual verification.

Implemented per DECIDED variant A: each Backlog story/note row (SortableBacklogRow only — Current/Icebox rows never get this, notes/breaks are Backlog-only) gets a '⋮' DropdownMenu (RowInsertMenu, board-list-view.tsx) with 4 items: Insert note above/below, Insert iteration break above/below (both directions implemented for both types, matching the fuller Option-A description rather than the DECIDED summary's asymmetric 'iteration break here' shorthand). 'Above' anchors to the row's own before_item_id; 'below' reuses the same nextRealRowId(rows, index+1) already computed for the trailing InsertBetweenRows — null at the very last row means append at the absolute end, same convention as everywhere else. Iteration-break items fire directly (mirrors InsertBetweenRows' own fire-and-forget insertIterationBreak, kept consistent rather than diverging); note items open a small Dialog for the label, with proper await+error handling (shows inline error, keeps typed text on failure) since a Dialog has a stable place to show it. Hover-line secondary shortcut: kept the visible gap at the same h-2 (no layout shift), but added an invisible, absolutely-positioned h-9 sibling hit-area so hovering doesn't require landing exactly on the 8px line — verified empirically in the browser (hover slightly off-target still revealed the buttons). Tests: RowInsertMenu (4 new tests covering top/middle/bottom-position insertion + note failure path), StoryListRow/DividerRow both gained an optional insertMenu prop (undefined for Current/Icebox callers). Verified in browser: menu inserts note/break at the exact chosen row; hover-line still works with the larger hit area; no layout shift anywhere. Full pnpm vitest (383 passed), tsc --noEmit, eslint clean.

fable-advisor review: 修正付き承認。ブロッカー(1件)+要修正(2件)を反映済み: (1) 不可視ホバー当たり判定を h-9→h-6 に縮小 — insert-line の li が position:relative のため、内部の絶対配置要素は CSS スタッキング規則上 static な隣接行より必ず上に描画され、h-9 だと各行に約12px食い込んで Start ボタン等のクリックを奪っていた(実ブラウザで隣接行の見積もりボタンをクリックして修正後に正常動作することを確認済み)。(2) RowInsertMenu の insertBreak を fire-and-forget から await+try/catch に変更し、失敗時は共有 MutationErrorBanner(dragError→mutationError にリネームして汎用化)へ報告するよう配線(BoardListView→BacklogSection→SortableBacklogRow→RowInsertMenu と onError を通す)。(3) insertAboveId/insertBelowId の算出を lib/utils/iterations.ts の純関数 nextRealRowId/rowInsertAnchors に抽出し(既存のコンポーネント内 local 関数を移動・汎用化)、iterations.test.ts に先頭行/末尾行/自動境界隣接/手動break隣接の4形状のテストを追加 — 呼び出し側の anchor 配線自体がテストで直接検証されるようになった。spec/screens.md の Insert-between affordance を改訂(行メニューが primary、hover line は secondary・拡大ヒット領域・レイアウトシフトなしと明記)。テスト: iterations.test.ts +8, board-list-view.test.tsx +1(insertBreak失敗パス)。既存の周辺不具合(自動境界隣接ノートのヘッダー帰属、InsertBetweenRows自体の同種fire-and-forget)はTASK-60として別途登録(オーナー承認)。Full pnpm vitest (392 passed), tsc --noEmit, eslint clean。実ブラウザでh-6修正後の隣接行クリックを再確認済み。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause: the List view's only way to insert a Note/Iteration break at a precise position was hovering an 8px hairline between rows — hard to find, easy to lose while moving toward the revealed buttons. Owner's decided fix (variant A, recorded 2026-07-11): every Backlog row now carries a persistent '…' menu (RowInsertMenu) as the primary path — Insert note/iteration break, above/below — with the hover line kept as a secondary shortcut, given a larger (but non-shifting) hit area. fable-advisor review caught a real bug in the first hover-line implementation: an oversized invisible hit band (h-9) overlapped into neighboring rows and, because CSS stacking always paints positioned content over static siblings regardless of DOM order, silently swallowed clicks on those rows' own buttons — shrunk to h-6, verified in the browser that an adjacent row's estimate button now clicks through correctly. Also fixed: RowInsertMenu's iteration-break insert now awaits and reports failure through the shared MutationErrorBanner instead of failing silently (matching the note-insert path, which already had proper error handling); the above/below anchor computation was extracted into pure, tested functions (nextRealRowId, rowInsertAnchors) in lib/utils/iterations.ts, closing a real test-coverage gap where the anchor wiring itself wasn't exercised. spec/screens.md updated to document the menu as primary and the hover line as secondary. Two pre-existing, unrelated issues the review surfaced were filed separately as TASK-60. Full pnpm vitest (392 passed), tsc --noEmit, eslint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
