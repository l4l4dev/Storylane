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

### backlog_dividers
Freeform planning dividers for the List view's Backlog section (Task 15
follow-up, 2026-07-07) — user-created labeled rows for grouping backlog
stories, distinct from the automatic velocity-based "Iteration #N" markers
(spec/velocity.md), which aren't stored rows at all.
```sql
backlog_dividers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  label      text NOT NULL,
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

### stories
```sql
stories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid REFERENCES projects(id) ON DELETE CASCADE,
  number       int  NOT NULL,               -- プロジェクト毎の連番（採番トリガーで自動付与、UNIQUE (project_id, number)）。
                                            -- UI では #123、PR タイトルでは [SL-123] として使う（Task 12 で追加）
  iteration_id uuid REFERENCES iterations(id) ON DELETE SET NULL,
  epic_id      uuid REFERENCES epics(id) ON DELETE SET NULL,
  title        text NOT NULL,
  description  text,
  story_type   text NOT NULL DEFAULT 'feature'
                 CHECK (story_type IN ('feature', 'bug', 'chore', 'release')),
  state        text NOT NULL DEFAULT 'unscheduled'
                 CHECK (state IN ('unscheduled', 'unstarted', 'started', 'finished', 'delivered', 'accepted', 'rejected')),
                                            -- 'unscheduled' = Icebox（Task 12.5 で追加。新規ストーリーのデフォルト。
                                            -- 既存行のマイグレーションでは unstarted のまま = Backlog に残す）
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
