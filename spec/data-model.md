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
  is_agent     boolean NOT NULL DEFAULT false, -- true = coding agent (spec/mcp.md agent-as-member).
                                          -- UIs use it only to badge agents apart from humans;
                                          -- capacity math treats them identically to humans (doc-8 §8)
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
  iteration_length  int  DEFAULT 14,      -- cadence: sprint length in days (1 / 7 / 14 / 21 / 28).
                                          -- 1 = a 1-day-cadence project (doc-8 §4). A 1-day project is
                                          -- NOT necessarily the user's personal project — that is a
                                          -- separate flag, is_personal (see below). Changeable at any
                                          -- time; the change applies only to the NEXT iteration row
                                          -- created — no effective-date scheduling (doc-8 §3, see
                                          -- spec/velocity.md "Cadence change"), unless the owner opts
                                          -- into reshaping the current one (TASK-105). Each change
                                          -- logs an activity_logs row
  iteration_term    text NOT NULL DEFAULT 'Iteration', -- doc-8 §5: user-facing display term
                                          -- ("Sprint", "Iteration", free text). Data layer stays
                                          -- `iterations`. 1-day projects display the date as the title
  working_weekdays  int[] NOT NULL DEFAULT '{1,2,3,4,5}', -- doc-8 §6: default working weekdays,
                                          -- ISO weekday numbers (1=Mon … 7=Sun). Layered with
                                          -- project/user date exceptions for capacity + 1-day
                                          -- boundary selection (see calendar tables below)
  point_scale       text DEFAULT 'fibonacci', -- 'fibonacci' | 'linear' | 'custom'
  custom_points     int[],                -- array used when point_scale='custom'
  is_personal       boolean NOT NULL DEFAULT false, -- TASK-103 (doc-11 D1): the auto-created
                                          -- "My Tasks" personal project (set true by handle_new_user).
                                          -- Hidden from the owner's own projects list + switcher (My
                                          -- Work is its home); one per owner (partial unique index on
                                          -- created_by WHERE is_personal). Reverses doc-8's "no flag"
                                          -- call — iteration_length=1 can't distinguish personal from a
                                          -- 1-day team project
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

### project_states
Per-project board columns (doc-8 §2, supersedes the removed free-mode
`custom_statuses`) — freely named, added, removed, and reordered in
Settings, rebuilding the old free-mode column freedom on top of the tracker
machinery (iterations/velocity intact). System semantics attach to a fixed
**category** per state, not to its name. Same RLS pattern as the former
custom_statuses (members read/write, owner-only delete).

```sql
project_states (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         text NOT NULL,
  action_label text,                    -- advance-button verb ("Start", "Finish", …); NULL = no
                                         -- advance button rendered for this state (e.g. a done state)
  category     text NOT NULL CHECK (category IN ('unstarted', 'in_progress', 'done', 'rejected')),
                                         -- 'unstarted'  = backlog-planning zone;
                                         -- 'in_progress'= active work (auto-assign to current iteration);
                                         -- 'done'       = entry counts for velocity, sets completed_at;
                                         -- 'rejected'   = optional bounce (0..n states), red styling,
                                         --                zone/velocity semantics identical to in_progress.
                                         -- IMMUTABLE after creation — recategorize = create a new state
                                         -- and move stories (doc-8 §2 advisor)
  position     int  NOT NULL DEFAULT 0,  -- per the position-ordering invariant below
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (id, project_id) -- composite target for stories.state_id, so a story can never point
                          -- at another project's state
)
```

**Integrity rules (doc-8 §2 advisor):**
- `category` is immutable after creation.
- Deletion is plain-FK blocked while any story points at the state (the app
  converts the `23503` into a "move the stories off this state first"
  message — the custom_statuses precedent). Icebox (`state_id IS NULL`)
  cannot break: deleting states never touches it.
- A trigger under a per-project advisory lock enforces **≥1 `unstarted` and
  ≥1 `done` state at all times** (so a project can always receive and
  complete work).

**Transitions — `set_story_state(p_story_id, p_state_id)` (doc-8 §2 advisor):**
replaces the removed fixed-verb `transition_story`. SECURITY INVOKER, `FOR
UPDATE` on the story row, and it owns the shared guards: the estimation gate
(unestimated `feature` only into NULL/`unstarted`), the **done-iteration
guard** (reject writes onto a story in a `done`-state iteration, shared with
the finalization path — see spec/velocity.md "Finalization concurrency"), and
**auto-assign to the current iteration on entering an `in_progress` state**.
The DB permits **any → any** within the project; ordering discipline is
UI-only (the advance button / Accept-Reject pair, a `packages/core` pure
function). Runs on the TASK-70 board write model (a) — any member may operate
any story (see spec/rls.md).

**Default templates** at project creation (doc-8 §2):
- **classic** — Unstarted(`unstarted`) / Started, Finished, Delivered(all
  `in_progress`) / Accepted(`done`) / Rejected(`rejected`), with
  Start/Finish/Deliver/Accept/Reject action labels — renders identically to
  the old fixed Kanban (the Pivotal-parity anchor).
- **minimal** — Todo(`unstarted`) / Doing(`in_progress`) / Done(`done`).

### my_work_columns (doc-15)
Per-user **free columns** for the My Work screen — Todo/Today/Done are
structural slots, everything else (the pre-seeded `Doing` + any the user adds)
is a row here, ordered by `position`. Local by definition: free columns never
touch a project board. `unique (user_id, id)` is the target of
`my_work_story_state`'s composite FK below, so a card can't point at another
user's column. `position` only orders new free columns among themselves at
creation — the visible left-to-right board order (fixed slots included) is
`profiles.my_work_column_order` (TASK-141, doc-15), a per-user `text[]` of
slot ids (`'todo'` / `'today'` / `'done'` / a `my_work_columns` uuid), read-side
merged against the live free-column set (`resolveColumnOrder` in
`lib/utils/my-work.ts`) so a stale (deleted) id is dropped and a not-yet-
ordered one is appended in its default position — no migration needed when a
column is added or removed. No new RLS: `profiles`' existing own-row UPDATE
policy already covers writing this column.
```sql
my_work_columns (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   int  NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
)  -- + index on (user_id, position)
```
Seeded one `Doing` row per user (backfill + at signup via `handle_new_user`).
RLS: own rows, all four ops (`user_id = auth.uid()`).

### my_work_story_state (doc-14, reshaped by doc-15, Done-as-status TASK-176)
Per-user, per-story My Work marks + manual card orders. A card classifies to
exactly ONE column by precedence: **Done** (the story's real state category is
`done`) > **Today** (`today_date` = the viewer's local today) > its **free
column** (`column_id`) > **Todo**. Done is read from the story's live done
category, not a stored mark — so this table only holds the *ordering* for Done
(`done_position`), not membership. There is no project-board mapping — My Work
is a purely personal board.
```sql
my_work_story_state (
  user_id        uuid REFERENCES profiles(id) ON DELETE CASCADE,
  story_id       uuid REFERENCES stories(id)  ON DELETE CASCADE,
  column_id      uuid,   -- free column (NULL = Todo); composite FK below
  today_date     date,   -- Today mark for a specific calendar date (NULL = not today)
  today_position int,    -- manual order within Today
  column_position int,   -- manual order within its free column
  todo_position  int,    -- manual order within Todo (TASK-177)
  done_position  int,    -- manual order within a Done date group (TASK-176)
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, story_id),
  CHECK (today_position IS NULL OR today_date IS NOT NULL),
  CHECK (column_position IS NULL OR column_id IS NOT NULL),
  CHECK (todo_position IS NULL OR (today_date IS NULL AND column_id IS NULL)),
  FOREIGN KEY (user_id, column_id) REFERENCES my_work_columns (user_id, id)
    ON DELETE SET NULL (column_id)   -- deleting a column drops its cards back to Todo
)  -- + index on (story_id) for the reverse "who customized this" lookup
```
Each position is nulls-last with a fallback (Today/free/Todo: the cross-project
board order; Done: newest completion first). `today_position`, `column_position`,
and `todo_position` are each valid only while the row sits in that column — a
`BEFORE UPDATE` reset trigger (`my_work_story_state_reset_positions`) clears
`column_position` when `column_id` changes/nulls and `todo_position` when the
row gains a Today date or a free column, so a caller that forgets the paired
field can't violate the CHECKs (the TASK-161 bug shape). The trigger can't catch
a **Done↔Todo** transition (both leave `today_date`/`column_id` null — the same
"shape" as Todo), so `persistMark` unconditionally clears `todo_position` (and
`done_position`) on every placement instead: a card re-completed or reopened
should start unordered, not inherit a stale slot. `done_position` has no CHECK or
reset trigger at all (Done membership isn't a local field — a stale value on a
since-reopened row is simply never read; `persistMark` clears it on any active
placement).

The composite FK (not a plain single-column one) enforces two invariants: a row
can't borrow another user's column, and column deletion nulls only `column_id`,
never `user_id` (which is part of the PK). The column-list `SET NULL` form is
PG15+ (local runs PG17). `today_date`/carry-over use the **client's** local wall
date, never DB `current_date` (UTC would shift the day boundary to 09:00 JST) —
only the one-time migration backfill uses `current_date`. RLS: own-rows
SELECT/UPDATE/DELETE (`user_id = auth.uid()`); INSERT WITH CHECK
`user_id = auth.uid() AND` caller is a member of the story's project. See spec/rls.md.

*(`project_my_work_mapping` was removed in doc-15 — free columns never touch a
project board, so a mapping had nothing left to do.)*

### story_completions (doc-14 — retired by TASK-176, table pending removal)
**No longer read or written.** Done was originally an append-only completion log
backed by this table; the owner's 2026-07-24 decision made Done a plain status
column read from the story's live `done` category, so `maintain_story_completed_at`
no longer inserts here and no reader remains. The table (and the `stories` SELECT
RLS OR-clause that referenced it) is left in place — unread — to avoid destroying
production rows on merge; it is dropped by TASK-98's baseline squash + reset. Do
not add new readers/writers.

### Working-day calendar (doc-8 §6)
Two date-exception layers on top of `projects.working_weekdays`. They affect
**velocity/planning math only**, never sprint boundaries — the single
exception is 1-day cadence start-date selection (spec/velocity.md), which
consults the **project-level calendar only**, never user time off (so an
iteration's existence never differs per user). Calendar edits never
retroactively move or delete existing iteration rows.

```sql
project_calendar_exceptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  date       date NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('holiday', 'extra_workday')),
                                          -- holiday = normally-working day off (company closure);
                                          -- extra_workday = non-working weekday made working
  UNIQUE (project_id, date)
)

user_time_off (
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  date    date NOT NULL,
  kind    text NOT NULL CHECK (kind IN ('off')),  -- dates + kind ONLY — no reason/notes column:
                                          -- co-members must read these for capacity math, so the
                                          -- table carries nothing private (doc-8 §6 advisor).
                                          -- Applies across all of the user's projects
  PRIMARY KEY (user_id, date)
)
```
`user_time_off` READ policy is `user_id = auth.uid() OR
shares_project_with(user_id)`, WRITE self-only. The trade-off (a shared
project exposes all your time-off dates to its members, viewers included) is
accepted and documented in spec/rls.md. v1 has no per-user weekday patterns —
"agent works weekends" is expressed via `extra_workday` / time-off dates or
not at all (deferred, doc-8 §8).

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
  velocity    int,                        -- finalized done-category point sum, snapshotted when done
  capacity    numeric,                    -- doc-8 §7: Σ member working-days for this sprint,
                                          -- SNAPSHOTTED by the finalization RPC and never recomputed —
                                          -- later member removal or calendar edits cannot rewrite
                                          -- history. NULL until finalized. rate = Σvelocity ÷ Σcapacity
                                          -- over the window (see spec/velocity.md)
  state       text DEFAULT 'planned' CHECK (state IN ('planned', 'active', 'done')),
  skipped     boolean NOT NULL DEFAULT false, -- true when manually finished before it started
                                          -- (spec/velocity.md "Skipping"); excluded from the
                                          -- velocity window so its 0 doesn't drag the average
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
  state_id     uuid,                      -- doc-8 §2: the story's project_state (board column).
                                          -- Composite FK (state_id, project_id) REFERENCES
                                          -- project_states(id, project_id) ON DELETE RESTRICT —
                                          -- cross-project references impossible; a state can't be
                                          -- deleted while stories point at it.
                                          -- NULL = Icebox (unscheduled) — new stories default to NULL.
                                          -- The category behind the state (project_states.category)
                                          -- drives velocity, completed_at, and zone semantics; the
                                          -- old fixed state enum is gone
  title        text NOT NULL,
  description  text,
  story_type   text NOT NULL DEFAULT 'feature'
                 CHECK (story_type IN ('feature', 'bug', 'chore', 'release')),
  completed_at timestamptz,                 -- when the story entered a done-category state; cleared
                                            -- whenever it leaves the done category. Drives date
                                            -- grouping (My Work, done-state columns)
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
  created_at  timestamptz DEFAULT now(),
  -- TASK-55: cross-project reference guard. Requires stories UNIQUE(id, project_id).
  -- ON DELETE NO ACTION — the single-column story_id FK's SET NULL fires first on
  -- a story delete, so the log survives with story_id nulled + project_id intact.
  FOREIGN KEY (story_id, project_id) REFERENCES stories(id, project_id) ON DELETE NO ACTION
)
-- Inserted only by SECURITY DEFINER trigger/RPC paths (no client INSERT policy,
-- TASK-55) — see spec/rls.md.
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

## Position ordering invariant

`position` columns (stories, backlog_dividers, tasks, epics, project_states)
are an **ordering** key, not a dense index. Readers sort by it; no
one reads it as an array index, and gaps are legal.

Two rules keep it consistent (TASK-58's position-sequence + splice RPCs):

1. **Every INSERT into a positioned table takes `position` from that table's
   sequence default — never an explicit value.** The one exception is
   `copy_story_to_project`, which copies a source story's tasks preserving their
   existing order (a rewrite, not an append); safe only because tasks have no
   other dense-rewrite writer today — revisit if task reordering is added.
   `backlog_dividers` draws from `stories_position_seq` (not its own), because it
   shares the backlog's single order space with `stories.position`.
2. **Rewrites (reorder/splice/compaction) only ever lower a position** to a
   dense rank `0..n-1` within a scope. A rank is always `< n ≤` the sequence
   frontier, so a subsequent default insert still lands last. Upward shifts are
   forbidden — `promote_story_to_epic` opens its gap by inserting from the
   sequence and then lowering, never by pushing existing rows past the frontier
   (the bug that motivated rule 1).

DB-enforced where the scope is flat: `UNIQUE(project_id, position)` on
project_states / epics and `UNIQUE(story_id, position)` on tasks,
both `DEFERRABLE INITIALLY DEFERRED` (a rewrite collides mid-statement and
reconciles at commit). `stories` and `backlog_dividers` are **not** constrained:
their position is scoped by zone, not by a single column, and the two tables
share one backlog order space, so no single-column UNIQUE expresses it.

### Backlog zone predicate (canonical)

A story belongs to the **backlog zone** when `iteration_id is null and
state_id is not null` (doc-8 §2 advisor: NULL-safe, and deleting states can
never strand a story out of the Icebox). The canonical definition lives in
the DB, in `_splice_backlog` (TASK-51); `move_story_board`, the board's `buildBacklogRows`, and
`lib/utils/kanban.ts` `zoneForStory` all mirror it and must be changed together
with it. (decision-1: invariants are authoritative server-side.)
