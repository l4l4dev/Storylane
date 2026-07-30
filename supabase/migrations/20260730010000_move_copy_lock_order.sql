-- ============================================================
-- Completes the invariant 20260730000000 states: every advisory lock is taken
-- BEFORE any story row lock. move_story_to_project and copy_story_to_project were
-- the last two holdouts — each row-locked the source story and only then took
-- story_number:<target>.
--
-- Left alone they compose with the fixed split_story into a four-party cycle,
-- which the two-party same-project fix cannot see. With S in project A and T in
-- project B:
--
--   move S A→B   holds row S,   waits story_number:B
--   split T      holds number B, waits row T
--   move T B→A   holds row T,   waits story_number:A
--   split S      holds number A, waits row S
--
-- Once no transaction acquires an advisory lock while already holding a row lock,
-- no cycle can route through a row→advisory edge, and these functions take a
-- single advisory lock each, so there is no advisory→advisory edge to order.
--
-- The lock here is on the TARGET project, not the source, so what has to precede
-- it is the target membership check — already present, merely moved up. No source
-- gate of split_story's kind is needed: a caller who cannot write the source can
-- still only reach the lock of a target it already belongs to, which it could
-- take at any time by creating a story there. The unlocked probe raises the same
-- bare 'Story not found' as the locked read, so it answers nothing extra either.
-- ============================================================

-- ── move_story_to_project ────────────────────────────────────────────────────
create or replace function public.move_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  -- Only to reach the checks that guard the lock before the locked read runs; the
  -- read re-pins it, so nothing downstream trusts this copy.
  v_source_project  uuid;
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
  select project_id into v_source_project from public.stories where id = p_story_id;
  if v_source_project is null then
    raise exception 'Story not found';
  end if;

  -- Source before target, because the checks below now run ahead of the read that
  -- used to reject first: without this a viewer of the source would be told about
  -- its target membership instead of getting the read's generic 'Story not found',
  -- which is what keeps viewer-of-source indistinguishable from non-member.
  if not (coalesce(public.project_role(v_source_project), '') = any(v_roles)) then
    raise exception 'Story not found';
  end if;

  if not (coalesce(public.project_role(p_target_project_id), '') = any(v_roles)) then
    raise exception 'Not a member of the target project';
  end if;
  if v_source_project = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  select archived_at into v_source_archived from public.projects where id = v_source_project;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  -- Only archived_at is used before the lock; the point scale is read after it,
  -- because a scale fetched here would already be stale by the time the clamp
  -- runs.
  select archived_at into v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  select * into v_story from public.stories
    where id = p_story_id
      and project_id = v_source_project
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role = any(v_roles)
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  -- A container's row is only a grouping parent; deleting the source (Move =
  -- insert-into-target + delete-source) would SET NULL its children's parent_id
  -- and silently explode the epic (doc-18 §8). Move the children instead.
  if v_story.is_container then
    raise exception 'A container cannot be moved — move or regroup its children instead' using errcode = 'P0001';
  end if;

  -- story_number is contended by every numbering path in the target project,
  -- so this wait is unbounded in practice. Re-assert BOTH sides: the caller
  -- can lose write access to either project while parked here. The source
  -- membership subquery in the read above stays as it is, for the same
  -- story-existence reason as split_story.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  -- archived_at is enforced ONLY inside these RPCs — no policy or trigger backs
  -- it up — so it needs re-reading here for the same reason the roles do, or a
  -- project archived during the wait still receives the story.
  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;
  select archived_at into v_target_archived from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;
  -- The point scale came from the same pre-lock read as archived_at and is just
  -- as stale: a scale narrowed during the wait would otherwise let the clamp
  -- below admit a value that is off the new scale, and nothing downstream
  -- re-validates points against it.
  select point_scale, custom_points into v_point_scale, v_custom_pts
    from public.projects where id = p_target_project_id;

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

  -- Child move drops parent_id: the fresh target insert never carries the
  -- source project's parent_id (doc-18 §8).
  insert into public.stories (
    project_id, title, description, story_type, points,
    assignee_id, created_by
  ) values (
    p_target_project_id, v_story.title, v_story.description, v_story.story_type,
    v_points, v_assignee, auth.uid()
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

  -- Exit guard. Enumerating this function's waits does not terminate — an UPDATE
  -- waits on a tuple lock, an INSERT on a foreign-key row, a trigger on whatever
  -- it calls — so the guard goes after every write rather than after each wait.
  -- Nothing above is durable until commit, so raising here rolls all of it back.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  -- archived_at rides along for the same reason the role does: it is enforced
  -- nowhere but in this function, and the writes above can wait, so the value
  -- checked before them is as stale as the role was. point_scale is NOT re-read
  -- here — it only feeds the clamp that has already run, so a later value could
  -- not change what was stored.
  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;
  select archived_at into v_target_archived from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  -- The stored points must be valid under the CURRENT target scale, not the one
  -- read before these writes. spec/features.md ("points are kept only if the
  -- value exists in the target's point scale") constrains the STORED value, so
  -- it is not enough that a later scale change cannot alter the already-computed
  -- variable — that variable is what got written.
  perform public.assert_points_on_scale(p_target_project_id, v_new_id);

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

-- ── copy_story_to_project ────────────────────────────────────────────────────
create or replace function public.copy_story_to_project(p_story_id uuid, p_target_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  v_source_project  uuid;
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
  select project_id into v_source_project from public.stories where id = p_story_id;
  if v_source_project is null then
    raise exception 'Story not found';
  end if;

  -- Source before target, because the checks below now run ahead of the read that
  -- used to reject first: without this a viewer of the source would be told about
  -- its target membership instead of getting the read's generic 'Story not found',
  -- which is what keeps viewer-of-source indistinguishable from non-member.
  if not (coalesce(public.project_role(v_source_project), '') = any(v_roles)) then
    raise exception 'Story not found';
  end if;

  if not (coalesce(public.project_role(p_target_project_id), '') = any(v_roles)) then
    raise exception 'Not a member of the target project';
  end if;
  if v_source_project = p_target_project_id then
    raise exception 'Source and target project must be different';
  end if;

  select archived_at into v_source_archived from public.projects where id = v_source_project;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;

  -- Only archived_at is used before the lock; the point scale is read after it,
  -- because a scale fetched here would already be stale by the time the clamp
  -- runs.
  select archived_at into v_target_archived
    from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  perform pg_advisory_xact_lock(hashtext('story_number:' || p_target_project_id::text));

  select * into v_story from public.stories
    where id = p_story_id
      and project_id = v_source_project
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role = any(v_roles)
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  -- A container has no self-contained content to copy (its work lives in its
  -- children); Copy of a container is forbidden alongside Move (doc-18 §8).
  if v_story.is_container then
    raise exception 'A container cannot be copied — copy or regroup its children instead' using errcode = 'P0001';
  end if;

  -- story_number is contended by every numbering path in the target project,
  -- so this wait is unbounded in practice. Re-assert BOTH sides: the caller
  -- can lose write access to either project while parked here. The source
  -- membership subquery in the read above stays as it is, for the same
  -- story-existence reason as split_story.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  -- archived_at is enforced ONLY inside these RPCs — no policy or trigger backs
  -- it up — so it needs re-reading here for the same reason the roles do, or a
  -- project archived during the wait still receives the story.
  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;
  select archived_at into v_target_archived from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;
  -- The point scale came from the same pre-lock read as archived_at and is just
  -- as stale: a scale narrowed during the wait would otherwise let the clamp
  -- below admit a value that is off the new scale, and nothing downstream
  -- re-validates points against it.
  select point_scale, custom_points into v_point_scale, v_custom_pts
    from public.projects where id = p_target_project_id;

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

  -- Exit guard. Enumerating this function's waits does not terminate — an UPDATE
  -- waits on a tuple lock, an INSERT on a foreign-key row, a trigger on whatever
  -- it calls — so the guard goes after every write rather than after each wait.
  -- Nothing above is durable until commit, so raising here rolls all of it back.
  perform public.require_project_role(v_story.project_id, variadic v_roles);
  perform public.require_project_role(p_target_project_id, variadic v_roles);

  -- archived_at rides along for the same reason the role does: it is enforced
  -- nowhere but in this function, and the writes above can wait, so the value
  -- checked before them is as stale as the role was. point_scale is NOT re-read
  -- here — it only feeds the clamp that has already run, so a later value could
  -- not change what was stored.
  select archived_at into v_source_archived from public.projects where id = v_story.project_id;
  if v_source_archived is not null then
    raise exception 'Source project is archived';
  end if;
  select archived_at into v_target_archived from public.projects where id = p_target_project_id;
  if v_target_archived is not null then
    raise exception 'Target project is archived';
  end if;

  -- The stored points must be valid under the CURRENT target scale, not the one
  -- read before these writes. spec/features.md ("points are kept only if the
  -- value exists in the target's point scale") constrains the STORED value, so
  -- it is not enough that a later scale change cannot alter the already-computed
  -- variable — that variable is what got written.
  perform public.assert_points_on_scale(p_target_project_id, v_new_id);

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- Restore both bodies from 20260728073000_recheck_role_after_lock.sql, which
-- reintroduces the inversion this migration removes.
-- ============================================================
