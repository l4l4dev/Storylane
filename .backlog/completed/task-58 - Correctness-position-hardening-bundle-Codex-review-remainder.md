---
id: TASK-58
title: Correctness & position hardening bundle (Codex review remainder)
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:12'
updated_date: '2026-07-16 15:42'
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
- [x] #3 Position ordering invariant documented and DB-enforced where feasible
- [x] #4 Project creation is all-or-nothing including default statuses
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

2a FIX + promote fix (Opus 4.8, 2026-07-16) — commits 2933740, 9f49adb:
- 2a の不変条件は誤りだった(訂正版): 「密化ライターも sequence を消費」ではなく「**全 INSERT が sequence を消費する**」が正しい条件。密化が書くのは rank 0..n-1 のみで max rank < 行数、全 INSERT が消費すれば 行数 ≤ frontier、ゆえに rank < frontier。rewrite(_splice_backlog/move_story_board/swap_adjacent)側は書き直し不要。
- 実バグは「消費しない INSERT」が4経路残っていたこと: insert_board_item(story/divider とも explicit position 0)、backlog_dividers.position の default 0(stories と order 空間共有なので同一 sequence を消費させる必要)、dashboard の FREE_TEMPLATE_STATUSES(explicit 0..4 → 2b の UNIQUE 下では制約違反になる予備軍)、promote のループ insert(explicit X..X+k-1)。
- migration 20260716000005: 上記を全て default 経由に。全5 sequence を greatest(max(position), 行数)+1 に再基準化(2a の max+1 のみは複数ゾーン密化時に不足)。
- migration 20260716000006(promote): (1) positions lock を story_number lock より前に取得(assign_story_number トリガーが全 stories INSERT で story_number を取るため、insert_board_item の実効順は positions→story_number。逆順は AB-BA デッドロック)、(2) shift を backlog_dividers にも適用 = **2a 以前から存在した既存バグ**(k≥2 で divider 直前の story が divider を飛び越える。実機再現 'expected 3 to be less than 2')、(3) delete 後に project 全体を (position,id) rank で単調 compaction(単調写像は任意部分集合の順序を保存するのでゾーン述語不要、既存の膨張・重複も自己修復)。
- probe 再現手順(2a のバグ): fresh project に insert_board_item ×5 → positions {0,1,2,3,4} なのに stories_position_seq.last_value が不動。→ 密化された zone に後から default insert すると中央着地・position 衝突。
- テスト設計の教訓: 「密化 zone より上に着地する」assert は sequence が偶然高いと無条件に通る(実際それで見逃した)。frontier は **2つの probe の差分**で測ること(position-sequence.integration.test.ts)。sabotage で落ちることを確認済み。
検証: db reset で空DBから全migration適用 → 511 pass(統合込み)、tsc 0、eslint 0。
REMAINING: 2b(不変条件 doc + deferrable UNIQUE)、item 3d(zone 述語 canonical)、item 4(create_project RPC)、item (c)(guard helper 抽出)。2b の spec 文言は訂正版の不変条件で書くこと。

SLICE 2b done (Opus 4.8, 2026-07-16) — AC#3(不変条件 doc + DB 制約)+ item 3d(zone 述語 canonical):
- migration 20260716000007: custom_statuses/swimlanes/epics に UNIQUE(project_id,position)、tasks に UNIQUE(story_id,position)、全て DEFERRABLE INITIALLY DEFERRED(swap_adjacent 等の mid-statement 衝突を commit で解消)。制約付与前に per-scope で (position,id) 順に resequence(promote 産の position=0 群・旧 max+1 race の重複を解消。単調 remap なので既存順序保存)。stories/backlog_dividers は zone スコープ+2テーブル共有につき単純 UNIQUE 不可で対象外。
- spec/data-model.md に『Position ordering invariant』節を追加(訂正版の不変条件: 全 INSERT が sequence を消費 / rewrite は rank<n しか書かない / 上方向 shift 禁止、copy_story_to_project の task コピーのみ例外)+『Backlog zone predicate (canonical)』節(item 3d: canonical は DB の _splice_backlog、move_story_board/buildBacklogRows/kanban.ts zoneForStory は mirror)。
- 冗長だった 005 の stories_position_seq 再 grant を1行削除(004 で既出、rls-security-reviewer が無害と確認)。
- 既存テスト削除: swap-adjacent の『normalises a pre-existing duplicate-position state』は UNIQUE 制約で二重 position が表現不能になり前提消滅。dense-rewrite 自体は通常の swap テストがカバー。
- 追加テスト: position-sequence.integration.test.ts に UNIQUE 違反(23505)の検証。
検証: db reset で空DBから全 migration 適用 → 511 pass(統合込み)、tsc 0、eslint 0。deferrable UNIQUE 下で swap_adjacent の full-zone rewrite が通ることを実機確認(A,B,C→B,A,C)。rls-security-reviewer で 005/006/007 をレビュー → 穴なし(has_function_privilege/relrowsecurity/grant-lockdown allowlist を実測突合)。
REMAINING: item 4(create_project transactional RPC = AC#4)、item (c)(guard helper 抽出: require_project_role/current_iteration/_assert_not_last_owner)。

ITEM 4 done (Opus 4.8, 2026-07-16) — AC#4(project 作成の all-or-nothing):
- migration 20260716000008: create_project(p_name, p_iteration_length, p_point_scale, p_velocity_window, p_workflow_mode, p_statuses jsonb, p_description default null) returns uuid。projects insert + free テンプレ custom_statuses insert を1トランザクションに。SECURITY INVOKER(handle_new_project トリガーが同一tx内で作成者を owner 登録 → STABLE project_role が custom_statuses INSERT policy でそれを見る)。position は省略で sequence default(2a 不変条件)、jsonb_array_elements WITH ORDINALITY + order by ord で配列順保存。
- invite ループは advisor 指示どおり TS に残置(AC は statuses までの atomicity、招待失敗で project ごと巻き戻すのは UX 劣化)。?invite_failed=N 挙動を保存。
- dashboard/actions.ts: 2回の insert を supabase.rpc('create_project') 1発に。p_description は description ?? undefined(生成型が optional)。redirect の project.id 参照を projectId に更新。
- database.types.ts 再生成(create_project 追加)。grant-lockdown allowlist に create_project 追加。
- テスト: create-project.integration.test.ts(owner 登録・テンプレ順序・空 statuses で0列・不正 status で project ごと rollback=atomicity)。dashboard/actions.test.ts を rpc('create_project')→rpc('invite_member') の新コールシェイプに書き換え + free/tracker で p_statuses が渡る/空になる検証を追加。
- jsonb_to_recordset + WITH ORDINALITY は 42601 syntax error になるため jsonb_array_elements WITH ORDINALITY に変更(実機で確認)。
検証: db reset で全 migration 適用 → 515 pass(統合込み)、tsc 0、eslint 0。rls-security-reviewer で穴なし(SECURITY INVOKER の妥当性・grant・v_project_id が caller 入力でないこと等を実機 has_function_privilege で確認)。
REMAINING: item (c)(guard helper 抽出: require_project_role/current_iteration/_assert_not_last_owner)のみ。

ITEM (c) done (Opus 4.8, 2026-07-17) — guard helper 抽出(漸進採用):
- advisor 判定で『全 ~12 関数一括再emit』は却下 → 漸進採用。2方言は意味的に等価で現在 privilege hole は無く、一括再emit は挙動修正ゼロで transcription risk だけ買う。
- migration 20260717000001: require_project_role(project_id, variadic roles)[SECURITY INVOKER、project_role に委譲するので権限不要]、assert_not_last_owner(project_id, user_id)[SECURITY DEFINER、owner を RLS フィルタ無しで数える必要]。両者 revoke from public,authenticated(内部 helper、呼び手は全て DEFINER)。
- 変換したのは membership RPC 3本のみ(_assert_not_last_owner 抽出でどのみち再emit する family): change_member_role(owner gate→require_project_role + demotion 時 assert_not_last_owner)、remove_member(assert_not_last_owner のみ。self-leave 許容の bespoke guard は require_project_role で表現不可のため維持)、invite_member(owner gate→require_project_role = 2つ目の実 caller)。3本とも 20260715000004 のテキストから verbatim コピー、guard 行のみ差替(記憶で書かない)。
- 他 ~10 RPC の inline 方言は残置。spec/rls.md に規則追記: 新規 SECURITY DEFINER RPC の role guard は require_project_role を使う/inline coalesce・null 判定を書かない/既存は次に触る時に変換/plain role-list でない guard(remove_member self-leave 等)は bespoke のまま。
- current_iteration(id 版)は今回不実施: 採用に move_story_board(~160行)と finish_story_from_git の全文再emit が必要で、5行 select の共通化に danger zone 2本書き写すのは割に合わない。発動条件=次にどちらかの関数を実質変更する時にその migration 内で抽出。finalize/skip の record+rollover 版は形が違うので統合しない(抽象の捏造回避)。
- エラーメッセージ変更: change_member_role/invite_member の owner gate が 'not authorized'(42501)に統一、last-owner が 'Cannot demote or remove the last owner'(demote/remove 統合)に。TS 依存を grep 済み → membership.integration:176 を /not authorized/i に更新(他に文字列依存なし)。
- 追加テスト: 'a non-owner cannot invite members'(invite_member の owner gate 直接検証。rls-reviewer 指摘のカバレッジ隙を解消。guard 除去で落ちること実機確認済み)。
検証: db reset で全 migration 適用 → 516 pass(統合込み)、tsc 0、eslint 0。helper の prosecdef/auth_exec を実測(require_project_role=invoker/exec不可、assert_not_last_owner=definer/exec不可)。rls-security-reviewer で穴なし(旧新の関数本体を difflib で機械 diff、guard 差替のみで他無変更を確認)。
TASK-58 完了: AC#1-4 全達成 + review add-on(activity_logs index / guard helper / zone canonical doc)完了。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardening bundle complete across five slices (Opus 4.8, 2026-07-16/17): zero-row mutation guards repo-wide; position allocation moved to per-table sequences with the corrected all-INSERTs-consume invariant (+ promote shift/deadlock fixes); invariant documented in spec/data-model.md with deferrable UNIQUE constraints and the canonical backlog-zone predicate; atomic create_project RPC; activity_logs(story_id) index; require_project_role/assert_not_last_owner guard helpers with incremental adoption rule in spec/rls.md. Verified per slice with full-migration db reset, 516 tests incl. integration, and rls-security-reviewer passes.
<!-- SECTION:FINAL_SUMMARY:END -->
