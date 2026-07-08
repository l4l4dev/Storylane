-- ============================================================
-- Task 12: update_story RPC — story detail autosave (spec/screens.md
-- "Story detail editing", "Conflict & failure rules").
--
-- Replaces a plain `stories` UPDATE + separate story_labels replace with one
-- transactional RPC so autosave's higher write frequency can't leave labels
-- half-replaced (delete succeeds, insert fails) the way two separate
-- statements could. Also gives the client a reliable "was this story
-- deleted (or otherwise inaccessible)?" signal: a plain UPDATE silently
-- "succeeds" with zero rows affected when the target row doesn't exist or
-- RLS hides it, which a client can't distinguish from a real success.
-- Returning no rows here means exactly that.
--
-- No SECURITY DEFINER — unlike invite_member (needs auth.users access) or
-- assign_story_number (needs visibility past the caller's own read scope),
-- this only performs writes the calling user's own RLS grants already
-- allow; running as invoker keeps that enforcement intact.
--
-- Never touches `project_id` or `state` — those are owned by cross-project
-- move/copy and the one-click transition buttons respectively, not the
-- detail form.
-- ============================================================

create or replace function public.update_story(
  p_story_id uuid,
  p_title text,
  p_description text,
  p_story_type text,
  p_points int,
  p_epic_id uuid,
  p_assignee_id uuid,
  p_custom_status_id uuid,
  p_label_ids uuid[] default array[]::uuid[]
)
returns table (
  id uuid,
  project_id uuid,
  number int,
  title text,
  description text,
  story_type text,
  state text,
  points int,
  epic_id uuid,
  assignee_id uuid,
  custom_status_id uuid,
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

  -- Locks the row (within RLS's SELECT visibility) so a concurrent
  -- autosave from another tab/user serializes against this one instead of
  -- both reading stale project/point-scale data.
  select s.project_id into v_project_id
  from public.stories s
  where s.id = p_story_id
  for update;

  if not found then
    -- Deleted, or not visible to this caller under RLS — either way there's
    -- nothing to update. Caller (apps/web/app/stories/[id]/actions.ts)
    -- treats zero returned rows as "story not found".
    return;
  end if;

  select pr.point_scale, pr.custom_points into v_point_scale, v_custom_points
  from public.projects pr
  where pr.id = v_project_id;

  -- Mirrors lib/utils/stories.ts "parsePoints" — a story type that doesn't
  -- use points, or a value outside the project's point scale (no free
  -- numeric input, see spec/features.md), always parses to null rather than
  -- rejecting the save outright.
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

  -- RLS ("owners or authors can update stories") still applies to this
  -- UPDATE even though the row was already locked above — a caller who can
  -- see the row but isn't its owner/author/assignee updates zero rows here,
  -- same silent-no-op behavior the plain UPDATE it replaces already had.
  update public.stories s
  set title = v_title,
      description = v_description,
      story_type = p_story_type,
      points = v_points,
      epic_id = p_epic_id,
      assignee_id = p_assignee_id,
      -- Free-mode-only field (Task 14); null means "leave unchanged" so a
      -- tracker-mode save (which never sends one) can't blow away a
      -- free-mode story's column by accident.
      custom_status_id = coalesce(p_custom_status_id, s.custom_status_id)
  where s.id = p_story_id;

  delete from public.story_labels where story_id = p_story_id;
  if coalesce(array_length(p_label_ids, 1), 0) > 0 then
    insert into public.story_labels (story_id, label_id)
    select p_story_id, label_id from unnest(p_label_ids) as label_id;
  end if;

  return query
  select
    s.id, s.project_id, s.number, s.title, s.description, s.story_type, s.state,
    s.points, s.epic_id, s.assignee_id, s.custom_status_id,
    coalesce(array_agg(sl.label_id) filter (where sl.label_id is not null), array[]::uuid[])
  from public.stories s
  left join public.story_labels sl on sl.story_id = s.id
  where s.id = p_story_id
  group by s.id;
end;
$$;
