-- ============================================================
-- TASK-178 / doc-18: re-anchor the story-write RPCs off the dropped
-- stories.epic_id onto stories.parent_id.
--
-- update_story (20260720000003) and create_story_tracker (20260719000011) both
-- still read/write stories.epic_id, which 20260724043408 removed — so both are
-- now broken. Re-anchor them onto parent_id (the doc-18 hierarchy). The
-- single-level-nesting + is_container triggers (TASK-179) enforce integrity on
-- the parent_id write; here we only swap the column.
--
-- promote_story_to_epic (also in 20260719000011) still references epics/epic_id
-- but is dropped wholesale in TASK-181, so it is intentionally left untouched.
-- Both functions change a parameter name (and update_story a return column
-- name), so they must be dropped and recreated, not CREATE OR REPLACE'd. Each
-- recreate restores the default authenticated EXECUTE grant, keeping the
-- grant-lockdown allowlist unchanged.
-- ============================================================

-- update_story: p_epic_id -> p_parent_id, return column epic_id -> parent_id.
drop function public.update_story(uuid, text, text, text, int, uuid, uuid, uuid[]);

create function public.update_story(
  p_story_id uuid,
  p_title text,
  p_description text,
  p_story_type text,
  p_points int,
  p_parent_id uuid,
  p_assignee_id uuid,
  p_label_ids uuid[] default array[]::uuid[]
)
returns table (
  id uuid,
  project_id uuid,
  number int,
  title text,
  description text,
  story_type text,
  state_id uuid,
  points int,
  parent_id uuid,
  assignee_id uuid,
  label_ids uuid[]
)
language plpgsql
set search_path = public
as $$
declare
  v_project_id uuid;
  v_point_scale text;
  v_custom_points int[];
  v_allowed_points int[];
  v_points int;
  v_title text := trim(p_title);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
begin
  if v_title = '' then
    raise exception 'Title cannot be empty';
  end if;

  -- Locks the row (within RLS's SELECT visibility) so a concurrent autosave
  -- serializes against this one instead of both reading stale project data.
  select s.project_id into v_project_id
  from public.stories s
  where s.id = p_story_id
  for update;

  if not found then
    -- Deleted or not visible under RLS — caller treats zero rows as "not found".
    return;
  end if;

  select pr.point_scale, pr.custom_points into v_point_scale, v_custom_points
  from public.projects pr
  where pr.id = v_project_id;

  -- Mirrors lib/utils/stories.ts "parsePoints" — a non-pointed type or an
  -- out-of-scale value parses to null rather than rejecting the save.
  v_allowed_points := case v_point_scale
    when 'fibonacci' then array[0, 1, 2, 3, 5, 8, 13]
    when 'linear' then array[0, 1, 2, 3]
    when 'custom' then coalesce(v_custom_points, array[]::int[])
    else array[0, 1, 2, 3, 5, 8, 13]
  end;

  if p_story_type not in ('feature', 'bug') then
    v_points := null;
  elsif p_points = any(v_allowed_points) then
    v_points := p_points;
  else
    v_points := null;
  end if;

  -- RLS still applies to this UPDATE even though the row was already locked —
  -- a caller who can see but not write updates zero rows. Never touches
  -- project_id or state_id (owned by move/copy and set_story_state). parent_id
  -- is the doc-18 nesting link; the single-level + is_container triggers
  -- (TASK-179) validate/react to the change.
  update public.stories s
  set title = v_title,
      description = v_description,
      story_type = p_story_type,
      points = v_points,
      parent_id = p_parent_id,
      assignee_id = p_assignee_id
  where s.id = p_story_id;

  delete from public.story_labels where story_id = p_story_id;
  if coalesce(array_length(p_label_ids, 1), 0) > 0 then
    insert into public.story_labels (story_id, label_id)
    select p_story_id, label_id from unnest(p_label_ids) as label_id;
  end if;

  return query
  select
    s.id, s.project_id, s.number, s.title, s.description, s.story_type, s.state_id,
    s.points, s.parent_id, s.assignee_id,
    coalesce(array_agg(sl.label_id) filter (where sl.label_id is not null), array[]::uuid[])
  from public.stories s
  left join public.story_labels sl on sl.story_id = s.id
  where s.id = p_story_id
  group by s.id;
end;
$$;

revoke execute on function public.update_story(uuid, text, text, text, int, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.update_story(uuid, text, text, text, int, uuid, uuid, uuid[]) to authenticated;

-- create_story_tracker: p_epic_id -> p_parent_id (MCP create-under-container).
drop function if exists public.create_story_tracker(uuid, text, uuid, uuid, text, text, int, uuid, uuid[]);

create function public.create_story_tracker(
  p_project_id uuid,
  p_title text,
  p_state_id uuid,
  p_iteration_id uuid,
  p_description text,
  p_story_type text,
  p_points int,
  p_parent_id uuid,
  p_label_ids uuid[]
)
returns table (id uuid, number int, title text, state_id uuid, iteration_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.stories (project_id, title, state_id, iteration_id, description, story_type, points, parent_id)
  values (
    p_project_id,
    p_title,
    p_state_id,
    p_iteration_id,
    p_description,
    coalesce(p_story_type, 'feature'),
    p_points,
    p_parent_id
  )
  returning stories.id into v_id;

  if p_label_ids is not null and array_length(p_label_ids, 1) is not null then
    insert into public.story_labels (story_id, label_id)
    select v_id, x
    from (select distinct unnest(p_label_ids) as x) d
    where x is not null;
  end if;

  return query
    select s.id, s.number, s.title, s.state_id, s.iteration_id
    from public.stories s
    where s.id = v_id;
end;
$$;

revoke execute on function public.create_story_tracker(uuid, text, uuid, uuid, text, text, int, uuid, uuid[]) from public, anon;
grant execute on function public.create_story_tracker(uuid, text, uuid, uuid, text, text, int, uuid, uuid[]) to authenticated;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- restore update_story from 20260720000003_fix_update_story_reanchor.sql and
-- create_story_tracker from 20260719000011_reanchor_story_ops.sql (both on
-- stories.epic_id).
-- ============================================================
