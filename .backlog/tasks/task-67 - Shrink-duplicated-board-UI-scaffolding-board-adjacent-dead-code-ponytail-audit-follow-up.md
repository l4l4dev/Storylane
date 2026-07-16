---
id: TASK-67
title: >-
  Shrink duplicated board/UI scaffolding + board-adjacent dead code (ponytail
  audit follow-up)
status: Done
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-16 04:19'
updated_date: '2026-07-16 16:16'
labels:
  - web
  - refactor
milestone: m-0
dependencies:
  - TASK-51
  - TASK-57
  - TASK-58
priority: low
ordinal: 250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second half of the 2026-07-16 ponytail audit: behavior-preserving shrink refactors (~240 lines) plus the dead-code deletions that live in files TASK-51/57/58 touch. Blocked until those land to avoid conflicts — verify each finding is still current before applying.

Shrink (same logic, fewer lines):
- onDragOver container-move body duplicated near-verbatim in kanban-columns-board.tsx, focus-board.tsx, free-board.tsx, board-list-view.tsx — extract one moveBetweenContainers(containers, activeId, overContainer, overId, isAllowed) into lib/utils/board.ts (~80 lines)
- Four identical route error.tsx boundaries (app/error.tsx, app/projects/error.tsx, app/projects/[id]/error.tsx, app/stories/[id]/error.tsx) — shared RouteError client component, each file becomes ~4 lines (~50)
- LaneManager/StatusManager duplicate their reorder/CRUD scaffolding — share one list component taking a renderFields prop (~50)
- useSortable drag-handle li wrapper reimplemented five times across board views — one generic SortableItem (~50)
- moveStoryToProject/copyStoryToProject in app/stories/[id]/actions.ts are copy-paste twins — shared helper + two 3-line wrappers (~15)
- reorderContainer in lib/utils/board.ts reimplements @dnd-kit arrayMove (free-board.tsx already uses arrayMove directly) — findIndex + arrayMove (~6)
- localDateKey/todayLocalDateKey duplicated in focus-board.tsx and free-board.tsx (move next to groupDoneStories in lib/utils/focus.ts); initials() duplicated in story-card.tsx and project-card.tsx (~15)
- yagni: ThemeProvider only spreads props to NextThemesProvider (import it directly in layout); NewProjectInviteResult / InviteSearchResult are structurally identical (one shared type) (~10)

Board-adjacent deletes deferred from TASK-66:
- board/actions.ts todayDateOnly alias (call utcTodayKey directly at its one use site)
- lib/utils/board.ts BACKLOG_CONTAINER_ID / ICEBOX_CONTAINER_ID / partitionIcebox / IceboxableStory (orphaned by the state-based kanban rebuild)
- kanban-board.tsx dead re-export of BACKLOG_COLUMN_ID / ICEBOX_COLUMN_ID
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The four board views share one container-move helper and one SortableItem; no drag/drop behavior change (existing board tests pass unchanged)
- [x] #2 Route error boundaries render identically via a shared component
- [x] #3 All listed duplications and board-adjacent dead symbols are gone; tsc and full vitest pass
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Codex (@codex-gpt-5) 実装、Opus が独立検証+web-conventions レビュー。11 findings 全て適用(skip なし)。net -373行(199挿入/572削除)。共有化: moveBetweenContainers(4 board views の onDragOver)/SortableItem(useSortable li ×5)/RouteError(error.tsx ×4)/ReorderableListManager(Lane/Status)/transferStoryToProject(move/copy twins)。集約: reorderContainer→@dnd-kit arrayMove、localDateKey/todayLocalDateKey→focus.ts、initials→format.ts、invite result 型→lib/types.ts。削除: ThemeProvider(NextThemesProvider 直接使用)、board.ts の BACKLOG/ICEBOX_CONTAINER_ID・partitionIcebox・IceboxableStory(+専用テスト)、kanban-board dead re-export、todayDateOnly alias。検証: tsc 0/eslint 0/vitest 514 pass(統合込み、独立実行)。web-conventions-reviewer clean。挙動差1件(意図的・オーナー要確認): initials() を story-card 版(単語1つで2文字 'John'→'JO')に統一、project-card は従来1文字 'J' だったため単語1つの表示名アバターが2文字化。2実装が衝突するため dedup 上どちらか選択必須、spec は文字数未規定。.backlog のオーナー編集(task-3/49/51/57)はこのコミットに非同梱。
<!-- SECTION:FINAL_SUMMARY:END -->
