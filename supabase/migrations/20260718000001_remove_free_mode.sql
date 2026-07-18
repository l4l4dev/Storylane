-- TASK-84: remove the pre-launch free-mode schema without migrating data.

drop policy "members can view recurring stories" on public.recurring_stories;
drop policy "members can create recurring stories" on public.recurring_stories;
drop policy "members can update recurring stories" on public.recurring_stories;
drop policy "owners can delete recurring stories" on public.recurring_stories;

drop policy "members can view swimlanes" on public.swimlanes;
drop policy "members can create swimlanes" on public.swimlanes;
drop policy "members can update swimlanes" on public.swimlanes;
drop policy "owners can delete swimlanes" on public.swimlanes;

drop policy "members can view custom statuses" on public.custom_statuses;
drop policy "members can create custom statuses" on public.custom_statuses;
drop policy "members can update custom statuses" on public.custom_statuses;
drop policy "owners can delete custom statuses" on public.custom_statuses;

drop function public.generate_recurring_stories(uuid);
drop function public.swap_adjacent(uuid, text, uuid, text);
drop function public.create_project(text, int, text, int, text, jsonb, text);

drop table public.recurring_stories;
drop table public.swimlanes cascade;
drop table public.custom_statuses cascade;

alter table public.projects drop constraint projects_workflow_mode_check;
alter table public.projects drop column workflow_mode;

-- move_story_to_project / copy_story_to_project (current definitions:
-- 20260716000004_position_sequences.sql) both read projects.workflow_mode
-- and, when the target was 'free', looked up a landing column in
-- public.custom_statuses — both dropped above. Redefined here, word-for-word
-- from the current bodies minus the dead free-mode branch: the story always
-- lands with state = 'unscheduled' (Icebox), no custom_status_id, position
-- from the sequence default (never an explicit value, per the
-- position-ordering invariant in spec/data-model.md — this migration must
-- NOT reintroduce the pre-TASK-58 max+1 read). archived_at guards and every
-- other TASK-14/TASK-58 hardening rule are preserved unchanged. This is
-- redefined in the same migration that removes what it depended on, rather
-- than deferred to TASK-91 (which reworks state/state_id, not this
-- workflow_mode coupling).
create or replace function public.move_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_point_scale     text;
  v_custom_pts      int[];
  v_target_archived timestamptz;
  v_points          int;
  v_assignee        uuid;
  v_new_id          uuid;
  v_new_number      int;
  v_label           record;
  v_target_label    uuid;
begin
  select * into v_story from public.stories
    where id = p_story_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role in ('owner', 'member')
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  if coalesce(public.project_role(p_target_project_id), '') not in ('owner', 'member') then
    raise exception 'Not a member of the target project';
  end if;
  if v_story.project_id = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  select point_scale, custom_points, archived_at
    into v_point_scale, v_custom_pts, v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  if v_story.points is null then
    v_points := null;
  else
    v_points := case v_point_scale
      when 'fibonacci' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3, 5, 8, 13]))
      when 'linear' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3]))
      when 'custom' then (select v_story.points where v_story.points = any(coalesce(v_custom_pts, '{}')))
    end;
  end if;

  v_assignee := case
    when v_story.assignee_id is not null and exists(
      select 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id
    ) then v_story.assignee_id
    else null
  end;

  insert into public.stories (
    project_id, title, description, story_type, state, points,
    assignee_id, created_by
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    'unscheduled', v_points, v_assignee, auth.uid()
  )
  returning id, number into v_new_id, v_new_number;

  update public.tasks set story_id = v_new_id where story_id = p_story_id;
  update public.comments set story_id = v_new_id where story_id = p_story_id;

  for v_label in
    select l.name, l.color from public.story_labels sl
    join public.labels l on l.id = sl.label_id
    where sl.story_id = p_story_id
  loop
    select id into v_target_label from public.labels
      where project_id = p_target_project_id and name = v_label.name
      order by id limit 1;

    if v_target_label is null then
      insert into public.labels (project_id, name, color)
      values (p_target_project_id, v_label.name, v_label.color)
      returning id into v_target_label;
    end if;

    insert into public.story_labels (story_id, label_id)
    values (v_new_id, v_target_label)
    on conflict (story_id, label_id) do nothing;
  end loop;

  delete from public.stories where id = p_story_id;

  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    v_story.project_id, null, auth.uid(), 'story.moved_out',
    jsonb_build_object('target_project_id', p_target_project_id, 'title', v_story.title)
  );
  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    p_target_project_id, v_new_id, auth.uid(), 'story.moved_in',
    jsonb_build_object('source_project_id', v_story.project_id, 'title', v_story.title)
  );

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

create or replace function public.copy_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_point_scale     text;
  v_custom_pts      int[];
  v_target_archived timestamptz;
  v_points          int;
  v_assignee        uuid;
  v_new_id          uuid;
  v_new_number      int;
  v_label           record;
  v_target_label    uuid;
begin
  select * into v_story from public.stories
    where id = p_story_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role in ('owner', 'member')
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  if coalesce(public.project_role(p_target_project_id), '') not in ('owner', 'member') then
    raise exception 'Not a member of the target project';
  end if;
  if v_story.project_id = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  select point_scale, custom_points, archived_at
    into v_point_scale, v_custom_pts, v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  if v_story.points is null then
    v_points := null;
  else
    v_points := case v_point_scale
      when 'fibonacci' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3, 5, 8, 13]))
      when 'linear' then (select v_story.points where v_story.points = any(array[0, 1, 2, 3]))
      when 'custom' then (select v_story.points where v_story.points = any(coalesce(v_custom_pts, '{}')))
    end;
  end if;

  v_assignee := case
    when v_story.assignee_id is not null and exists(
      select 1 from public.project_members
      where project_id = p_target_project_id and user_id = v_story.assignee_id
    ) then v_story.assignee_id
    else null
  end;

  insert into public.stories (
    project_id, title, description, story_type, state, points,
    assignee_id, created_by
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    'unscheduled', v_points, v_assignee, auth.uid()
  )
  returning id, number into v_new_id, v_new_number;

  insert into public.tasks (story_id, title, is_done, position)
  select v_new_id, title, is_done, position from public.tasks where story_id = p_story_id;

  for v_label in
    select l.name, l.color from public.story_labels sl
    join public.labels l on l.id = sl.label_id
    where sl.story_id = p_story_id
  loop
    select id into v_target_label from public.labels
      where project_id = p_target_project_id and name = v_label.name
      order by id limit 1;

    if v_target_label is null then
      insert into public.labels (project_id, name, color)
      values (p_target_project_id, v_label.name, v_label.color)
      returning id into v_target_label;
    end if;

    insert into public.story_labels (story_id, label_id)
    values (v_new_id, v_target_label)
    on conflict (story_id, label_id) do nothing;
  end loop;

  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    p_target_project_id, v_new_id, auth.uid(), 'story.copied_in',
    jsonb_build_object('source_project_id', v_story.project_id, 'source_story_id', p_story_id, 'title', v_story.title)
  );

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

-- maintain_story_completed_at (20260709000005) branched on workflow_mode on
-- EVERY story insert/update, reading custom_statuses.is_done for the free
-- branch. Both are gone above; this fires unconditionally for every story
-- write in the app, so leaving it unfixed would break all story writes, not
-- just free-mode ones. Restored to the pre-free-mode (TASK-15) body: the
-- state = 'accepted' branch only, word-for-word from that migration's own
-- documented DOWN block.
create or replace function public.maintain_story_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    new.completed_at := case when new.state = 'accepted' then now() else null end;
  else
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;

-- finish_story_from_git (20260715000003) read projects.workflow_mode to gate
-- itself to tracker-mode projects and to detect a missing project. The
-- column is gone above; spec/integrations.md (TASK-83) already dropped this
-- gate -- "single workflow, mode判定は不要になった. 全プロジェクトが対象" -- so
-- this redefinition only removes the mode read/branch and replaces the
-- project-not-found check with a direct existence test. Every other rule
-- (advisory lock, forward-only force-finish, current-iteration assignment)
-- is unchanged; the merge-target-state rework is TASK-91, not here.
create or replace function public.finish_story_from_git(p_project_id uuid, p_story_number int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint := hashtext('iteration_finalize:' || p_project_id::text);
  v_story record;
  v_current_id uuid;
  v_current_number int;
begin
  if not exists (select 1 from public.projects where id = p_project_id) then
    return jsonb_build_array(jsonb_build_object('kind', 'ignored', 'number', p_story_number, 'reason', 'project_not_found'));
  end if;

  perform pg_advisory_xact_lock(v_lock_key);

  update public.stories
    set state = 'finished'
    where project_id = p_project_id
      and number = p_story_number
      and state in ('unscheduled', 'unstarted', 'started')
    returning id, iteration_id into v_story;

  if not found then
    return jsonb_build_array(jsonb_build_object('kind', 'not_transitionable', 'number', p_story_number));
  end if;

  if v_story.iteration_id is null then
    select id, number into v_current_id, v_current_number
      from public.iterations
      where project_id = p_project_id and state <> 'done'
      order by number desc
      limit 1;

    if v_current_id is not null then
      update public.stories
        set iteration_id = v_current_id
        where id = v_story.id and iteration_id is null;
      return jsonb_build_array(jsonb_build_object(
        'kind', 'finished', 'number', p_story_number, 'iteration_number', v_current_number
      ));
    end if;
  end if;

  return jsonb_build_array(jsonb_build_object('kind', 'finished', 'number', p_story_number));
end;
$$;

-- log_story_activity's 'story.column_changed' branch (20260717000003, TASK-40)
-- recorded stories.custom_status_id moves on free-mode boards, joining
-- against public.custom_statuses (dropped above) for the column name. No
-- write path sets custom_status_id anymore (free-mode board and
-- move/copy's free-mode landing are both removed), so this branch was
-- already unreachable in practice -- but it stays a landmine referencing a
-- dropped table if anything ever writes that column directly (e.g. via
-- PostgREST). Restored to the pre-TASK-40 body (20260702000001): INSERT +
-- state_changed only. TASK-91 will drop stories.custom_status_id itself.
create or replace function public.log_story_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.created', jsonb_build_object('title', new.title)
    );
  elsif tg_op = 'UPDATE' and new.state is distinct from old.state then
    insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
    values (
      new.project_id, new.id, coalesce(auth.uid(), new.created_by),
      'story.state_changed', jsonb_build_object('from', old.state, 'to', new.state)
    );
  end if;
  return new;
end;
$$;

-- move_story_board (20260716000001) still had a `p_view = 'free'` branch
-- (filtering the single-zone reposition by custom_status_id/swimlane_id)
-- from before this task. Nothing can send p_view = 'free' anymore -- every
-- caller across apps/web and apps/mcp only ever sends 'tracker', 'focus', or
-- 'list' -- so the branch was unreachable free-mode-only code left behind by
-- TASK-84's own AC#1 ("no free-mode code paths ... remain"). Removed here,
-- word-for-word otherwise. The story record still selects/writes
-- custom_status_id/swimlane_id (those columns survive this migration,
-- deferred to TASK-91 same as elsewhere in this file) -- only the dead
-- dispatch branch that could never be reached is gone.
create or replace function public.move_story_board(
  p_project_id uuid,
  p_item jsonb,
  p_view text,
  p_expected jsonb,
  p_deltas jsonb,
  p_anchor jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_kind text := p_item->>'kind';
  v_id uuid := (p_item->>'id')::uuid;
  v_story record;
  v_current_id uuid;
  v_new_state text;
  v_new_iteration uuid;
  v_new_status uuid;
  v_new_swimlane uuid;
  v_new_focus text;
  v_zone text;
  v_before_kind text := p_anchor->'before'->>'kind';
  v_before_id uuid := (p_anchor->'before'->>'id')::uuid;
  v_story_ids uuid[];
  v_inserted boolean := false;
  v_pos int;
  i int;
begin
  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));
  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  select id into v_current_id
    from public.iterations
    where project_id = p_project_id and state <> 'done'
    order by number desc
    limit 1;

  if v_kind = 'story' then
    select state, iteration_id, custom_status_id, swimlane_id, focus
      into v_story
      from public.stories
      where id = v_id and project_id = p_project_id
      for update;
    if not found then
      raise exception 'story not found' using errcode = 'P0002';
    end if;

    if v_story.state is distinct from (p_expected->>'state')
       or v_story.iteration_id is distinct from (p_expected->>'iteration_id')::uuid
       or v_story.custom_status_id is distinct from (p_expected->>'custom_status_id')::uuid
       or v_story.swimlane_id is distinct from (p_expected->>'swimlane_id')::uuid
       or v_story.focus is distinct from (p_expected->>'focus') then
      raise exception 'stale story state; refresh and retry' using errcode = 'P0001';
    end if;

    v_new_state := coalesce(p_deltas->>'state', v_story.state);
    if p_deltas ? 'iteration' then
      if p_deltas->>'iteration' = 'current' then
        if v_current_id is null then
          raise exception 'no active iteration' using errcode = 'P0001';
        end if;
        v_new_iteration := v_current_id;
      else
        v_new_iteration := null;
      end if;
    else
      v_new_iteration := v_story.iteration_id;
    end if;
    v_new_status := case when p_deltas ? 'custom_status_id'
      then (p_deltas->>'custom_status_id')::uuid else v_story.custom_status_id end;
    v_new_swimlane := case when p_deltas ? 'swimlane_id'
      then (p_deltas->>'swimlane_id')::uuid else v_story.swimlane_id end;
    v_new_focus := case when p_deltas ? 'focus'
      then p_deltas->>'focus' else v_story.focus end;

    update public.stories
      set state = v_new_state,
          iteration_id = v_new_iteration,
          custom_status_id = v_new_status,
          swimlane_id = v_new_swimlane,
          focus = v_new_focus
      where id = v_id;
  else
    if not exists (
      select 1 from public.backlog_dividers where id = v_id and project_id = p_project_id
    ) then
      raise exception 'divider not found' using errcode = 'P0002';
    end if;
    v_new_state := null;
  end if;

  if v_kind = 'divider' then
    v_zone := 'backlog';
  elsif p_view = 'list' and v_new_state <> 'unscheduled'
        and (v_current_id is null or v_new_iteration is distinct from v_current_id) then
    v_zone := 'backlog';
  else
    v_zone := 'single';
  end if;

  if v_zone = 'single' then
    if p_view = 'tracker' then
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration and state = v_new_state;
    elsif p_view = 'focus' then
      select coalesce(array_agg(id order by position), '{}') into v_story_ids
        from public.stories
        where project_id = p_project_id and id <> v_id
          and iteration_id is not distinct from v_new_iteration
          and focus is not distinct from v_new_focus;
    else
      if v_new_state = 'unscheduled' then
        select coalesce(array_agg(id order by position), '{}') into v_story_ids
          from public.stories
          where project_id = p_project_id and id <> v_id and state = 'unscheduled';
      else
        select coalesce(array_agg(id order by position), '{}') into v_story_ids
          from public.stories
          where project_id = p_project_id and id <> v_id and iteration_id = v_current_id;
      end if;
    end if;

    v_pos := 0;
    for i in 1 .. coalesce(array_length(v_story_ids, 1), 0) loop
      if not v_inserted and v_before_id is not null and v_story_ids[i] = v_before_id then
        update public.stories set position = v_pos where id = v_id;
        v_pos := v_pos + 1;
        v_inserted := true;
      end if;
      update public.stories set position = v_pos where id = v_story_ids[i];
      v_pos := v_pos + 1;
    end loop;
    if not v_inserted then
      update public.stories set position = v_pos where id = v_id;
    end if;
    return;
  end if;

  perform public._splice_backlog(p_project_id, v_kind, v_id, v_before_kind, v_before_id);
end;
$$;

-- DOWN (rollback -- not auto-applied; run manually if reverting):
-- alter table public.projects
--   add column workflow_mode text not null default 'tracker';
-- alter table public.projects
--   add constraint projects_workflow_mode_check check (workflow_mode in ('tracker', 'free'));
--
-- create table public.custom_statuses (
--   id         uuid primary key default gen_random_uuid(),
--   project_id uuid references public.projects(id) on delete cascade,
--   name       text not null,
--   color      text not null default '#6b7280',
--   position   int  not null default 0,
--   is_done    boolean not null default false,
--   wip_limit  int check (wip_limit > 0),
--   created_at timestamptz default now(),
--   unique (id, project_id)
-- );
-- create table public.swimlanes (
--   id         uuid primary key default gen_random_uuid(),
--   project_id uuid references public.projects(id) on delete cascade,
--   name       text not null,
--   position   int  not null default 0,
--   created_at timestamptz default now(),
--   unique (id, project_id)
-- );
-- create table public.recurring_stories (
--   id               uuid primary key default gen_random_uuid(),
--   project_id       uuid references public.projects(id) on delete cascade,
--   title            text not null,
--   description      text,
--   custom_status_id uuid,
--   swimlane_id      uuid,
--   cadence          text not null check (cadence in ('daily', 'weekly', 'monthly')),
--   weekday          int check (weekday between 0 and 6),
--   day_of_month     int check (day_of_month between 1 and 31),
--   is_active        bool not null default true,
--   last_generated_on date,
--   created_at       timestamptz default now()
-- );
-- (schema only -- pre-launch, no data migration, per doc-8 sec1. Re-add the 12
-- RLS policies from 20260707000007_workflow_modes.sql,
-- 20260709000007_free_mode_swimlanes.sql, 20260709000008_recurring_stories.sql,
-- and restore generate_recurring_stories / swap_adjacent / create_project from
-- 20260709000008_recurring_stories.sql / 20260716000002_swap_adjacent.sql /
-- 20260716000008_create_project.sql.)
--
-- (revert the 6 redefined functions to their prior bodies:
--  move_story_to_project / copy_story_to_project -> 20260716000004_position_sequences.sql
--  maintain_story_completed_at                   -> 20260709000005_free_mode_completed_at.sql
--  finish_story_from_git                         -> 20260715000003_finish_story_from_git.sql
--  log_story_activity                            -> 20260717000003_log_column_changes.sql
--  move_story_board                              -> 20260716000001_insert_board_item.sql)
