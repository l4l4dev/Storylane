---
id: TASK-58
title: Correctness & position hardening bundle (Codex review remainder)
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:12'
updated_date: '2026-07-16 05:40'
labels:
  - bug
  - concurrency
  - db
milestone: m-2
dependencies: []
priority: medium
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex full-codebase review (2026-07-12), remaining Medium/Low findings bundled:
1. Zero-row silent success: task toggle/delete + story delete (apps/web/app/stories/[id]/actions.ts:348-384) and epic update/delete (apps/web/app/projects/[id]/epics/actions.ts:45-75) check only the error, not affected rows — add .select('id') + exactly-one-row assertion (the TASK-22/26/31 pattern, applied to the remaining call sites).
2. max(position)+1 races: addTask, epic creation, lane creation, recurring-story position assignment — allocate positions under a lock/sequence or make insertion collision-tolerant; at minimum document and normalize on read.
3. Position invariants: many tables store integer positions with no uniqueness/scope constraints while the UI assumes dense stable order — document the invariant in spec/data-model.md and add feasible DB constraints (align with whatever TASK-56 RPCs decide).
4. Free-project creation is non-atomic (dashboard/actions.ts:111-145): project row commits before custom_statuses/invitations — move creation into one transactional RPC with an explicit invalid-invitee policy.
5. Edge Function client typing: git-webhook takes an untyped any client — type it with a narrow interface or generated types (may already be covered by TASK-53's work in that file; skip if so).
Sequencing: pick up AFTER TASK-56/57 so position rules land once, not twice.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No remaining mutation reports success on zero affected rows (repo-wide check)
- [x] #2 Position allocation is race-safe or collision-tolerant everywhere it is derived from max+1
- [ ] #3 Position ordering invariant documented and DB-enforced where feasible
- [ ] #4 Project creation is all-or-nothing including default statuses
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.

CODE REVIEW UPDATE (2026-07-16): (a) Item 5 (git-webhook untyped client) is DONE — TASK-53 introduced the narrow WebhookClient interface (supabase/functions/git-webhook/index.ts:23); skip it. (b) ADD to this bundle: create index on activity_logs(story_id) — both the SET NULL FK and the new composite FK (20260715000006) are unindexed on the referencing side, so every story DELETE (incl. promote_story_to_epic) scans activity_logs. (c) ADD: extract shared SQL guard helpers when touching the RPC family — require_project_role(project_id, variadic roles) (two guard dialects now coexist: coalesce-vs-empty-string in skip_iteration/membership RPCs, 'v_role is null or not in' in move_story_board; one missed coalesce in a future RPC is a privilege hole), current_iteration(project_id) (copy-pasted in finish_story_from_git + move_story_board + finalize_iteration), _assert_not_last_owner (duplicated inside membership_admin_rpcs). (d) Item 3 (position invariants doc) should also record the single source of truth for zone predicates: the Backlog zone rule (iteration_id is null AND state<>'unscheduled') is currently defined independently in move_story_board.sql, board/actions.ts fetchBacklogOrder, and lib/utils/kanban.ts zoneForStory — document in spec/data-model.md which one is canonical and that the others must mirror it.

SLICE 1 done (Opus 4.8, 2026-07-16) — AC#1(zero-row) + doc-3 add-on(activity_logs index):
- item 1: assertRowAffected を id 指定 mutation に追加。stories/[id]/actions.ts(toggleTask/deleteTask/deleteStory)、epics/actions.ts(updateEpic/deleteEpic)、settings/actions.ts(deleteLabel/updateCustomStatus/deleteCustomStatus/setStatusWipLimit/updateLane/deleteLane/updateRecurringStory/deleteRecurringStory/deleteIntegration/updateProject)、board/actions.ts(estimateStory/deleteBacklogDivider)。upsert/no-op が正当な箇所(saveIntegration upsert・iteration_goals・estimateStory の既存 points!==null 早期 return・updateProfile=自プロフィールで必ず存在)は除外。
- item 6(doc-3): migration 20260716000003 で activity_logs(story_id) index 追加(SET NULL FK + composite FK が referencing 側未 index → story DELETE/promote が全スキャンだった)。
- item 5(git-webhook typing)は TASK-53 で対応済みにつき skip(ノート済)。
検証: pnpm test 417 pass/90 skip、統合 286 pass、tsc 0、eslint 0。board actions.test.ts に zero-row guard の代表テスト追加、mock を .select() 対応に更新。

REMAINING(advisor 必須の DB スライス): item 2(max+1 races: addTask/createEpic/createCustomStatus/createLane/quickCreateStory 非backlog/quickCreateStoryFree)、item 3(position 不変条件 doc + deferrable UNIQUE: custom_statuses/swimlanes/epics/tasks の単一列スコープのみ。stories/backlog_dividers はゾーン依存で単純 UNIQUE 不可)、item 3d(zone 述語の canonical を spec/data-model.md に明記)、item 4(project 作成の transactional RPC)、item (c)(guard helper 抽出: require_project_role/current_iteration/_assert_not_last_owner)。

SLICE 2a done (Opus 4.8, 2026-07-16) — AC#2(max+1 races):
- 方針は advisor 判定で RPC 化から変更: position は ORDERING key であって dense ではない(密化は _splice_backlog/move_story_board/swap_adjacent の rewrite が担う)。nextval は単調増加なので default 割当は必ず末尾 append になり、値を下げる方向の rewrite と衝突しない。RPC より強い(素の insert/iOS でも成立する)。
- migration 20260716000004: stories/tasks/epics/custom_statuses/swimlanes の position DEFAULT を per-table sequence 化(setval = 既存 max+1、owned by で列に紐付け、authenticated/service_role に usage grant)。backlog_dividers は除外(insert_board_item が placeholder 0 + 同一 tx で splice、stories と position 空間を共有)。
- TS 側 6サイトの read+nextPosition 削除(epics createEpic / board quickCreateStory 非backlog・quickCreateStoryFree / stories addTask / settings createCustomStatus・createLane)。lib/utils/stories.ts の nextPosition と単体テストは dead につき削除。
- generate_recurring_stories: ロックなし max+1 を削除(20260709000008 のテキストから position 割当のみ除去)。
- move_story_to_project / copy_story_to_project も sequence に寄せた。advisor は当初「20260711000001:84 でロック済みにつき触らない」としたが、現行定義は 20260715000001_archive_favorites.sql(:74/:208)による上書きで、取得ロックは story_number: のみ(positions: ではない)。sequence と max+1 が併存すると max+1 が sequence frontier を追い越して衝突しうるため、割当元を sequence 1本に統一(advisor が前回判定を撤回し 2a に含めることを指示)。copy の tasks コピーは既存順序の複製=rewrite なので明示 position のまま。
- 結果: repo-wide で stories.position の max+1 残存ゼロ(ライブ3関数を pg_get_functiondef で確認済み)。
検証: supabase db reset で空DBから全migration適用 → 全506 pass(統合込み、SUPABASE_INTEGRATION=1)、tsc 0、eslint 0。move-copy 統合テストに着地位置の assert(具体値でなく順序)を追加し、関数を position=0 に細工して落ちること(expected 50 to be less than 0)を確認済み。database.types.ts は再生成不要(position は既に default 有りで Insert 型は optional のまま)。
REMAINING: item 3(不変条件 doc + deferrable UNIQUE)、item 3d(zone 述語 canonical)、item 4(create_project RPC)、item (c)(guard helper 抽出)。
<!-- SECTION:NOTES:END -->
