-- ============================================================
-- Re-anchor update_story onto the doc-8 state model (rls-security-reviewer
-- full-schema audit, 2026-07-20, HIGH finding).
--
-- The 20260719000008-12 reanchor series missed this RPC: its body still
-- referenced stories.custom_status_id (dropped in 20260718000001) and
-- stories.state (replaced by state_id in 20260719000006), so EVERY story
-- detail autosave failed at runtime. Invisible to the suite because unit
-- tests mock the RPC and grant-lockdown only checks EXECUTE grants — the
-- new update-story integration test calls the real function.
--
-- Parameter list changes (p_custom_status_id removed), so the old function
-- must be dropped, not replaced. Recreating it restores the default-
-- privilege EXECUTE grant to authenticated (20260630000002), keeping the
-- grant-lockdown allowlist unchanged.
-- ============================================================

drop function public.update_story(uuid, text, text, text, int, uuid, uuid, uuid, uuid[]);

create function public.update_story(
  p_story_id uuid,
  p_title text,
  p_description text,
  p_story_type text,
  p_points int,
  p_epic_id uuid,
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
  epic_id uuid,
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

  -- RLS still applies to this UPDATE even though the row was already locked
  -- above — a caller who can see the row but may not write it updates zero
  -- rows here, same silent-no-op behavior as the plain UPDATE it replaced.
  -- Never touches project_id or state_id — those are owned by cross-project
  -- move/copy and set_story_state respectively, not the detail form.
  update public.stories s
  set title = v_title,
      description = v_description,
      story_type = p_story_type,
      points = v_points,
      epic_id = p_epic_id,
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
    s.points, s.epic_id, s.assignee_id,
    coalesce(array_agg(sl.label_id) filter (where sl.label_id is not null), array[]::uuid[])
  from public.stories s
  left join public.story_labels sl on sl.story_id = s.id
  where s.id = p_story_id
  group by s.id;
end;
$$;

-- New functions get EXECUTE for PUBLIC by default; keep authenticated only
-- (matches the function_grant_lockdown pattern and the allowlist test).
revoke execute on function public.update_story(uuid, text, text, text, int, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.update_story(uuid, text, text, text, int, uuid, uuid, uuid[]) to authenticated;

-- Same audit, LOW: 20260719000001 hardened is_agent against UPDATE via a
-- column grant but left the INSERT policy at `id = auth.uid()`. Not
-- exploitable today (handle_new_user creates the row inside the signup
-- transaction), but symmetry closes the door if provisioning ever changes.
alter policy "users can insert their own profile" on public.profiles
  with check (id = auth.uid() and coalesce(is_agent, false) = false);

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter policy "users can insert their own profile" on public.profiles
--   with check (id = auth.uid());
-- drop function public.update_story(uuid, text, text, text, int, uuid, uuid, uuid[]);
-- (restore update_story from 20260708000003_update_story_rpc.sql)
