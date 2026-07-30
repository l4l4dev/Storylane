-- ============================================================
-- Board lock-order invariant, second pair: positions:<project> then
-- story_number:<project>, both BEFORE any story row lock. Every other RPC that
-- takes them already does — insert_board_item and create_draft_story take
-- positions, then INSERT (whose numbering trigger takes story_number), then
-- row-lock siblings to shift positions. Reversing it in one function is enough
-- to deadlock it against the others (40P01) — see
-- split-story-lock-order.integration.test.ts.
--
-- The key is derived from the story, so the locks cannot sit at the top of the
-- function: the unlocked read below exists only to resolve project_id, and the
-- authoritative locked read still follows it.
--
-- That probe is NOT RLS-filtered here, unlike set_story_state's: this function is
-- SECURITY DEFINER. The role gate under it is what keeps the probe from
-- confirming a story exists in a project the caller cannot see, and from letting
-- a non-member park a project-wide lock on any project by guessing an id. Both of
-- its raises therefore carry the same bare message and code as the FOR UPDATE
-- read's — deliberately not set_story_state's P0002/42501 split, which exists
-- because a viewer can see a story it may not restate; owner/member has no such
-- middle tier.
-- ============================================================

create or replace function public.split_story(p_story_id uuid, p_children jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Both checks read this one list, so widening or narrowing the guard
  -- cannot change only one of them and silently reopen the window.
  v_roles text[] := array['owner', 'member'];
  -- Stands in for v_source.project_id everywhere below. No trigger pins
  -- stories.project_id and the UPDATE policy only checks project_role of the
  -- row's own project, so what actually holds the column still is
  -- activity_logs_story_project_fk (20260715000006), a composite FK on
  -- (story_id, project_id) that every logged story has a row for. The locked read
  -- re-pins it anyway rather than depending on a constraint two tables away.
  v_project_id      uuid;
  v_role            text;
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
  -- Unlocked, and only to build the advisory-lock keys below. `is null` rather
  -- than `perform ... if not found` because `perform` sets FOUND and nothing
  -- could then be placed between the probe and the branch reading it.
  select project_id into v_project_id from public.stories where id = p_story_id;
  if v_project_id is null then
    raise exception 'Story not found';
  end if;

  -- Authorize, then serialize. Without this a non-member would queue on, and
  -- briefly hold, a project-wide lock on a call certain to be refused, and the
  -- DEFINER probe above would have already told them the story exists. The
  -- FOR UPDATE below stays authoritative; this only raises the same message
  -- earlier. `is null` first because project_role returns NULL for a non-member
  -- and `NULL not in (...)` is NULL, which `if` reads as false.
  v_role := public.project_role(v_project_id);
  if v_role is null or not (v_role = any(v_roles)) then
    raise exception 'Story not found';
  end if;

  -- Child inserts take the number lock; positions is held even though children
  -- are only appended (no compaction), so a concurrent splice cannot interleave.
  perform pg_advisory_xact_lock(hashtext('positions:' || v_project_id::text));
  perform pg_advisory_xact_lock(hashtext('story_number:' || v_project_id::text));

  -- owner/member on the source project; also the write lock. The membership
  -- subquery deliberately stays as it is: collapsing "not yours" into "Story not
  -- found" is what keeps this from confirming a story exists in a project the
  -- caller cannot see.
  select * into v_source from public.stories
    where id = p_story_id
      and project_id = v_project_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role = any(v_roles)
      )
    for update;
  if not found then
    raise exception 'Story not found';
  end if;

  -- The read above can still wait on a concurrent row lock, so the caller's role
  -- is re-checked after it. Re-checking by project_id is safe now that the row
  -- read has already established the caller could see it.
  perform public.require_project_role(v_project_id, variadic v_roles);

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

  -- A task assigned to two children would silently drop the second request —
  -- reject up front rather than partially applying it.
  select array_agg(t) into v_all_task_ids
    from jsonb_array_elements(p_children) as c,
         jsonb_array_elements_text(coalesce(c->'task_ids', '[]'::jsonb)) as t;
  if v_all_task_ids is not null
     and array_length(v_all_task_ids, 1) <> (select count(distinct t) from unnest(v_all_task_ids) as t) then
    raise exception 'A task cannot be assigned to more than one new story' using errcode = 'P0001';
  end if;

  select point_scale, custom_points into v_point_scale, v_custom_pts
    from public.projects where id = v_project_id;

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
        where project_id = v_project_id and category = 'unstarted'
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
      v_project_id, p_story_id,
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
    v_project_id, p_story_id, auth.uid(), 'story.split',
    jsonb_build_object('child_ids', to_jsonb(v_child_ids), 'child_count', array_length(v_child_ids, 1))
  );

  -- Exit guard. Enumerating this function's waits does not terminate — an UPDATE
  -- waits on a tuple lock, an INSERT on a foreign-key row, a trigger on whatever
  -- it calls — so the guard goes after every write rather than after each wait.
  -- Nothing above is durable until commit, so raising here rolls all of it back.
  perform public.require_project_role(v_project_id, variadic v_roles);

  -- The stored points must be valid under the CURRENT target scale, not the one
  -- read before these writes. spec/features.md ("points are kept only if the
  -- value exists in the target's point scale") constrains the STORED value, so
  -- it is not enough that a later scale change cannot alter the already-computed
  -- variable — that variable is what got written.
  perform public.assert_points_on_scale(v_project_id, c)
    from unnest(v_child_ids) as c;

  return jsonb_build_object('parent_id', p_story_id, 'child_ids', to_jsonb(v_child_ids));
end;
$$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- Restore the body from 20260728073000_recheck_role_after_lock.sql, which
-- reintroduces the inversion this migration removes.
-- ============================================================
