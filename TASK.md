# Storylane — Phase 1 Task List

Implementation tasks for Phase 1. Work through them in order.
Each task should be completed with tests before moving to the next.

Reference `SPEC.md` for data models, RLS policies, and feature details.

## 開発順序方針（2026-07-01 変更）

**Web を全タスク実装し終えてから iOS に着手する。**
理由: Web で仕様変更が発生することがあり、Web 実装を先に安定させてから iOS を実装する方が手戻りを最小化できる。
Tasks 6〜13 は Web → iOS の順で進める。

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

## Task 6 — Iterations

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

### iOS（Web 全タスク完了後に着手）
- [ ] `IterationsView` — list of iterations
- [ ] Current iteration detail with story list
- [ ] Sprint goal display and edit

---

## Task 7 — Epics & Labels

### Web ✅
- [x] テスト基盤: `@testing-library/react` + jsdom を導入（CLAUDE.md のコンポーネントテスト規約を満たす。以降のコンポーネントは Testing Library でテストを書く）
- [x] Epic list page (`/projects/[id]/epics`)
- [x] Create / edit / delete epic with color picker
- [x] Epic progress bar (accepted stories / total stories)
- [x] Label management in project settings
- [x] Apply multiple labels to a story

### iOS（Web 全タスク完了後に着手）
- [ ] `EpicsView` — epic list with progress
- [ ] Label picker in story edit screen

---

## Task 8 — Velocity Calculation ✅

- [x] Implement velocity calculation logic (see SPEC.md)
  - Average accepted points across last `velocity_window` completed iterations
  - Exclude `chore` and `release` story types
- [x] Store finalized velocity on iteration completion
- [x] Display current velocity on project home and iteration views
- [x] Use velocity for auto-assignment in Task 6

---

## Task 9 — Collaboration: Comments & Activity

### 前提（DB — Web 実装の前に行う）✅
- [x] Migration: `profiles.username`（unique）を追加 — 初回サインイン時に自動生成し、@mention のパース対象にする（see spec/data-model.md）
- [x] Migration: `activity_logs` 自動記録トリガー — stories / comments の INSERT・UPDATE を Postgres トリガーで記録
      （`story.created` / `story.state_changed` / `comment.added` 等。Web・iOS・Edge Function 全経路を一箇所でカバーする）

### Web ✅
- [x] Username 変更 UI（プロフィール設定）
- [x] Comment thread on story detail page
- [x] @mention support (parse `@username` in comment body)
- [x] Activity log timeline on project home

### iOS（Web 全タスク完了後に着手）
- [ ] Comment list and input on `StoryDetailView`
- [ ] Activity log screen

---

## Task 11 — Realtime Collaboration

> **順序変更（2026-07-02）**: Task 10（通知）より先に実施する。
> ブラウザ通知のトリガーは Realtime のイベント購読が前提のため（番号は既存参照を壊さないよう維持）。

- [ ] Subscribe to story changes via Supabase Realtime on backlog and iteration views
- [ ] Reflect story state changes live without page refresh
- [ ] Show live comment updates on story detail

---

## Task 10 — Notifications（Task 11 の後に実施）

> 通知のイベント源は Task 11 で導入する Realtime 購読を使う（購読したイベントから Notification API を発火する）。

### Web
- [ ] Request browser notification permission on sign-in
- [ ] Trigger notification on: assigned to story, @mentioned, story state changed

### iOS（Web 全タスク完了後に着手）
> **保留（当面なし）**: iOS プッシュ通知(APNs)は当面実装しない（シミュレータのみで開発するため）。
> APNs には Apple Developer Program（有料・$99/年）が必要。実装する場合はその登録後に着手する。
> それまでは Web のブラウザ通知のみを提供する。

- [ ] Register for push notifications (APNs)
- [ ] Handle notification payloads
- [ ] Trigger push on: assigned to story, @mentioned, story state changed

---

## Task 11.5 — Deployment（Task 12 の前に実施）

> Task 12 の Webhook 検証には公開 URL（デプロイ済み Edge Function）が必要なためここで行う。
> アカウント・手順の詳細は `ACCOUNT_SETUP.md`（gitignore 済み・個人用メモ）を参照。秘密情報はコミットしない。

- [ ] Supabase hosted プロジェクトへ migration を適用（`supabase db push`）
- [ ] Vercel へ Web をデプロイ（Root Directory `apps/web`、Node 22、環境変数設定）
- [ ] 本番 URL を Supabase の Site URL / Redirect URLs と OAuth 設定に追加
- [ ] 本番環境でログイン → プロジェクト作成 → ボード操作の疎通確認

---

## Task 12 — Integrations

### 前提（DB — Web 実装の前に行う）
- [ ] Migration: `stories.number`（プロジェクト毎の連番、採番トリガー）を追加（see spec/data-model.md）
- [ ] ストーリーカード / 詳細画面に `#123` を表示（PR タイトルに書けるようにする）

### GitHub
- [ ] Integration setup in project settings (repo URL, webhook secret)
- [ ] Supabase Edge Function to receive GitHub webhook
- [ ] Parse PR title / branch name for story ID (e.g. `[SL-123]` — `stories.number` ベース)
- [ ] Auto-update story state to `finished` on PR merge

### Slack
- [ ] Integration setup in project settings (Incoming Webhook URL)
- [ ] Notify on: story state change, iteration start/done
- [ ] Edge Function to POST to Slack

### Forgejo
- [ ] Reuse GitHub webhook handler（ペイロードは GitHub 互換だがヘッダー・署名が異なる:
      `X-Gitea-Event` / `X-Gitea-Signature`、HMAC 形式差に注意 — see spec/integrations.md）
- [ ] Integration setup in project settings

---

## Task 13 — Polish & QA

### Web
- [ ] Error states and empty states for all views
- [ ] Loading skeletons on data-fetching screens
- [ ] Responsive layout (mobile and desktop)
- [ ] Accessibility audit (keyboard navigation, screen reader labels)
- [ ] Playwright を導入し、コアフローの E2E テストを作成（create project → add story → complete iteration）
- [ ] Performance review (query optimization, Realtime subscription cleanup)

### iOS（Web 全タスク完了後に着手）
- [ ] Error states and empty states for all views
- [ ] Loading indicators on data-fetching screens
- [ ] Accessibility audit (VoiceOver labels, Dynamic Type)
- [ ] Performance review (query optimization, Realtime subscription cleanup)
