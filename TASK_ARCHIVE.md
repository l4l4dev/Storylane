# Storylane — Completed Task Archive

Completed sections moved out of `TASK.md` (2026-07-02) to keep the active task
list small. Read this file only when you need the history of a finished task.
The pending iOS portions of Tasks 6 / 7 / 9 remain in `TASK.md`.

---

## Task 1 — Repository & Project Setup ✅

- [x] Initialize monorepo structure (`apps/web`, `apps/ios`, `supabase`)
- [x] Set up Next.js project in `apps/web` with TypeScript and Tailwind CSS
- [x] Set up Xcode project in `apps/ios` with SwiftUI
- [x] Add `supabase-swift` Swift Package to iOS project
- [x] Install and configure Supabase CLI
- [x] Verify local Supabase starts correctly with `supabase start`

---

## Task 2 — Database: Migrations & RLS ✅

- [x] Create migration: `profiles`
- [x] Create migration: `projects` + `project_members`
- [x] Create migration: `epics` + `labels` + `story_labels`
- [x] Create migration: `iterations`
- [x] Create migration: `stories` + `tasks`
- [x] Create migration: `comments` + `activity_logs`
- [x] Create migration: `integrations`
- [x] Write RLS policies for all tables (see SPEC.md for guidelines)
- [x] Verify all policies locally with `supabase db reset`

---

## Task 3 — Authentication ✅

### Web ✅
- [x] Set up Supabase Auth client (`lib/supabase/`)
- [x] Implement GitHub OAuth login page (`/auth/login`)
- [x] Implement Google OAuth login
- [x] Handle session persistence with `@supabase/ssr`
- [x] Redirect unauthenticated users to `/auth/login`
- [x] Auto-create `profiles` row on first sign-in

### iOS ✅
- [x] Set up `SupabaseClient.swift`
- [x] Implement GitHub OAuth sign-in
- [x] Implement Google OAuth sign-in
- [x] Persist session across app launches
- [x] Auto-create `profiles` row on first sign-in

---

## Task 4 — Project Management ✅

### Web ✅
- [x] Project list page (`/dashboard`)
- [x] Create project modal (name, description, iteration length, point scale)
- [x] Project settings page (`/projects/[id]/settings`)
  - [x] Edit project details
  - [x] Invite members by email
  - [x] Change member roles
  - [x] Remove members

### iOS ✅
- [x] `ProjectListView` — list of projects on launch
- [x] Create project sheet
- [x] Project settings screen

---

## Task 5 — Backlog & Stories ✅

### Web ✅
- [x] Backlog page (`/projects/[id]/backlog`)
- [x] Story card component with type badge and state indicator
- [x] Create story panel (title, type, points, assignee, labels, epic)
- [x] Story detail page/modal (`/stories/[id]`)
- [x] Edit and delete story
- [x] Drag-and-drop reordering (update `position` field)
- [x] Filter backlog by type / label / assignee

### iOS ✅
- [x] `BacklogView` — scrollable story list
- [x] `StoryDetailView` — full story detail
- [x] `StoryEditView` — create and edit story
- [x] Swipe actions for quick state changes

---

## Task 6 — Iterations（Web 部分）

> **Note (2026-07-02)**: Task 6 の手動運用（「Generate next iteration」/「Mark as done」ボタン、
> ボタン駆動の自動アサイン）は Task 12.5 の自動スケジューリング + 自動ロールオーバーに置き換える
> （本家 Pivotal Tracker との乖離調査に基づく。see spec/velocity.md）。

### Web ✅
- [x] Iteration + backlog board on the merged `/projects/[id]/board` page (iterations stacked
      above the unassigned backlog, drag-and-drop between them; superseded the standalone
      `/iterations` route, merged 2026-07-01 to match Pivotal Tracker's actual UX)
- [x] Auto-generate next iteration based on `iteration_length`
- [x] Auto-assign stories from backlog up to current velocity
- [x] Display current iteration on project home (`/projects/[id]`)
- [x] Sprint goal input
- [x] Manual story move between iterations (drag-and-drop across iteration/backlog sections)
- [x] Mark iteration as done → finalize velocity

---

## Task 7 — Epics & Labels（Web 部分）

### Web ✅
- [x] テスト基盤: `@testing-library/react` + jsdom を導入（CLAUDE.md のコンポーネントテスト規約を満たす。以降のコンポーネントは Testing Library でテストを書く）
- [x] Epic list page (`/projects/[id]/epics`)
- [x] Create / edit / delete epic with color picker
- [x] Epic progress bar (accepted stories / total stories)
- [x] Label management in project settings
- [x] Apply multiple labels to a story

---

## Task 8 — Velocity Calculation ✅

- [x] Implement velocity calculation logic (see SPEC.md)
  - Average accepted points across last `velocity_window` completed iterations
  - Exclude `chore` and `release` story types
- [x] Store finalized velocity on iteration completion
- [x] Display current velocity on project home and iteration views
- [x] Use velocity for auto-assignment in Task 6

---

## Task 9 — Collaboration: Comments & Activity（DB・Web 部分）

### 前提（DB — Web 実装の前に行う）✅
- [x] Migration: `profiles.username`（unique）を追加 — 初回サインイン時に自動生成し、@mention のパース対象にする（see spec/data-model.md）
- [x] Migration: `activity_logs` 自動記録トリガー — stories / comments の INSERT・UPDATE を Postgres トリガーで記録
      （`story.created` / `story.state_changed` / `comment.added` 等。Web・iOS・Edge Function 全経路を一箇所でカバーする）

### Web ✅
- [x] Username 変更 UI（プロフィール設定）
- [x] Comment thread on story detail page
- [x] @mention support (parse `@username` in comment body)
- [x] Activity log timeline on project home

---

## Task 11 — Realtime Collaboration（Web ✅ 2026-07-07 移設）

> 順序変更（2026-07-02）: Task 10（通知）より先、Task 12.5（board 再構築）の後に実施。

- [x] Subscribe to story changes via Supabase Realtime on backlog and iteration views
- [x] Reflect story state changes live without page refresh
- [x] Show live comment updates on story detail

---

## Task 10 — Notifications（Web ✅ 2026-07-07 移設）

> 通知のイベント源は Task 11 の Realtime 購読（購読したイベントから Notification API を発火）。

- [x] Request browser notification permission on sign-in
- [x] Trigger notification on: assigned to story, @mentioned, story state changed
      （`lib/utils/notifications.ts` の純関数 + `useNotificationsRealtime`
      〈`lib/supabase/realtime.ts`〉+ `NotificationListener`〈root layout に配置〉。
      既知の簡略化: 自分自身の操作による変更も通知される — actor 判定は行っていない）

---

## Task 12 — Integrations（Web ✅ ローカル検証まで 2026-07-07。本番 Webhook 実検証は Backlog TASK-3）

### 前提（DB）
- [x] Migration: `stories.number`（プロジェクト毎の連番、採番トリガー + UPDATE 不変ピン）
      （see spec/data-model.md。service_role への DML grant 漏れも `20260707000006` で修正）
- [x] ストーリーカード / 詳細画面に `#123` を表示

### GitHub / Forgejo
- [x] Integration setup in project settings（owner 専用、コピー用 Webhook URL 表示付き
      `integration-settings.tsx`）
- [x] Edge Function `supabase/functions/git-webhook/`（HMAC-SHA256 署名検証・timing-safe 比較・
      `verify_jwt = false`。Forgejo は `X-Gitea-Event` / `X-Gitea-Signature`〈プレフィックスなし HMAC〉で判別）
- [x] Parse PR title / branch name for story ID（`[SL-123]` / `storylane/123`）
- [x] PR マージで story を `finished` に強制遷移 + iteration 未所属なら current へ
      （決定事項は spec/integrations.md）

### Slack
- [x] Integration setup（Incoming Webhook URL）
- [x] story state change / iteration start・done を通知（Edge Function 案から変更し
      server action から直接 POST — `after()` + `lib/integrations/slack.ts`、fire-and-forget。
      owner 専用の integrations 行は `lib/supabase/admin.ts`〈service role〉で読む）

---

## Task 12.5 — Pivotal Tracker UX Parity（Web ✅ 2026-07-07 移設）

> 2026-07-02 の本家乖離調査に基づく修正。仕様は spec/screens.md / spec/features.md /
> spec/velocity.md。Task 6 の手動 iteration 運用をここで置き換えた。

### 前提（DB）
- [x] Migration: `stories.state` に `'unscheduled'`（Icebox）を追加、新規デフォルトに
- [x] Migration: 未来の `planned` iteration 行を削除し、ストーリーを backlog 先頭へ相対順維持で戻す

### Web
- [x] Board をマルチパネル横並びレイアウトに再構築（Current / Backlog / Icebox / Done / Epics）
- [x] Icebox パネル（Backlog へドラッグで unstarted に昇格）
- [x] カード上のワンクリック状態遷移ボタン（次の有効な遷移のみ提示するステートマシン
      `lib/utils/story-state.ts`。詳細画面の自由な state select は廃止）
- [x] velocity に基づく Backlog 自動分割（「Generate next iteration」廃止）
- [x] 自動ロールオーバー（end_date 経過後の初回アクセスで確定。「Mark as done」廃止）
- [x] ストーリー詳細のパネル内インライン展開（`/stories/[id]` はディープリンク用に残す）
- [x] ポイントを point scale からの選択式に / 未見積もり feature は Start 不可
- [x] `release` ストーリーのマイルストーンマーカー行 / accepted の緑背景 /
      カード全体ドラッグ / ポイントのドット表示（3以下）
- [x] タスク（チェックリスト）UI

---

## Task 14 — Custom Workflow Modes（Web ✅ 2026-07-07、コミット f57f362）

> スコープ決定（オーナー確定）: Free モードは iteration/velocity なしの純 Trello ボード。
> points は任意入力の表示のみ。モードは作成時固定。custom status に is_done フラグ。
> ※ 2026-07-07 の要件改訂で「Pivotal モード」は「Tracker モード」に改名（Backlog TASK-4）。

- [x] DB: `projects.workflow_mode` + `custom_statuses`（migration、RLS、
      `stories.custom_status_id` は複合FKでクロスプロジェクト参照を防止）
- [x] プロジェクト作成ダイアログにモード選択（作成後変更不可）
- [x] board のモード分岐（Free ＝ DB 駆動カラムのカンバンのみ、iteration UI なし）
- [x] Free 用ドラッグ（任意ステータス間の移動を許可、`evaluateDrop` とは別ルート）
- [x] Settings にステータス管理 UI（Free のみ表示）
- [x] tsc / eslint / vitest / build 通過、ブラウザ実機確認、spec 更新

---

## Task 15 — Board List View（Web ✅ 2026-07-07 移設）

> 本家 Pivotal の「Current + Backlog が1本の縦リスト」体験の復元。実装は Sonnet 5。
> スコープ外（着手しない）: リリース目標日の遅延警告 / ストーリーテンプレート。

- [x] List / Kanban 表示切替（後に List を既定に変更、Kanban は current iteration のみに縮小）
- [x] `board-list-view.tsx` / `story-list-row.tsx`（状態はバッジ、行にワンクリック遷移ボタン）
- [x] ゾーン DnD（`zoneForStory` / `evaluateListDrop`、Kanban 用ロジックは無改変）
- [x] 自由な区切り: `backlog_dividers`（note / iteration_break、migration + RLS レビュー済み、
      `buildBacklogRows`、Realtime 購読は `useProjectBoardRealtime` に統合）
- [x] ホバー挿入 UI（行間に + Note / + Iteration break）
- [x] Icebox を独立サイドカラム化 / Add Story をヘッダー内テキストリンク化
- [x] spec/screens.md・spec/data-model.md 更新、vitest テスト
- ※ 区切り表示は 2026-07-07 要件改訂でグループヘッダー方式に刷新予定（Backlog TASK-9）

---

## Task 13 — Polish & QA（Web ✅ 2026-07-07、Backlog TASK-2 で管理・完了）

> スコープは 3 項目に絞ることを オーナー確認済み（レスポンシブ / a11y 監査 /
> パフォーマンスレビューは対象外 — 残スコープは TASK.md 参照）。詳細な実装ノートと
> 検証結果は `backlog task view TASK-2 --plain`。

- [x] 全ビューのエラー・空状態（`error-state.tsx` + 各ルート `error.tsx`、board の空状態）
- [x] ローディングスケルトン（`skeleton.tsx` + 7ルートの `loading.tsx`）
- [x] Playwright E2E（create project → add story → complete iteration、`e2e/core-flow.spec.ts`）
- [x] dnd-kit hydration 警告修正（`DndContext` に安定 id）
