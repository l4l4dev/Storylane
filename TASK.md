# Storylane — Phase 1 Task List

Implementation tasks for Phase 1. Work through them in order.
Each task should be completed with tests before moving to the next.

Reference `SPEC.md` for data models, RLS policies, and feature details.

---

## Task 1 — Repository & Project Setup

- [ ] Initialize monorepo structure (`apps/web`, `apps/ios`, `supabase`)
- [ ] Set up Next.js project in `apps/web` with TypeScript and Tailwind CSS
- [ ] Set up Xcode project in `apps/ios` with SwiftUI
- [ ] Add `supabase-swift` Swift Package to iOS project
- [ ] Install and configure Supabase CLI
- [ ] Verify local Supabase starts correctly with `supabase start`

---

## Task 2 — Database: Migrations & RLS

- [ ] Create migration: `profiles`
- [ ] Create migration: `projects` + `project_members`
- [ ] Create migration: `epics` + `labels` + `story_labels`
- [ ] Create migration: `iterations`
- [ ] Create migration: `stories` + `tasks`
- [ ] Create migration: `comments` + `activity_logs`
- [ ] Create migration: `integrations`
- [ ] Write RLS policies for all tables (see SPEC.md for guidelines)
- [ ] Verify all policies locally with `supabase db reset`

---

## Task 3 — Authentication

### Web
- [ ] Set up Supabase Auth client (`lib/supabase/`)
- [ ] Implement GitHub OAuth login page (`/auth/login`)
- [ ] Implement Google OAuth login
- [ ] Handle session persistence with `@supabase/ssr`
- [ ] Redirect unauthenticated users to `/auth/login`
- [ ] Auto-create `profiles` row on first sign-in

### iOS
- [ ] Set up `SupabaseClient.swift`
- [ ] Implement GitHub OAuth sign-in
- [ ] Implement Google OAuth sign-in
- [ ] Persist session across app launches
- [ ] Auto-create `profiles` row on first sign-in

---

## Task 4 — Project Management

### Web
- [ ] Project list page (`/dashboard`)
- [ ] Create project modal (name, description, iteration length, point scale)
- [ ] Project settings page (`/projects/[id]/settings`)
  - [ ] Edit project details
  - [ ] Invite members by email
  - [ ] Change member roles
  - [ ] Remove members

### iOS
- [ ] `ProjectListView` — list of projects on launch
- [ ] Create project sheet
- [ ] Project settings screen

---

## Task 5 — Backlog & Stories

### Web
- [ ] Backlog page (`/projects/[id]/backlog`)
- [ ] Story card component with type badge and state indicator
- [ ] Create story panel (title, type, points, assignee, labels, epic)
- [ ] Story detail page/modal (`/stories/[id]`)
- [ ] Edit and delete story
- [ ] Drag-and-drop reordering (update `position` field)
- [ ] Filter backlog by type / label / assignee

### iOS
- [ ] `BacklogView` — scrollable story list
- [ ] `StoryDetailView` — full story detail
- [ ] `StoryEditView` — create and edit story
- [ ] Swipe actions for quick state changes

---

## Task 6 — Iterations

### Web
- [ ] Iteration list page (`/projects/[id]/iterations`)
- [ ] Auto-generate next iteration based on `iteration_length`
- [ ] Auto-assign stories from backlog up to current velocity
- [ ] Display current iteration on project home (`/projects/[id]`)
- [ ] Sprint goal input
- [ ] Manual story move between iterations
- [ ] Mark iteration as done → finalize velocity

### iOS
- [ ] `IterationsView` — list of iterations
- [ ] Current iteration detail with story list
- [ ] Sprint goal display and edit

---

## Task 7 — Epics & Labels

### Web
- [ ] Epic list page (`/projects/[id]/epics`)
- [ ] Create / edit / delete epic with color picker
- [ ] Epic progress bar (accepted stories / total stories)
- [ ] Label management in project settings
- [ ] Apply multiple labels to a story

### iOS
- [ ] `EpicsView` — epic list with progress
- [ ] Label picker in story edit screen

---

## Task 8 — Velocity Calculation

- [ ] Implement velocity calculation logic (see SPEC.md)
  - Average accepted points across last `velocity_window` completed iterations
  - Exclude `chore` and `release` story types
- [ ] Store finalized velocity on iteration completion
- [ ] Display current velocity on project home and iteration views
- [ ] Use velocity for auto-assignment in Task 6

---

## Task 9 — Collaboration: Comments & Activity

### Web
- [ ] Comment thread on story detail page
- [ ] @mention support (parse `@username` in comment body)
- [ ] Activity log timeline on project home

### iOS
- [ ] Comment list and input on `StoryDetailView`
- [ ] Activity log screen

---

## Task 10 — Notifications

### Web
- [ ] Request browser notification permission on sign-in
- [ ] Trigger notification on: assigned to story, @mentioned, story state changed

### iOS
> **保留（当面なし）**: iOS プッシュ通知(APNs)は当面実装しない（シミュレータのみで開発するため）。
> APNs には Apple Developer Program（有料・$99/年）が必要。実装する場合はその登録後に着手する。
> それまでは Web のブラウザ通知のみを提供する。

- [ ] Register for push notifications (APNs)
- [ ] Handle notification payloads
- [ ] Trigger push on: assigned to story, @mentioned, story state changed

---

## Task 11 — Realtime Collaboration

- [ ] Subscribe to story changes via Supabase Realtime on backlog and iteration views
- [ ] Reflect story state changes live without page refresh
- [ ] Show live comment updates on story detail

---

## Task 12 — Integrations

### GitHub
- [ ] Integration setup in project settings (repo URL, webhook secret)
- [ ] Supabase Edge Function to receive GitHub webhook
- [ ] Parse PR title / branch name for story ID (e.g. `[SL-123]`)
- [ ] Auto-update story state to `finished` on PR merge

### Slack
- [ ] Integration setup in project settings (Incoming Webhook URL)
- [ ] Notify on: story state change, iteration start/done
- [ ] Edge Function to POST to Slack

### Forgejo
- [ ] Reuse GitHub webhook handler (same payload format)
- [ ] Integration setup in project settings

---

## Task 13 — Polish & QA

- [ ] Error states and empty states for all views
- [ ] Loading skeletons on data-fetching screens
- [ ] Responsive layout for web (mobile and desktop)
- [ ] Accessibility audit (keyboard navigation, screen reader labels)
- [ ] End-to-end test for core flows (create project → add story → complete iteration)
- [ ] Performance review (query optimization, Realtime subscription cleanup)
