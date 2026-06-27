# Storylane — Specification v0.1

An agile project management tool inspired by Pivotal Tracker.
Core features include story backlog management, automatic velocity calculation, and iteration management,
delivered on both iOS (Swift / SwiftUI) and Web (React + TypeScript).

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| iOS | Swift / SwiftUI | iOS 17+ |
| Web Frontend | React + TypeScript | Next.js (App Router) |
| Backend | Supabase | DB, Auth, Realtime, Storage |
| Realtime | Supabase Realtime | Used for collaboration features |
| Authentication | Supabase Auth | Google / GitHub OAuth |
| Web Hosting | Vercel | Hobby plan (free) |

---

## Data Model

### users
References Supabase Auth `auth.users`. Only profile data is managed in a separate table.

```sql
profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id),
  display_name text NOT NULL,
  avatar_url   text,
  created_at   timestamptz DEFAULT now()
)
```

### projects
```sql
projects (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  description       text,
  velocity_window   int  DEFAULT 3,       -- number of recent iterations used for velocity calculation
  iteration_length  int  DEFAULT 14,      -- sprint length in days: 7 / 14 / 21 / 28
  point_scale       text DEFAULT 'fibonacci', -- 'fibonacci' | 'linear' | 'custom'
  custom_points     int[],                -- array used when point_scale='custom'
  created_by        uuid REFERENCES profiles(id),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
)
```

### project_members
```sql
project_members (
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES profiles(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'member', 'viewer')),
  joined_at   timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
)
```

### epics
```sql
epics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  color       text DEFAULT '#6366f1',
  position    int  NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
)
```

### labels
```sql
labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#6b7280',
  created_at timestamptz DEFAULT now()
)
```

### iterations
```sql
iterations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  number      int  NOT NULL,              -- sprint number (1, 2, 3...)
  goal        text,                       -- sprint goal (optional)
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  velocity    int,                        -- finalized velocity (total accepted points) when done
  state       text DEFAULT 'planned' CHECK (state IN ('planned', 'active', 'done')),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (project_id, number)
)
```

### stories
```sql
stories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  iteration_id uuid REFERENCES iterations(id) ON DELETE SET NULL,
  epic_id      uuid REFERENCES epics(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  story_type   text NOT NULL DEFAULT 'feature'
                 CHECK (story_type IN ('feature', 'bug', 'chore', 'release')),
  state        text NOT NULL DEFAULT 'unstarted'
                 CHECK (state IN ('unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected')),
  points       int  CHECK (points >= 0),  -- nullable for chore / release
  position     int  NOT NULL DEFAULT 0,   -- order within the backlog
  assignee_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by   uuid REFERENCES profiles(id),
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
)
```

### story_labels (join table)
```sql
story_labels (
  story_id  uuid REFERENCES stories(id) ON DELETE CASCADE,
  label_id  uuid REFERENCES labels(id)  ON DELETE CASCADE,
  PRIMARY KEY (story_id, label_id)
)
```

### tasks (checklist items within a story)
```sql
tasks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id   uuid REFERENCES stories(id) ON DELETE CASCADE,
  title      text NOT NULL,
  is_done    bool DEFAULT false,
  position   int  NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
)
```

### comments
```sql
comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id   uuid REFERENCES stories(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES profiles(id),
  body       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
)
```

### activity_logs
```sql
activity_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid REFERENCES projects(id) ON DELETE CASCADE,
  story_id    uuid REFERENCES stories(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES profiles(id),
  action      text NOT NULL,  -- e.g. 'story.created' | 'story.state_changed' | 'comment.added'
  payload     jsonb,          -- before/after values etc.
  created_at  timestamptz DEFAULT now()
)
```

### integrations
```sql
integrations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('github', 'slack', 'forgejo')),
  config       jsonb NOT NULL,  -- repo_url, webhook_url, token etc. (encryption recommended)
  is_active    bool DEFAULT true,
  created_at   timestamptz DEFAULT now()
)
```

---

## Velocity Calculation Logic

```
velocity = AVG( sum of accepted points across the last velocity_window completed iterations )
```

- Stories with `story_type = 'chore'` or `'release'` are excluded from point counts
- `iterations.velocity` is finalized when an iteration transitions to `state = 'done'`
- Auto-assignment: stories are pulled from the top of the backlog to fill the next iteration up to the current velocity

---

## Feature List

### Phase 1 (Initial Release)

#### Story Management
- Backlog list with drag-and-drop reordering
- Create, edit, and delete stories
- Story types: feature / bug / chore / release
- Story states: unstarted → started → finished → delivered → accepted / rejected
- Point estimation (fibonacci: 0, 1, 2, 3, 5, 8, 13 / custom scale)
- Task (checklist) management within stories
- Assignee, label, and epic associations

#### Iteration Management
- Auto-generate iterations based on sprint length
- Auto-assign stories from backlog based on velocity
- Sprint goal setting
- Manual story movement between iterations

#### Epics & Labels
- Create epics with color settings and progress display (completed / total stories)
- Create labels with colors and apply multiple labels to stories

#### Team Collaboration
- Invite members to projects by email
- Role management: owner / member / viewer
- Comments and @mentions on stories
- Activity log (timeline of changes within a project)

#### Notifications
- When assigned to a story
- When mentioned in a comment
- When a story you own changes state
- Web: browser notifications / iOS: push notifications

#### Integrations
- **GitHub**: Link PRs to stories. Auto-update story to `finished` on PR merge
- **Slack**: Notify channels on story updates, iteration start/completion
- **Forgejo**: Same webhook integration as GitHub (for self-hosted environments)

### Phase 2 (Future)
- Burndown chart
- CSV export
- Generic Webhook API

---

## Screen Structure

### Web (Next.js)

```
/                         Login / top page
/auth/login               Login (OAuth)
/dashboard                Project list
/projects/[id]            Project home (backlog + current iteration)
/projects/[id]/backlog    Backlog detail
/projects/[id]/iterations Iteration list
/projects/[id]/epics      Epic list
/projects/[id]/settings   Project settings (members, integrations, point scale, etc.)
/stories/[id]             Story detail (modal or standalone page)
```

### iOS (SwiftUI)

```
TabView
├── Backlog          BacklogView
├── Iterations       IterationsView
├── Epics            EpicsView
└── Settings         SettingsView

Sub-screens
├── StoryDetailView  Story detail
├── StoryEditView    Create / edit story
└── ProjectListView  Project selection (on launch)
```

---

## Supabase RLS Policy Guidelines

- Only users present in `project_members` can read or modify data for that project
- `viewer` role: SELECT only
- `member` role: SELECT / INSERT / UPDATE (own stories or assigned stories)
- `owner` role: all operations including DELETE

---

## Integration Implementation Notes

### GitHub / Forgejo Webhooks
1. Include the story ID in the PR title or branch name (e.g. `[SL-123]` or `storylane/123`)
2. Receive and parse the webhook in a Supabase Edge Function
3. Update the matching story's state

### Slack Notifications
- Register an Incoming Webhook URL in project settings
- POST from Edge Functions on story state changes, comments, and iteration events

---

## Local Development Setup

### Prerequisites
- Node.js 22 LTS (see `.nvmrc`)
- pnpm 9+
- Docker runtime (OrbStack recommended on macOS, or Docker Desktop) — required by `supabase start`
- Supabase CLI
- Latest release version of Xcode

### Web
```bash
pnpm create next-app@latest storylane-web --typescript --tailwind --app
cd storylane-web
pnpm add @supabase/supabase-js @supabase/ssr
```

### iOS
- Add `supabase-swift` as a Swift Package in Xcode
  - URL: `https://github.com/supabase/supabase-swift`

### Supabase
```bash
supabase init
supabase start    # start local DB
supabase db push  # apply migrations
```

---

## Glossary

| Term | Definition |
|---|---|
| Story | The smallest unit of development work. One of: feature, bug, chore, release |
| Backlog | List of stories not yet assigned to an iteration |
| Iteration | A sprint — a fixed development cycle of 1–4 weeks |
| Velocity | Average points completed across the last N iterations |
| Epic | A large feature grouping that spans multiple stories |
| Points | A numeric estimate of a story's scope |
| Accepted | A story that has been reviewed and marked as complete |
