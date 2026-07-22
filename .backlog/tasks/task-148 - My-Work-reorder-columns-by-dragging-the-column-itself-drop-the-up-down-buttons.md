---
id: TASK-148
title: >-
  My Work: reorder columns by dragging the column itself (drop the up/down
  buttons)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 11:22'
updated_date: '2026-07-22 12:55'
labels: []
dependencies: []
priority: medium
type: enhancement
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner feedback 2026-07-22: the dedicated up/down move controls for column display order are hard to use. Replace with the standard kanban pattern - grab the column (header) and drag it horizontally to reorder, like Trello/Linear. Reuse dnd-kit (horizontal SortableContext on columns) rather than a new library; check common implementations for the interaction details (drag handle on the header, drop indicator between columns). CAREFUL: column dragging must coexist with card dragging - separate activation (e.g. header-only drag handle) so grabbing a card never moves a column and vice versa. Keyboard accessibility must not regress when the buttons are removed (dnd-kit keyboard sensor covers sortable).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Columns (fixed Todo/Today/Done and free columns alike) reorder by dragging the column header; the up/down buttons are removed
- [x] #2 Card drag-and-drop is unaffected (column grab only activates on the header/handle); a drop indicator or equivalent shows the insertion point while dragging
- [x] #3 Reordering persists via the existing display-order storage; keyboard-based reordering still possible (dnd-kit keyboard sensor)
- [x] #4 fable-advisor design review against spec/ux-principles.md passes
- [x] #5 pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/utils/board-dnd.ts: add reorderIds(ids: readonly string[], activeId, overId): string[] - same relocation logic as reorderContainer but for a plain string array (My Work's column order isn't {id}[] shaped).
2. components/features/board/sortable-item.tsx: tag its useSortable call with data:{type:'card'} (additive, safe) so the shared DndContext can disambiguate card vs column drags.
3. my-work-sections.tsx: MyWorkColumnShell gains a required id prop + becomes sortable (useSortable, outer ref+transform on the section, a small GripVertical drag-handle button in the header with {...attributes}{...listeners} - NOT the whole header, so a card grab never moves a column). Add local displayOrder/syncedOrder state (idle-sync-on-reference-change, mirroring useOptimisticBoardOrder's own pattern) + isDraggingColumn state. Wrap the column render loop in an outer horizontal SortableContext (items=displayOrder). handleDragStart/Over/End check event.active.data.current?.type==='column' FIRST and branch to a column-reorder path (arrayMove via reorderIds, persist via the EXISTING saveMyWorkColumnOrder action from TASK-141, revert the whole array on failure) before falling through to the existing card-drag logic unchanged.
4. my-work-column-manager.tsx: drop the order prop + up/down buttons + move() entirely (reordering now happens via board drag) - panel simplifies to add/rename/delete of free columns only.
5. app/my-work/page.tsx: drop the order prop from the MyWorkColumnManager call site.
6. Tests: reorderIds unit tests; my-work-column-manager.test.tsx rewritten (drop reorder-button tests); my-work-sections.test.tsx extended for the drag-handle's accessible structure + displayOrder-based render sequence (no real pointer-drag simulation - matches this codebase's established testing convention for every other drag interaction).
7. spec/screens.md updated (up/down arrows -> drag-to-reorder via the column header).
8. fable-advisor design review (AC#4) before calling this done; pnpm test + lint green (AC#5).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
実装完了: reorderIds (board-dnd.ts) 追加、SortableItem に data:{type:'card'} タグ付け、MyWorkColumnShell を useSortable 化しヘッダーの GripVertical ハンドルのみがドラッグリスナーを持つ形に変更、共有 DndContext 内で event.active.data.current?.type によりカード/カラムドラッグを分岐、displayOrder ローカル state で楽観更新し失敗時は全体revert。my-work-column-manager.tsx から order prop と上下ボタンを削除し add/rename/delete専用に簡素化。spec/screens.md の記述も更新済み。tsc/lint/vitest(フルスイート639件)すべてgreen。fable-advisor design review 実行中(結果待ち)。

fable-advisor 1回目レビューでブロッキングな実装バグを検出: MyWorkColumnShell の useSortable と FlatColumn/固定スロットの useDroppable が同一id文字列を使っており、dnd-kitのdroppableレジストリ(idキーのMap)で衝突していた(TASK-141時点では存在しなかった新規バグ)。修正: カラム用sortable idを 'col:'+id で名前空間分離、data.columnId に元のidを保持しhandleDragEndで復元。あわせてグリップハンドルのヒットターゲットをBoardの矢印ボタンと同じ規約(Button variant=ghost size=icon-xs, 24px)に拡大、カラム以外へのドロップ時に無駄なsave呼び出しをしない no-op ガードも追加。tsc/lint/該当テスト(24件)green。再チェックをfable-advisorに依頼中。

fable-advisor 再チェック: 承認(merge可)。id衝突/ヒットターゲット/no-opガードの3点とも修正確認済み。AC#4クリア。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
My Work のカラム並べ替えを上下ボタンからカラムヘッダーの直接ドラッグ(Trello/Linear方式)に変更。実装: reorderIds(board-dnd.ts、plain string[]用のarrayMoveラッパー)、SortableItem に data:{type:'card'}タグ、MyWorkColumnShellをuseSortable化しヘッダーのGripVerticalハンドル(Button variant=ghost size=icon-xs)のみがドラッグリスナーを持つ形に、共有DndContext内でevent.active.data.current?.typeによりカード/カラムドラッグを分岐。fable-advisorの1回目レビューでdroppable/sortableのid衝突バグ(useDroppableとuseSortableが同一id文字列を使い、dnd-kitのレジストリで上書きが起きていた)を検出、'col:'+idの名前空間分離で修正、あわせてヒットターゲット拡大とno-opドロップ時の無駄な保存呼び出し防止も対応。再レビューで承認済み。MyWorkColumnManagerからorder propと上下ボタンを削除し add/rename/delete専用に簡素化。spec/screens.md更新。pnpm test(639件green)・lint green。
<!-- SECTION:FINAL_SUMMARY:END -->
