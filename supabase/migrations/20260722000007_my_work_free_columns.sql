-- ============================================================
-- TASK-138 (doc-15): My Work redesign — free columns, no board mapping.
--
-- Supersedes doc-14's project_my_work_mapping design. Personal tasks stay
-- stories; My Work gets user-defined free columns (Todo/Today/Done are
-- structural, everything else is a my_work_columns row), and the per-project
-- Doing/Done mapping machinery is removed outright — free columns never touch
-- a project board, so a mapping has nothing left to do.
--
-- Forward-only (20260722000002/000004 are merged): this reshapes
-- my_work_story_state in place and DROPs project_my_work_mapping, it is not a
-- revert of those migrations.
--
-- fable-advisor round-1 required fixes folded in: composite FK on
-- (user_id, column_id) so a row can't point at another user's column, and the
-- column-list SET NULL form (PG15+; local is PG17 per config.toml) so column
-- deletion nulls only column_id, not the PK's user_id.
-- ============================================================

-- ------------------------------------------------------------
-- my_work_columns — a user's free (personal-status) columns. Todo/Today/Done
-- are structural slots, not rows; only the extra columns live here. 'Doing'
-- ships pre-seeded (decision 3) for visual continuity, and is an ordinary
-- deletable free column.
-- ------------------------------------------------------------
create table public.my_work_columns (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  position   int  not null,
  created_at timestamptz not null default now(),
  -- Target of my_work_story_state's composite FK below: without (user_id, id)
  -- unique, a crafted request could point one user's card at another user's
  -- column (fable-advisor; the invariant lives in the DB).
  unique (user_id, id)
);
create index my_work_columns_user_position_idx on public.my_work_columns (user_id, position);

alter table public.my_work_columns enable row level security;

-- Own rows, all four ops — same plain-write character as my_work_story_state.
create policy "users view their own my_work_columns"
  on public.my_work_columns for select to authenticated
  using (user_id = auth.uid());
create policy "users create their own my_work_columns"
  on public.my_work_columns for insert to authenticated
  with check (user_id = auth.uid());
create policy "users update their own my_work_columns"
  on public.my_work_columns for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "users delete their own my_work_columns"
  on public.my_work_columns for delete to authenticated
  using (user_id = auth.uid());

-- Seed one 'Doing' free column per existing user (the signup half is the
-- handle_new_user replacement below).
insert into public.my_work_columns (user_id, name, position)
select id, 'Doing', 0 from public.profiles;

-- ------------------------------------------------------------
-- my_work_story_state reshape (doc-15):
--   local_status text  -> column_id uuid (composite FK, SET NULL on col delete)
--   is_today boolean   -> today_date date + today_position int (day order)
-- ------------------------------------------------------------
alter table public.my_work_story_state
  add column column_id      uuid,
  add column today_date     date,
  add column today_position int;

-- Data conversion (doc-15): local 'doing' -> the user's seeded Doing column;
-- 'todo'/'done' -> null (real-done personal rows are already covered by
-- story_completions/category, and the retired team local-'done' mark returns
-- such a story to Todo unless its real category is done). is_today -> today
-- (the migration backfill is the one place current_date is allowed; runtime
-- "today" is the client's local date, DB current_date is UTC).
update public.my_work_story_state s
set column_id = c.id
from public.my_work_columns c
where c.user_id = s.user_id and c.name = 'Doing' and c.position = 0
  and s.local_status = 'doing';

update public.my_work_story_state
set today_date = current_date
where is_today;

alter table public.my_work_story_state
  drop column local_status,
  drop column is_today;

alter table public.my_work_story_state
  add constraint my_work_story_state_today_position_needs_date
    check (today_position is null or today_date is not null);

-- Column-list SET NULL (PG15+): a column deletion nulls only column_id (card
-- falls back to Todo), never user_id. A plain single-column FK is wrong twice:
-- it lets a row point at another user's column, and its SET NULL would null
-- user_id too, violating the PK (fable-advisor).
alter table public.my_work_story_state
  add constraint my_work_story_state_column_fk
    foreign key (user_id, column_id)
    references public.my_work_columns (user_id, id)
    on delete set null (column_id);

-- ------------------------------------------------------------
-- handle_new_user — full replacement (this function's established convention).
-- Based on 20260722000004; the project_my_work_mapping resolution + insert are
-- removed (the table is dropped below), replaced by seeding the user's 'Doing'
-- free column.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
  v_project_id   uuid;
begin
  v_display_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, 'user'), '@', 1)
  );

  insert into public.profiles (id, display_name, username, avatar_url)
  values (
    new.id,
    v_display_name,
    public.generate_username(v_display_name),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  -- Pre-seeded 'Doing' free column (doc-15 decision 3), matching the backfill.
  insert into public.my_work_columns (user_id, name, position)
  values (new.id, 'Doing', 0);

  insert into public.projects (name, iteration_length, state_template, created_by, is_personal)
  values ('My Tasks', 1, 'minimal', new.id, true)
  returning id into v_project_id;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- Drop the mapping table (TASK-137 cancelled, its Settings UI + banner removed
-- in the web app in the same task). No client references it after this.
-- ------------------------------------------------------------
drop table public.project_my_work_mapping;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore project_my_work_mapping + handle_new_user from 20260722000004,
--  my_work_story_state local_status/is_today from 20260722000002, drop
--  my_work_columns and the reshape columns/constraints above)
