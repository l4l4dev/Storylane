← [SPEC.md](../SPEC.md)

## Data Model

### users
References Supabase Auth `auth.users`. Only profile data is managed in a separate table.

```sql
profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id),
  display_name text NOT NULL,
  username     text UNIQUE NOT NULL,  -- @mention 用の一意ハンドル。初回サインイン時に自動生成、設定で変更可（Task 9 で追加）
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
  workflow_mode     text NOT NULL DEFAULT 'tracker'
                      CHECK (workflow_mode IN ('tracker', 'free')),
                                          -- Task 14, fixed at creation, never changed after:
                                          -- 'tracker' = state machine + iterations/velocity
                                          --   (renamed from 'pivotal' 2026-07-07 — one migration
                                          --   updates the CHECK and existing rows);
                                          -- 'free' = pure Trello board via custom_statuses, no
                                          -- iterations/velocity (see spec/screens.md "Free mode board")
  archived_at       timestamptz,          -- 2026-07-07: set = archived (owner only), NULL = active.
                                          -- Archived projects are hidden behind an "Archived"
                                          -- filter on the Projects page; unarchive sets NULL
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
  is_favorite bool NOT NULL DEFAULT false, -- 2026-07-07: per-user pin — favorited projects sort
                                           -- first on the Projects page and in the sidebar switcher
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

### custom_statuses
Board columns for `workflow_mode = 'free'` projects (Task 14, 2026-07-07) —
freely added/renamed/reordered/deleted in Settings, unlike tracker's fixed
state machine. Same RLS pattern as labels/epics (members read/write,
owner-only delete). Delete is blocked at the DB level (plain FK, no cascade)
while any story still references the status — the app converts the FK
error (`23503`) into a "move the stories off this status first" message.
```sql
custom_statuses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#6b7280',
  position   int  NOT NULL DEFAULT 0,
  is_done    boolean NOT NULL DEFAULT false, -- counts as "done" for activity log / future reports;
                                             -- also drives stories.completed_at in free mode
  wip_limit  int CHECK (wip_limit > 0),      -- 2026-07-07: soft WIP limit — column header shows
                                             -- count/limit and turns warning-colored when exceeded;
                                             -- drops are never blocked. NULL = no limit
  created_at timestamptz DEFAULT now(),
  UNIQUE (id, project_id) -- composite target for stories.custom_status_id, see below
)
```

### swimlanes
Optional horizontal lanes for free-mode boards (KanbanFlow parity,
2026-07-07). When a project has swimlane rows, the board renders lanes ×
columns, plus a "no lane" band for unassigned stories. Same RLS pattern as
custom_statuses. Delete follows the custom_statuses pattern: plain FK from
stories, `23503` converted into a "move the stories off this lane first"
message.
```sql
swimlanes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   int  NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (id, project_id) -- composite target for stories.swimlane_id
)
```

### recurring_stories
Recurrence rules for free-mode boards (KanbanFlow parity, 2026-07-07),
managed in project Settings. Generation is **lazy on board access** (no
cron, same principle as iteration rollover): for each active rule whose
next due date ≤ today, create one story instance (title/description copied,
placed in `custom_status_id` / `swimlane_id`) and advance
`last_generated_on`. Only the most recent missed occurrence is generated —
a board untouched for a month must not flood with 30 daily cards.

Double-generation guard (2026-07-08): generation runs in a single RPC that
**claims** each due rule first —
`UPDATE recurring_stories SET last_generated_on = <due> WHERE id = <id>
AND (last_generated_on IS NULL OR last_generated_on < <due>) RETURNING id`
— and inserts the story instance only when the claim returned a row, so
two clients loading the board simultaneously cannot double-insert. The RPC
is SECURITY DEFINER with a membership check inside (any role, including
viewer — same reasoning as lazy rollover, see spec/velocity.md
"Finalization concurrency"). Deleting a generated instance does not
regenerate it (the claim already advanced `last_generated_on`). Due dates
are computed in UTC in Phase 1, the same convention as iteration rollover;
a per-project timezone is a possible Phase 2 addition. The UI does not
offer `is_done` columns as generation targets (a card must not be born
completed).
```sql
recurring_stories (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid REFERENCES projects(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text,
  custom_status_id uuid,               -- target column; composite FK like stories.custom_status_id.
                                       -- NULL = leftmost column at generation time
  swimlane_id      uuid,               -- composite FK; NULL = no lane
  cadence          text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  weekday          int CHECK (weekday BETWEEN 0 AND 6),        -- weekly: 0=Sun … 6=Sat
  day_of_month     int CHECK (day_of_month BETWEEN 1 AND 31),  -- monthly (>28 clamps to month end)
  is_active        bool NOT NULL DEFAULT true,
  last_generated_on date,
  created_at       timestamptz DEFAULT now()
)
```

### backlog_dividers
Freeform planning rows for the List view's Backlog section (Task 15
follow-up, 2026-07-07) — user-created, deletable rows a PO can insert at any
exact position in the backlog. Two kinds:
- `note`: cosmetic label only, no effect on iteration numbering.
- `iteration_break`: forces the current virtual iteration to close at this
  exact point regardless of remaining velocity capacity (see
  spec/velocity.md "Virtual-group computation" and `lib/utils/iterations.ts`
  "buildBacklogRows") — an escape hatch on top of the automatic,
  velocity-based virtual iteration groups, which aren't stored rows at all.
```sql
backlog_dividers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  label      text NOT NULL,             -- empty string allowed, mainly used by 'note'
  kind       text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'iteration_break')),
  position   int  NOT NULL DEFAULT 0,   -- shares one dense sequence with stories.position
                                        -- within the project's backlog (see spec/screens.md
                                        -- "Board layout: List view")
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

### iteration_goals
Goals for **future (virtual) iterations** (2026-07-07) — future iterations
have no `iterations` row (see spec/velocity.md), so their goals are keyed
by iteration number. When rollover (or manual finish) creates the real
iteration row for a number that has a goal here, the goal is adopted into
`iterations.goal` and this row is deleted. Same RLS pattern as stories
(members read/write). Edited inline on the backlog group headers (see
spec/screens.md "Backlog groups").
```sql
iteration_goals (
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  number     int  NOT NULL,   -- virtual iteration number (> current iteration's number)
  goal       text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, number)
)
```

### stories
```sql
stories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  number       int  NOT NULL,               -- プロジェクト毎の連番（採番トリガーで自動付与、UNIQUE (project_id, number)）。
                                            -- UI では #123、PR タイトルでは [SL-123] として使う（Task 12 で追加）
  iteration_id uuid,                      -- Composite FK (iteration_id, project_id) REFERENCES
                                          -- iterations(id, project_id) ON DELETE SET NULL (iteration_id)
                                          -- (TASK-18) — prevents a story from pointing at another
                                          -- project's iteration; only iteration_id is nulled on delete
  epic_id      uuid,                      -- Composite FK (epic_id, project_id) REFERENCES epics(id,
                                          -- project_id) ON DELETE SET NULL (epic_id) (TASK-18) — same
                                          -- cross-project protection, epic_id only
  custom_status_id uuid,                  -- free-mode column (Task 14); ignored in tracker mode.
                                          -- Composite FK (custom_status_id, project_id) REFERENCES
                                          -- custom_statuses(id, project_id) — prevents a story from
                                          -- pointing at another project's status
  title        text NOT NULL,
  description  text,
  story_type   text NOT NULL DEFAULT 'feature'
                 CHECK (story_type IN ('feature', 'bug', 'chore', 'release')),
  state        text NOT NULL DEFAULT 'unscheduled'
                 CHECK (state IN ('unscheduled', 'unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected')),
                                            -- 'unscheduled' = Icebox（Task 12.5 で追加。新規ストーリーのデフォルト。
                                            -- 既存行のマイグレーションでは unstarted のまま = Backlog に残す）
                                            -- free-mode projects leave this at its default and
                                            -- ignore it entirely — custom_status_id drives the
                                            -- board column instead (Task 14)
  focus        text CHECK (focus IN ('today', 'this_week')),
                                            -- 2026-07-07: Focus-view bucket (tracker mode only,
                                            -- see spec/screens.md "Focus view"). NULL = plain Todo.
                                            -- Shared per story (not per user) in Phase 1
  completed_at timestamptz,                 -- 2026-07-07: when the story was completed.
                                            -- Tracker: set on the transition to 'accepted' and
                                            -- cleared whenever the state leaves 'accepted'.
                                            -- Free: set when moved into an is_done column, cleared
                                            -- when moved out. Drives date grouping in the Focus
                                            -- view Done column and free-mode done columns
  swimlane_id  uuid,                        -- 2026-07-07, free mode only; composite FK
                                            -- (swimlane_id, project_id) REFERENCES
                                            -- swimlanes(id, project_id). NULL = no lane
  points       int  CHECK (points >= 0),  -- nullable for chore / release。
                                          -- 値はプロジェクトの point_scale からの選択のみ（アプリ層で検証、Task 12.5）
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
