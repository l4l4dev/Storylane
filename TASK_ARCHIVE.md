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
