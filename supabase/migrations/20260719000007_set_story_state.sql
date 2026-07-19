-- ============================================================
-- TASK-91 (doc-8 §2 advisor): set_story_state — replaces transition_story,
-- which read/wrote the now-dropped stories.state column and is unusable
-- (not merely superseded) the moment 20260719000006 landed; dropped here
-- rather than left as dangling broken surface.
--
-- Any -> any within the project (ordering discipline is UI-only, a
-- packages/core pure function — see spec/screens.md "advance button").
-- SECURITY INVOKER, mirrors transition_story's FOR UPDATE
-- authorization-and-lock pattern exactly: the stories UPDATE policy
-- (TASK-70, any project member) gates who may call this via the locked
-- read below, and the same lock/re-read closes the lost-update race two
-- concurrent state changes on the same story could otherwise hit.
--
-- Guards owned here: the estimation gate (an unestimated feature may only
-- sit in the Icebox or an unstarted-category state) and auto-assign to the
-- current iteration on entering an in_progress-category state from no
-- iteration (same advisory-lock pattern as finalize_iteration, so a
-- rollover can't interleave between the lookup and the assignment). The
-- done-iteration guard is the existing reject_done_iteration_assignment
-- trigger (20260709000002), unchanged — it already fires on any iteration_id
-- write, including the auto-assign UPDATE below.
-- ============================================================

drop function if exists public.transition_story(uuid, text);

create function public.set_story_state(p_story_id uuid, p_state_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_story record;
  v_target_category text;
  v_current_id uuid;
  v_rows int;
begin
  -- Existence check under the stories SELECT policy (any project member),
  -- so a bad id gets a truthful "not found" rather than the permission
  -- error below.
  perform 1 from public.stories where id = p_story_id;
  if not found then
    raise exception 'Story not found' using errcode = 'P0002';
  end if;

  -- Authoritative locked read. SECURITY INVOKER means RLS reaches this
  -- FOR UPDATE, applying the stories UPDATE policy — a caller who may READ
  -- but not WRITE this story is filtered to 0 rows here, so 'not found'
  -- below is the permission gate. The lock also serializes a second
  -- concurrent set_story_state call on the same story.
  select project_id, state_id, story_type, points, iteration_id
    into v_story
    from public.stories
    where id = p_story_id
    for update;
  if not found then
    raise exception 'Not allowed to change this story''s state' using errcode = '42501';
  end if;

  -- NULL is always a valid target (the Icebox); a non-NULL target must be a
  -- real state in THIS story's project (the composite FK also enforces this
  -- at the UPDATE below, but resolving the category here needs the row to
  -- exist first, and a friendlier error than a bare FK violation).
  if p_state_id is not null then
    select category into v_target_category
      from public.project_states
      where id = p_state_id and project_id = v_story.project_id;
    if not found then
      raise exception 'Target state not found in this project' using errcode = 'P0002';
    end if;
  end if;

  -- Estimation gate (spec/features.md): an unestimated feature can only sit
  -- in the Icebox (NULL) or an unstarted-category state.
  if v_story.story_type = 'feature' and v_story.points is null
     and coalesce(v_target_category, 'unstarted') <> 'unstarted' then
    raise exception 'An unestimated feature can only be in the Icebox or an unstarted state' using errcode = 'P0001';
  end if;

  -- Auto-assign to the current iteration on entering an in_progress-category
  -- state from no iteration — mirrors transition_story's shouldAssignCurrentIteration
  -- rule (TASK-19), now keyed on category instead of a specific state name.
  if v_target_category = 'in_progress' and v_story.iteration_id is null then
    perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || v_story.project_id::text));
    select id into v_current_id
      from public.iterations
      where project_id = v_story.project_id and state <> 'done'
      order by number desc
      limit 1;
    if v_current_id is null then
      raise exception 'No active iteration' using errcode = 'P0001';
    end if;
  end if;

  -- Icebox (state_id NULL) never carries an iteration_id — finalize_iteration's
  -- rollover query assumes this holds unconditionally (spec/data-model.md
  -- "Backlog zone predicate").
  update public.stories
    set state_id = p_state_id,
        iteration_id = case
          when p_state_id is null then null
          when v_current_id is not null then v_current_id
          else iteration_id
        end
    where id = p_story_id;
  get diagnostics v_rows = row_count;

  -- The FOR UPDATE above already gated authorization, so this normally hits
  -- the locked row. It can still filter to 0 if the caller's role is
  -- revoked in the window between the two statements (project_role() is
  -- re-evaluated per statement) — an explicit error, not a misleading
  -- success.
  if v_rows = 0 then
    raise exception 'Not allowed to change this story''s state' using errcode = '42501';
  end if;

  return jsonb_build_object('story_id', p_story_id, 'state_id', p_state_id);
end;
$$;

revoke execute on function public.set_story_state(uuid, uuid) from public, authenticated;
grant execute on function public.set_story_state(uuid, uuid) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.set_story_state(uuid, uuid);
-- (transition_story cannot be meaningfully restored — it depended on the
-- stories.state column this task's earlier migration dropped)
