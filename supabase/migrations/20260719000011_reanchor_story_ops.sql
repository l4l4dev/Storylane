-- ============================================================
-- TASK-91: re-anchor promote_story_to_epic, create_story_tracker, and
-- move_story_to_project / copy_story_to_project from stories.state onto
-- stories.state_id. Word-for-word from each current body otherwise.
--
-- promote_story_to_epic: spawned task-stories always land state_id = NULL
-- (Icebox) per doc-8's Icebox=NULL rule — simpler than the old
-- state='unscheduled'-or-'unstarted' branch, which no longer applies since
-- there's no single "unstarted" state name to fall back to. Also drops the
-- dead custom_status_id/swimlane_id copy (those columns are gone).
--
-- create_story_tracker: p_state -> p_state_id (MCP's createStory already
-- resolves the right state_id client-side, same as it resolves iteration_id
-- today — see apps/mcp/src/handlers.ts, re-anchored in Phase C).
--
-- move_story_to_project / copy_story_to_project: the landing story no
-- longer sets state at all (state_id defaults to NULL / Icebox on INSERT,
-- same outcome as the old literal 'unscheduled', just via the column
-- default instead of an explicit value).
-- ============================================================

create or replace function public.promote_story_to_epic(p_story_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_story       public.stories%rowtype;
  v_task_count  int;
  v_task_ids    uuid[];
  v_task_titles text[];
  v_epic_id     uuid;
  v_new_ids     uuid[] := '{}';
  v_new_id      uuid;
  v_idx         int;
begin
  select * into v_story from public.stories where id = p_story_id;
  if not found then
    raise exception 'Story not found';
  end if;

  if coalesce(public.project_role(v_story.project_id), '') <> 'owner' then
    raise exception 'Only project owners can promote a story to an epic';
  end if;

  perform pg_advisory_xact_lock(hashtext('positions:' || v_story.project_id::text));
  perform pg_advisory_xact_lock(hashtext('story_number:' || v_story.project_id::text));

  select * into v_story from public.stories where id = p_story_id for update;
  if not found then
    raise exception 'Story not found';
  end if;

  with locked_tasks as (
    select id, title, position from public.tasks where story_id = p_story_id for update
  )
  select array_agg(id order by position), array_agg(title order by position)
  into v_task_ids, v_task_titles
  from locked_tasks;
  v_task_count := coalesce(array_length(v_task_ids, 1), 0);

  insert into public.epics (project_id, name, description)
  values (v_story.project_id, v_story.title, v_story.description)
  returning id into v_epic_id;

  if v_task_count > 0 then
    update public.stories
    set position = position + (v_task_count - 1)
    where project_id = v_story.project_id and position > v_story.position;

    update public.backlog_dividers
    set position = position + (v_task_count - 1)
    where project_id = v_story.project_id and position > v_story.position;

    for v_idx in 1..v_task_count loop
      -- state_id and iteration_id both omitted: always lands in the Icebox
      -- (doc-8 Icebox=NULL), regardless of the original story's state or
      -- iteration — Icebox never carries an iteration_id
      -- (spec/data-model.md "Backlog zone predicate"), which
      -- finalize_iteration's rollover query assumes holds unconditionally.
      insert into public.stories (
        project_id, epic_id, title, story_type, points,
        assignee_id, created_by
      ) values (
        v_story.project_id, v_epic_id, v_task_titles[v_idx], 'feature', null,
        null, auth.uid()
      )
      returning id into v_new_id;

      insert into public.story_labels (story_id, label_id)
      select v_new_id, label_id from public.story_labels where story_id = p_story_id;

      v_new_ids := v_new_ids || v_new_id;
    end loop;

    update public.stories s
      set position = v_story.position + t.ord - 1
      from unnest(v_new_ids) with ordinality as t(id, ord)
      where s.id = t.id;
  end if;

  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    v_story.project_id, null, auth.uid(), 'story.promoted_to_epic',
    jsonb_build_object(
      'epic_id', v_epic_id,
      'title', v_story.title,
      'task_count', v_task_count,
      'new_story_ids', to_jsonb(v_new_ids)
    )
  );

  delete from public.stories where id = p_story_id;

  with merged as (
    select 'story'::text as kind, id, position from public.stories
      where project_id = v_story.project_id
    union all
    select 'divider'::text as kind, id, position from public.backlog_dividers
      where project_id = v_story.project_id
  ),
  ranked as (
    select kind, id, row_number() over (order by position, kind, id) - 1 as rn from merged
  ),
  compact_stories as (
    update public.stories s set position = r.rn
      from ranked r
      where r.kind = 'story' and s.id = r.id and s.position is distinct from r.rn
      returning 1
  )
  update public.backlog_dividers d set position = r.rn
    from ranked r
    where r.kind = 'divider' and d.id = r.id and d.position is distinct from r.rn;

  return jsonb_build_object('epic_id', v_epic_id, 'story_ids', v_new_ids);
end;
$$;

-- p_state (text) -> p_state_id (uuid) changes the 3rd parameter's TYPE, not
-- just its name — Postgres resolves function overloads by the full type
-- signature, so CREATE OR REPLACE on this signature would create a SECOND,
-- separately-callable overload rather than replacing the old one. The old
-- signature is dropped explicitly first, and grants are re-declared (a
-- drop+create needs fresh grants; only a same-signature CREATE OR REPLACE
-- would have inherited them).
drop function if exists public.create_story_tracker(uuid, text, text, uuid, text, text, int, uuid, uuid[]);

create function public.create_story_tracker(
  p_project_id uuid,
  p_title text,
  p_state_id uuid,
  p_iteration_id uuid,
  p_description text,
  p_story_type text,
  p_points int,
  p_epic_id uuid,
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
  insert into public.stories (project_id, title, state_id, iteration_id, description, story_type, points, epic_id)
  values (
    p_project_id,
    p_title,
    p_state_id,
    p_iteration_id,
    p_description,
    coalesce(p_story_type, 'feature'),
    p_points,
    p_epic_id
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

  return jsonb_build_object('story_id', v_new_id, 'project_id', p_target_project_id, 'number', v_new_number);
end;
$$;

revoke execute on function public.create_story_tracker(uuid, text, uuid, uuid, text, text, int, uuid, uuid[]) from public, authenticated;
grant execute on function public.create_story_tracker(uuid, text, uuid, uuid, text, text, int, uuid, uuid[]) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- (restore promote_story_to_epic from 20260716000006_promote_position_compaction.sql,
-- create_story_tracker / move_story_to_project / copy_story_to_project from
-- 20260719000003 / 20260718000001 respectively — all reference the dropped
-- stories.state column and cannot run as-is)
