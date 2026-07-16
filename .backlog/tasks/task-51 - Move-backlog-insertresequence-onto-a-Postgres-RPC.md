---
id: TASK-51
title: Move backlog insert+resequence onto a Postgres RPC
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 11:29'
updated_date: '2026-07-16 04:05'
labels:
  - web
  - refactor
  - backend
milestone: m-2
dependencies: []
priority: high
ordinal: 15750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
quickCreateStory's backlog-target branch and createBacklogDivider/dropStoryInList all do a non-transactional insert-then-persistBacklogOrder sequence (fable-advisor review on TASK-36). If persistBacklogOrder fails after the insert lands, the story/divider is already created but quick-add-composer.tsx's error message ('press Enter to retry') invites resubmission, risking a duplicate. Per the decision-1 pattern already used for update_story/transition_story, unify insert+resequence into one Postgres RPC shared by all three call sites.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 quickCreateStory (backlog target), createBacklogDivider, and dropStoryInList's insertion path all go through one shared RPC that inserts and resequences positions in a single transaction
- [x] #2 A failure partway through cannot leave an orphaned story/divider with no corresponding position update
- [x] #3 Existing tests for these three actions pass unchanged (or updated only for the new call shape)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ADVISOR-APPROVED (Fable, 2026-07-16, 修正付き承認). insert_board_item で挿入+resequence を1トランザクション化。承認条件: doc-3 finding#1 (move_story_board NULL-unsafe zone 述語) 修正を本パスに取り込む。

新マイグレーション 20260716000001_insert_board_item.sql:
1. _splice_backlog(p_project_id,p_kind,p_id,p_before_kind,p_before_id): move_story_board の2テーブル backlog merge+splice+_resequence_backlog を抽出(revoke public/authenticated)。one position-rules impl。
2. create or replace move_story_board: 195行の述語を 'and (v_current_id is null or v_new_iteration is distinct from v_current_id)' に修正、backlog 分岐を _splice_backlog 呼び出しに置換。
3. insert_board_item(p_project_id,p_kind,p_payload,p_anchor) returns uuid: SECURITY DEFINER/search_path public/project_role owner|member else 42501/positions 単独 advisory lock(finalize 不要=ヘッダに明記)/payload 検証(f: title 非空, divider kind, note label 非空)/INSERT(story: feature/unstarted/iteration_id null/placeholder pos)→ _splice_backlog → 新 id return。merge 述語は line255 と同一(iteration_id null & state<>unscheduled + 全 dividers)、新id除外、anchor-miss=末尾追加。revoke→grant authenticated + allowlist 追記。
4. drop function resequence_backlog_order。

actions.ts: quickCreateStory backlog 分岐 + createBacklogDivider を insert_board_item thin caller 化、persistBacklogOrder/fetchBacklogOrder 削除。dropStoryInList は変更なし(AC#1 は move_story_board で充足=condition(a)修正後に成立)。

cleanup(e): grant-lockdown allowlist から resequence_backlog_order 除去+insert_board_item 追加、resequence-backlog-order.integration.test.ts 削除、型再生成、移行期コメント更新。TASK-56/doc-3 に消化記録。

tests: insert-board-item.integration.test.ts(anchor あり/なし/miss=末尾, divider 混在, viewer 拒否, cross-tenant anchor=末尾化, 失敗経路で行残らず=AC#2), move_story_board backlog-drop-with-active-iteration 回帰(condition a), actions.test.ts 3アクション更新(AC#3)。
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Overlap note (2026-07-12): TASK-56 (Codex review: consolidate ALL board drag/drop mutations into transactional reorder RPCs) covers the same persistBacklogOrder surface from the other direction. Implement TASK-51's insert+resequence RPC as part of / in the same design pass as TASK-56's RPC family — one position-rules implementation, not two. TASK-58 item 2-3 (max+1 races, position invariants) also lands there.

IMPLEMENTED (Opus 4.8, 2026-07-16), advisor-approved 設計どおり.

migration 20260716000001_insert_board_item.sql:
- _splice_backlog(project,kind,id,before_kind,before_id): move_story_board の2テーブル merge+splice を抽出(revoke public/authenticated)。one position-rules impl。
- create or replace move_story_board: doc-3 finding#1 の NULL-unsafe 述語を 'and (v_current_id is null or v_new_iteration is distinct from v_current_id)' に修正、backlog 分岐を _splice_backlog 委譲。
- insert_board_item(project,kind,payload,anchor) returns uuid: SECURITY DEFINER/search_path public/project_role owner|member else 42501/positions 単独 advisory lock/payload 検証(title 非空・divider kind・note label 非空)/INSERT→_splice_backlog。revoke→grant authenticated。
- drop resequence_backlog_order。

actions.ts: quickCreateStory backlog 分岐 + createBacklogDivider を insert_board_item thin caller 化、persistBacklogOrder/fetchBacklogOrder 削除。dropStoryInList は変更なし。
cleanup: grant-lockdown allowlist(resequence_backlog_order→insert_board_item)、resequence-backlog-order.integration.test.ts 削除、database.types.ts 再生成。

tests: insert-board-item.integration.test.ts 6件(anchor 有/無/miss=末尾, divider 混在, viewer 拒否, AC#2 orphan なし), move-story-board に doc-3#1 回帰1件, actions.test.ts の backlog insert を新呼び出し形へ書き換え。検証: pnpm test 442 pass/80 skip, tsc 0, eslint 0, 統合 SUPABASE_INTEGRATION=1 で 304 pass(28ファイル)。

AC#1: dropStoryInList の挿入パスは TASK-56 の move_story_board(atomic splice)で充足。doc-3 finding#1 を本パスで消化(TASK-56/doc-3 に記録)。
<!-- SECTION:NOTES:END -->
