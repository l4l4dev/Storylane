-- ============================================================
-- TASK-208: an unchanged off-scale estimate is not an edit.
--
-- Narrowing a project's point_scale (fibonacci 5 -> linear 0..3) leaves existing
-- estimates outside the scale. The detail form then echoes the stored value back
-- on every autosave, so mapping any off-scale value to NULL would treat an
-- untouched field as a deliberate clear — wiping the estimate off a started or
-- done feature, which stories_enforce_board_invariants forbids, and taking the
-- rest of the save (title, assignee, parent, labels) down with it.
--
-- So an off-scale value IDENTICAL to what is already stored is kept. A genuinely
-- new off-scale value still normalises to NULL, mirroring the client's
-- parsePoints.
--
-- Verbatim replacement of 20260724051506's update_story except the declaration,
-- the locked read (now also reading points), and that one branch. Grants
-- preserved across CREATE OR REPLACE.
-- ============================================================

create or replace function public.update_story(
  p_story_id uuid,
  p_title text,
  p_description text,
  p_story_type text,
  p_points int,
  p_parent_id uuid,
  p_assignee_id uuid,
  p_label_ids uuid[] default array[]::uuid[]
)
 RETURNS TABLE(id uuid, project_id uuid, number integer, title text, description text, story_type text, state_id uuid, points integer, parent_id uuid, assignee_id uuid, label_ids uuid[])
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_project_id uuid;
  v_point_scale text;
  v_custom_points int[];
  v_allowed_points int[];
  v_points int;
  v_current_points int;
  v_title text := trim(p_title);
  v_description text := nullif(trim(coalesce(p_description, '')), '');
begin
  if v_title = '' then
    raise exception 'Title cannot be empty';
  end if;

  -- Locks the row (within RLS's SELECT visibility) so a concurrent autosave
  -- serializes against this one instead of both reading stale project data.
  select s.project_id, s.points into v_project_id, v_current_points
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
  elsif p_points is not distinct from v_current_points then
    -- Off-scale but unchanged: the caller echoed back what is already stored,
    -- which every autosave does once point_scale has been narrowed. Nulling it
    -- here would clear an estimate the user never touched.
    v_points := v_current_points;
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
$function$

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore update_story from 20260724051506_epic_story_unification_rpcs.sql)
-- ============================================================
