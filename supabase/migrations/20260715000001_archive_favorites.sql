-- supabase/migrations/20260715000001_archive_favorites.sql
-- ============================================================
-- TASK-8: Project archive, favorites, search and sort
-- (spec/screens.md "Projects page", spec/data-model.md).
-- fable-advisor reviewed the toggle_project_favorite RPC design
-- 2026-07-10 (approved with changes, folded in below).
--
-- Also closes TASK-14's deferred TODO
-- (20260711000001_move_copy_story.sql lines 23-24): move_story_to_project
-- / copy_story_to_project now re-check neither source nor target project
-- is archived before writing anything.
--
-- Deliberately narrow scope (explicit user decision, docs/superpowers/specs
-- design doc): this does NOT lock every write-capable table (stories,
-- comments, iterations, ...) behind an "is this project archived" check.
-- Read-only is enforced only here (Move/Copy) and in the web UI's display/
-- archive-control gating. In-project edits inside an archived project are
-- not blocked by this migration — known limitation, follow-up work.
-- ============================================================

alter table public.projects
  add column archived_at timestamptz;
-- archived_at set = archived (owner only, via the existing "owners can
-- update projects" UPDATE policy in 20260627000002_projects.sql — no new
-- policy needed for this column). NULL = active.

alter table public.project_members
  add column is_favorite boolean not null default false;
-- Per-user pin — favorited projects sort first on /dashboard and in the
-- sidebar switcher (spec/screens.md "Projects page").
--
-- Known, accepted limitation: the existing "owners can update member
-- roles" UPDATE policy is row-scoped, not column-scoped, so an owner can
-- still PATCH another member's is_favorite directly via PostgREST (RLS
-- can't restrict to one column for an arbitrary UPDATE). Harmless
-- (non-destructive, reversible per-user display state) — not fixed here.

-- Lets any project member toggle their own favorite pin. The existing
-- project_members UPDATE policy ("owners can update member roles") is
-- owner-gated for the whole row, and a plain "users can update their own
-- row" RLS policy would let a non-owner rewrite their own `role` in the
-- same PATCH (RLS can't restrict by column for an arbitrary PostgREST
-- UPDATE) — this RPC is the safe way to expose only the one column.
--
-- Favoriting is allowed on archived projects: is_favorite is the viewer's
-- own display preference, not project data, so it's outside this task's
-- (deliberately narrow) read-only scope — no archived_at check here.
create function public.toggle_project_favorite(p_project_id uuid, p_favorite boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_favorite is null then
    raise exception 'p_favorite is required';
  end if;

  update public.project_members
    set is_favorite = p_favorite
    where project_id = p_project_id and user_id = auth.uid();

  if not found then
    raise exception 'Not a project member';
  end if;
end;
$$;

-- TASK-14 TODO: re-check neither source nor target project is archived,
-- placed after the existing membership checks (the caller is already
-- confirmed a member of both projects at that point — distinct error
-- messages for source vs target don't leak anything an existence probe
-- could exploit).
create or replace function public.move_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story           public.stories%rowtype;
  v_source_archived timestamptz;
  v_target_mode     text;
  v_point_scale     text;
  v_custom_pts      int[];
  v_target_archived timestamptz;
  v_status_id       uuid;
  v_position        int;
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

  select workflow_mode, point_scale, custom_points, archived_at
    into v_target_mode, v_point_scale, v_custom_pts, v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  if v_target_mode = 'free' then
    select id into v_status_id from public.custom_statuses
      where project_id = p_target_project_id order by position, id limit 1;
    if v_status_id is null then
      raise exception 'Target project has no board columns to land the story in';
    end if;
  else
    v_status_id := null;
  end if;

  select coalesce(max(position), -1) + 1 into v_position
    from public.stories where project_id = p_target_project_id;

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
    project_id, title, description, story_type, state, points, position,
    assignee_id, created_by, custom_status_id
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    'unscheduled', v_points, v_position, v_assignee, auth.uid(), v_status_id
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
  v_target_mode     text;
  v_point_scale     text;
  v_custom_pts      int[];
  v_target_archived timestamptz;
  v_status_id       uuid;
  v_position        int;
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

  select workflow_mode, point_scale, custom_points, archived_at
    into v_target_mode, v_point_scale, v_custom_pts, v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  if v_target_mode = 'free' then
    select id into v_status_id from public.custom_statuses
      where project_id = p_target_project_id order by position, id limit 1;
    if v_status_id is null then
      raise exception 'Target project has no board columns to land the story in';
    end if;
  else
    v_status_id := null;
  end if;

  select coalesce(max(position), -1) + 1 into v_position
    from public.stories where project_id = p_target_project_id;

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
    project_id, title, description, story_type, state, points, position,
    assignee_id, created_by, custom_status_id
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    'unscheduled', v_points, v_position, v_assignee, auth.uid(), v_status_id
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

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.toggle_project_favorite(uuid, boolean);
-- alter table public.project_members drop column is_favorite;
-- alter table public.projects drop column archived_at;
-- (move_story_to_project / copy_story_to_project would need restoring to
-- their pre-archived-check bodies from 20260711000001_move_copy_story.sql)
