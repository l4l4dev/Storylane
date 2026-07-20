-- ============================================================
-- TASK-88 (doc-8 §9): story_pins lifecycle inside the two RPCs that can
-- strand a pin.
--
-- Both writes touch other users' pin rows, which no RLS policy allows (there
-- is no cross-user path by design), so they live in these existing SECURITY
-- DEFINER functions rather than in any client — spec/rls.md "story_pins".
-- ============================================================

-- move_story_to_project: verbatim from 20260719000011 plus the pin carry-over.
-- Move is insert-into-target + delete-source, so the source story's pins are
-- cascaded away with it; they are recreated on the new story id first, and
-- only for pinners who are members of the destination (a pin the pinner could
-- not see would be a leak into a project they were never in).
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
    project_id, title, description, story_type, points,
    assignee_id, created_by
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    v_points, v_assignee, auth.uid()
  )
  returning id, number into v_new_id, v_new_number;

  insert into public.story_pins (user_id, story_id)
  select sp.user_id, v_new_id
    from public.story_pins sp
    where sp.story_id = p_story_id
      and exists (
        select 1 from public.project_members pm
        where pm.project_id = p_target_project_id and pm.user_id = sp.user_id
      );

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

-- remove_member: verbatim from 20260717000001 plus the pin purge. Pins are
-- keyed on the story, not on membership, so nothing else deletes them when a
-- member leaves — and a re-invite would otherwise revive pins the user set
-- before they were removed.
create or replace function public.remove_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := public.project_role(p_project_id);
begin
  if v_caller_role is null then
    -- Outsider with no membership row — not a member of this project at all.
    raise exception 'Not a member of this project';
  end if;
  if v_caller_role <> 'owner' and auth.uid() is distinct from p_user_id then
    raise exception 'Only project owners can remove other members';
  end if;

  perform pg_advisory_xact_lock(hashtext('membership:' || p_project_id::text));

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id
  ) then
    -- Idempotent: already not a member.
    return;
  end if;

  perform public.assert_not_last_owner(p_project_id, p_user_id);

  delete from public.story_pins sp
    using public.stories s
    where sp.story_id = s.id
      and sp.user_id = p_user_id
      and s.project_id = p_project_id;

  delete from public.project_members
  where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- restore move_story_to_project from 20260719000011 and remove_member from
-- 20260717000001 verbatim.
