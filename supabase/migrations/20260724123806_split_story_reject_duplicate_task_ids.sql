-- ============================================================
-- TASK-183 follow-up (/code-review): reject a task_id listed under more than
-- one child in split_story.
--
-- split_story is an authenticated RPC any member can call directly with
-- arbitrary JSON — the Split Studio UI always keeps a task exclusive to one
-- child (assignTaskToChild), but the RPC itself never enforced that. Without
-- a guard, the same task_id under two children's task_ids silently drops the
-- second child's request: the first child's UPDATE moves the task's
-- story_id away from p_story_id, so the second child's identical WHERE
-- clause matches zero rows for it — no error, no signal to the caller that
-- half its reassignment request was ignored.
--
-- create-or-replace of 20260724081029's split_story — verbatim except the
-- duplicate check added before the child-insert loop. Grants preserved.
-- ============================================================

create or replace function public.split_story(p_story_id uuid, p_children jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source          public.stories%rowtype;
  v_src_category    text;
  v_first_unstarted uuid;
  v_child_state     uuid;
  v_child_iter      uuid;
  v_iter_done       boolean;
  v_point_scale     text;
  v_custom_pts      int[];
  v_child_points    int;
  v_child           jsonb;
  v_new_id          uuid;
  v_child_ids       uuid[] := '{}';
  v_task_ids        uuid[];
  v_all_task_ids    uuid[];
begin
  -- owner/member on the source project; also the write lock.
  select * into v_source from public.stories
    where id = p_story_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role in ('owner', 'member')
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  -- An existing container has no board state to hand down (children would all
  -- fall to the Icebox); a child cannot gain children (single-level, §3).
  if v_source.is_container then
    raise exception 'This story is already a container and cannot be split' using errcode = 'P0001';
  end if;
  if v_source.parent_id is not null then
    raise exception 'A child story cannot be split (single-level nesting, doc-18 §3)' using errcode = 'P0001';
  end if;
  if p_children is null or jsonb_array_length(p_children) = 0 then
    raise exception 'Split requires at least one child story' using errcode = 'P0001';
  end if;

  -- A task assigned to two children would silently drop the second request
  -- (see header) — reject up front rather than partially applying it.
  select array_agg(t) into v_all_task_ids
    from jsonb_array_elements(p_children) as c,
         jsonb_array_elements_text(coalesce(c->'task_ids', '[]'::jsonb)) as t;
  if v_all_task_ids is not null
     and array_length(v_all_task_ids, 1) <> (select count(distinct t) from unnest(v_all_task_ids) as t) then
    raise exception 'A task cannot be assigned to more than one new story' using errcode = 'P0001';
  end if;

  -- Documented lock order positions -> story_number (child inserts take the
  -- number lock); hold both to avoid AB-BA deadlock with insert_board_item et
  -- al., even though children are only appended (no compaction).
  perform pg_advisory_xact_lock(hashtext('positions:' || v_source.project_id::text));
  perform pg_advisory_xact_lock(hashtext('story_number:' || v_source.project_id::text));

  select point_scale, custom_points into v_point_scale, v_custom_pts
    from public.projects where id = v_source.project_id;

  -- Child landing (doc-18 §7) — captured BEFORE the first child insert, which
  -- fires the §4 trigger that NULLs the source's state_id/iteration_id.
  if v_source.state_id is null then
    v_child_state := null; -- Icebox stays Icebox
  else
    select category into v_src_category from public.project_states where id = v_source.state_id;
    if v_src_category = 'unstarted' then
      v_child_state := v_source.state_id; -- a valid fresh start; carry it over
    else
      select id into v_first_unstarted from public.project_states
        where project_id = v_source.project_id and category = 'unstarted'
        order by position, id limit 1;
      v_child_state := v_first_unstarted; -- in_progress/done/rejected is no start
    end if;
  end if;

  if v_child_state is null or v_source.iteration_id is null then
    v_child_iter := null; -- Icebox children never carry an iteration
  else
    select state = 'done' into v_iter_done from public.iterations where id = v_source.iteration_id;
    v_child_iter := case when coalesce(v_iter_done, false) then null else v_source.iteration_id end;
  end if;

  for v_child in select value from jsonb_array_elements(p_children)
  loop
    -- Clamp an off-scale (or non-numeric) tentative points value to NULL
    -- (parity with update_story / move / copy). The Split Studio offers a
    -- scale-constrained picker, but the RPC is a trust boundary: a non-number
    -- in the JSON must not abort the whole split with a raw cast error.
    v_child_points := case
      when jsonb_typeof(v_child->'points') = 'number' then (v_child->>'points')::int
      else null
    end;
    if v_child_points is not null then
      v_child_points := case v_point_scale
        when 'fibonacci' then (select v_child_points where v_child_points = any(array[0, 1, 2, 3, 5, 8, 13]))
        when 'linear' then (select v_child_points where v_child_points = any(array[0, 1, 2, 3]))
        when 'custom' then (select v_child_points where v_child_points = any(coalesce(v_custom_pts, '{}')))
      end;
    end if;

    -- position omitted: default nextval appends at the sequence frontier
    -- (position invariant rule 1). assignee never inherited (§7).
    insert into public.stories (
      project_id, parent_id, title, description, story_type, points,
      state_id, iteration_id, epic_color, assignee_id, created_by
    ) values (
      v_source.project_id, p_story_id,
      v_child->>'title', v_child->>'description',
      coalesce(v_child->>'story_type', 'feature'), v_child_points,
      v_child_state, v_child_iter, v_source.epic_color, null, auth.uid()
    )
    returning id into v_new_id;
    v_child_ids := v_child_ids || v_new_id;

    -- Reassign the dragged tasks — only the source's own tasks; the rest stay
    -- on the source (now the container).
    if v_child ? 'task_ids' and jsonb_array_length(v_child->'task_ids') > 0 then
      select array_agg(value::uuid) into v_task_ids from jsonb_array_elements_text(v_child->'task_ids');
      update public.tasks set story_id = v_new_id
        where story_id = p_story_id and id = any(v_task_ids);
    end if;
  end loop;

  -- Audit the split on the source (comments/activity stay on it, §7). The §4
  -- trigger separately logs story.containerized (old points); each child insert
  -- logs story.created.
  insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
  values (
    v_source.project_id, p_story_id, auth.uid(), 'story.split',
    jsonb_build_object('child_ids', to_jsonb(v_child_ids), 'child_count', array_length(v_child_ids, 1))
  );

  return jsonb_build_object('parent_id', p_story_id, 'child_ids', to_jsonb(v_child_ids));
end;
$$;

-- DOWN (rollback — not auto-applied):
-- (restore split_story from 20260724081029_split_story_points_scale_validation.sql)
