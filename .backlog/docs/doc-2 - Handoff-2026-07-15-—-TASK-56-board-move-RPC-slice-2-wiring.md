---
id: doc-2
title: 'Handoff 2026-07-15 — TASK-56 board move RPC (slice 2: wiring)'
type: other
created_date: '2026-07-15 13:25'
updated_date: '2026-07-15 13:25'
---
Session handoff for TASK-56 (transactional board move/reorder). Written 2026-07-15.

## いま完了していること（コミット済み）

- **TASK-63**（`49e11d7`）: `integrations.webhook_secret` をクライアント読み取りから遮断。DONE。
- **TASK-56 slice 1**（`fba64ef`）: `move_story_board` RPC の DB 基盤。migration `20260715000008_move_story_board.sql`、統合テスト `apps/web/lib/utils/move-story-board.integration.test.ts`（7件パス）、grant-lockdown allowlist 追記、DB 型再生成。
  - rls-security-reviewer が cross-tenant バグ（divider 分岐に project 所有権チェック無し）を検出 → 修正済み＋回帰テスト追加。
  - **未 push**（push は指示があるまでしない方針）。作業ツリーはクリーン。

## TASK-56 の残作業（slice 2 以降 — これが次セッションの本題）

新 RPC `move_story_board` はまだ**どこからも呼ばれていない**（追加のみ・挙動変化なし）。残りは配線とクライアント書き換え:

1. **server actions を薄いラッパに**（`apps/web/app/projects/[id]/board/actions.ts`）
   - `dropStory` / `dropStoryFree` / `setStoryFocus` / `dropStoryInList` を `move_story_board` 呼び出しに置換。
   - **evaluateDrop/evaluateListDrop/evaluateFocusDrop の検証はサーバ側（action 内）に維持**（セキュリティ。クライアントを信頼しない）。action が read → validate → deltas + expected snapshot（state/iteration_id/custom_status_id/swimlane_id/focus）+ anchor を計算し RPC を呼ぶ。
   - RPC が返す stale（Postgres errcode `P0001`、message に "stale"）を捕捉 → クライアントに「refresh してね」の可視エラー（既存の `MutationErrorBanner` パターン、ux-principles #2）。
   - `iteration='current'` は**具体 id を渡さず** deltas に `{iteration:'current'}` を入れる（RPC が lock 内で再解決）。

2. **クライアント drag ハンドラ4つを書き換え**（`ordered_ids` 全列 → `anchor + expected` 送信）
   - `apps/web/components/features/board/kanban-columns-board.tsx`（dropStory / tracker）
   - `apps/web/components/features/board/free-board.tsx`（dropStoryFree / free）
   - `apps/web/components/features/board/focus-board.tsx`（setStoryFocus / focus）
   - `apps/web/components/features/board/board-list-view.tsx`（dropStoryInList / list、divider 移動もここ）
   - **anchor の作り方**: dnd の active/over から「moved を除いた並びで moved が直前に来る隣接アイテムの id（＋ kind）」を渡す。末尾なら anchor 省略（`{}`）。既存 `createBacklogDivider` の `before_item_id`（`"story:<id>"` / `"divider:<id>"`）と同じ発想。
   - **expected snapshot**: クライアントが今表示している story の state/iteration_id/custom_status_id/swimlane_id/focus をそのまま送る（optimistic UI 用に既に手元にある想定。無ければ props を確認）。
   - 各コンポーネントに `*.test.tsx` があるので、送信 payload の形が変わる → テストも更新。

3. **persistBacklogOrder に同一 advisory lock**（`board/actions.ts:541`）
   - 移行期は `createBacklogDivider` がまだ `persistBacklogOrder`（全列書き）を使う。TASK-51 完了までの間、この経路も `pg_advisory_xact_lock(hashtext('positions:'||project_id))` 内で走らせて共有列 race を残さない。plpgsql RPC 化 or `select pg_advisory_xact_lock(...)` を先に叩く小 RPC を挟む。**advisor（設計時）が「移行期は同一 lock で」と明示**。

4. **失敗パス/競合テスト（action 層）** — AC#4。mid-flight 失敗・競合 drag を action 経由で。RPC 層は slice 1 で済（competing/stale はテスト済み）。

## RPC 署名（slice 1 で確定・変更しないこと）

```
move_story_board(
  p_project_id uuid,
  p_item jsonb,      -- {kind:'story'|'divider', id:uuid}
  p_view text,       -- 'tracker' | 'free' | 'focus' | 'list'
  p_expected jsonb,  -- {state, iteration_id, custom_status_id, swimlane_id, focus}（divider は {} 可）
  p_deltas jsonb,    -- {state?, iteration?('current'|'none'), custom_status_id?, swimlane_id?, focus?}（divider は {}）
  p_anchor jsonb     -- {before:{kind,id}} で直前挿入、省略/`{}` で末尾
)
```

- ゾーン導出は RPC が deltas 適用後の story カラムから行う（`p_view` は tracker/free/focus/list の弁別のみ）。
- tracker の物理カンバンは state 列のみ（backlog/icebox は list 経由）。cross-view の position 整合性は **TASK-58 スコープ**（今回触らない）。

## 設計の確定事項（再導出不要）

- **advisor（Opus, 2026-07-15）承認済み**。判定は TASK-56 の plan / notes に記録済み。要点: 単一 RPC / TS の zone predicate は渡さない（TOCTOU）/ expected は全 zone 決定カラム / current は lock 内再解決（finalize と同一 lock）/ backlog は `_resequence_backlog` に集約し TASK-51 と共有 / persistBacklogOrder は移行期同一 lock。
- 関連: TASK-51（insert 側 RPC、`_resequence_backlog` を共有）→ TASK-57（swap）→ TASK-58（制約・invariants）の順。

## 検証コマンド

```
# ローカル Supabase 起動＆最新 migration
supabase db reset          # ← slice 1 の RPC 修正を反映するのに一度実行済み。以後は migration up で可

# RPC 層テスト（slice 1）
cd apps/web && SUPABASE_INTEGRATION=1 pnpm exec vitest run lib/utils/move-story-board.integration.test.ts

# コミット前フル
cd apps/web && pnpm exec tsc --noEmit && pnpm lint && SUPABASE_INTEGRATION=1 pnpm test
```

## 環境メモ

- モデル: TASK-56 は `@claude-opus-4-8` 担当（アーキ依存）。現行セッションが Opus 4.8 なら切替不要。
- 秘密情報・オーナー個人名は git 管理物に書かない（repo は public）。
- Fable 5 は sunset 済み → advisor は Opus 4.8 で実行する。
