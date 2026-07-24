-- ============================================================
-- TASK-178 / doc-18 §1-§2, §4: Epic/Story unification — schema.
--
-- Replace the separate `epics` table + `stories.epic_id` label model with a
-- self-referencing 1-level hierarchy on `stories`. An "epic" is now a story
-- with children (`is_container = true`), grouped by `parent_id`, colored by
-- `epic_color`. Migration cost / existing-data preservation is explicitly out
-- of scope (owner decision, doc-18) — any existing epic associations are
-- dropped with the columns.
--
-- Follow-ups in the same chain (feat/epic-story-unification):
--   TASK-179 — single-level-nesting + is_container maintenance triggers
--              (is_container's value authority; this file only adds the column).
--   TASK-181 — drop promote_story_to_epic + its UI; add split_story.
-- No new table here, so no new RLS policies: the new columns ride the existing
-- `stories` policies. is_container is not client-writable in practice —
-- the CHECK below blocks the only dangerous state (an on-board container) and
-- the TASK-179 maintenance trigger owns its value.
-- ============================================================

-- 1. Self-referencing 1-level hierarchy columns.
alter table public.stories
  add column parent_id    uuid references public.stories (id) on delete set null,
  add column is_container boolean not null default false,
  add column epic_color   text;

comment on column public.stories.parent_id is
  'doc-18: self-referencing 1-level hierarchy. NULL = top-level. Depth capped at 1 by enforce_single_level_nesting (TASK-179).';
comment on column public.stories.is_container is
  'doc-18: trigger-maintained (TASK-179), true iff the story has >=1 child. App-layer read-only. A container is off the board — see the CHECK below.';
comment on column public.stories.epic_color is
  'doc-18: display color, meaningful only when is_container = true (folds in the removed epics.color).';

create index stories_parent_id_idx on public.stories (parent_id);

-- 2. Permanent off-the-board invariant (doc-18 §4, decision-1): a container
--    never carries board state/iteration/points. Enforced at all times by this
--    CHECK, not just by the one-time maintenance-trigger clear — so no later
--    direct UPDATE (set_story_state, a points autosave) through the existing
--    stories UPDATE policy can create an on-board container.
alter table public.stories
  add constraint stories_container_off_board_check
  check (not is_container or (points is null and state_id is null and iteration_id is null));

-- 3. Drop the old label model. CASCADE on the column removes the epic_id FK and
--    stories_epic_id_idx; CASCADE on the table removes the epics policies,
--    triggers, indexes, and the composite unique that backed the FK.
--    promote_story_to_epic still references epics but is dropped in TASK-181
--    (it is already dead against the current schema).
alter table public.stories drop column epic_id cascade;
drop table public.epics cascade;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting). Structural
-- only; dropped epic associations are not recoverable.
--
-- create table public.epics (
--   id uuid primary key default gen_random_uuid(),
--   project_id uuid references public.projects(id) on delete cascade,
--   name text not null, description text, color text default '#6366f1',
--   position int not null default 0,
--   created_at timestamptz default now(), updated_at timestamptz default now(),
--   unique (id, project_id)
-- );
-- alter table public.epics enable row level security;
-- -- (recreate the four epics policies + updated_at trigger + position seq/unique)
-- alter table public.stories add column epic_id uuid;
-- alter table public.stories add constraint stories_epic_id_fkey
--   foreign key (epic_id, project_id) references public.epics (id, project_id) on delete set null;
-- create index stories_epic_id_idx on public.stories (epic_id);
-- alter table public.stories drop constraint stories_container_off_board_check;
-- drop index public.stories_parent_id_idx;
-- alter table public.stories drop column epic_color, drop column is_container, drop column parent_id;
-- ============================================================
