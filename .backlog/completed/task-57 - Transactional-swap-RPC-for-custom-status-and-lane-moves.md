---
id: TASK-57
title: Transactional swap RPC for custom-status and lane moves
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:11'
updated_date: '2026-07-16 15:42'
labels:
  - concurrency
  - db
milestone: m-2
dependencies: []
priority: high
ordinal: 15800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex full-codebase review (2026-07-12), High (concurrency): moveCustomStatus and moveLane (apps/web/app/projects/[id]/settings/actions.ts:276-306, 369-404) swap neighbor positions as two independent parallel UPDATEs — no transaction or lock, so one side can fail (TASK-26 added result checks, but not atomicity) and concurrent moves work from the same stale snapshot, yielding duplicate positions. Also from the review: direction strings other than 'up' are coerced to 'down' — validate against an explicit union and reject anything else.

Fix: one transactional swap RPC (row locks or the project advisory lock) used by both statuses and lanes; input validation ('up'|'down') at the action boundary; consider a deferrable uniqueness constraint on (project_id, position) per table if compatible with the swap.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A status/lane swap is atomic: both rows move or neither does, under concurrency
- [x] #2 Invalid direction values are rejected, not coerced
- [x] #3 Tests cover concurrent swaps and the half-failure case
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.

IMPLEMENTED (Opus 4.8, 2026-07-16), fable-advisor 承認(修正付き)どおり.

migration 20260716000002_swap_adjacent.sql:
- swap_adjacent(p_project_id,p_table,p_id,p_direction) returns void。SECURITY DEFINER/search_path public。
- p_table∈(custom_statuses,swimlanes)・p_direction∈(up,down) 検証(不一致 P0001、強制変換しない)。project_role owner|member else 42501(move_story_board/insert_board_item と同文 fail-closed)。
- positions 単独 advisory lock(finalize 取らない)。
- 静的2分岐で array_agg(id order by position,id) を project_id 絞り込み読取→array_position→端 return/未検出 P0002→配列 swap→dense 0..n-1 rewrite。
- 承認条件(b): 値入替でなく dense-rewrite 採用(過去の position 重複を自己修復、advisor 指摘)。
- 承認条件(a): 読取が project_id scope なので他プロジェクト id は配列に現れず P0002=cross-tenant guard。UPDATE 対象は全て scope 読取由来。

signature 逸脱: DESIGN は (p_table,p_id,p_direction)。p_project_id 追加は role check/lock key に必要、move_story_board/insert_board_item と統一(advisor 承認)。
deferrable UNIQUE(project_id,position) は TASK-58 送り(advisor 承認、現状 UNIQUE なし=一時違反の懸念なし)。helper 抽出(require_project_role 等)は TASK-58 スコープにつき踏襲のみ。

actions.ts: moveCustomStatus/moveLane を swap_adjacent thin caller 化、parseSwapDirection で up|down 以外 throw(coerce 廃止=doc-1 Low)、assertAllSucceeded import 削除。
cleanup: grant-lockdown allowlist に swap_adjacent 追記、database.types.ts 再生成。

tests: swap-adjacent.integration.test.ts 11件(両テーブル swap/端 no-op/invalid direction・table P0001/viewer 42501/cross-tenant P0002/重複 position 正規化/並行 swap AC#1・#3)、settings/actions.test.ts を rpc 呼び出し+direction 拒否(AC#2)へ書換。
検証: pnpm test 444 pass/90 skip、統合 314 pass(29ファイル)、tsc 0、eslint 0。

doc-1 の該当2 finding(High: 並列 swap の非 atomicity / Low: direction coerce)を消化。

rls-security-reviewer: セキュリティ指摘なし(role gate/cross-tenant/whitelist/grant/lock順序すべて既存規約と整合)。ただし新テストの flaky を検出: 重複position正規化テストが a,b を同 position=0 で seed し RPC の order by position,id のタイが UUID 乱数依存で ~50% fail していた(関数は正しい、テスト前提の誤り)。修正: タイ後の canonical 順序を service-role で実読取して期待値を組み立てる形に変更、5回連続 pass で決定化。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the transactional swap_adjacent RPC for custom-status and lane moves (migration 20260716000002, commit 1a0fee1): both rows move atomically or not at all, invalid directions are rejected, and swap-adjacent.integration.test.ts covers concurrency and half-failure.
<!-- SECTION:FINAL_SUMMARY:END -->
