-- ============================================================
-- Board lock-order invariant: iteration_finalize:<project> is acquired before
-- any story row lock, by every RPC that takes both. Reversing it in one function
-- is enough to deadlock it against the others (40P01) — see
-- set-story-state-lock-order.integration.test.ts.
--
-- The key is derived from the story, so the lock cannot sit at the top of the
-- function: the unlocked read below exists only to resolve project_id, and the
-- authoritative locked read still follows it. That unlocked read is RLS-filtered,
-- so it grants nothing; it uses an `is null` test rather than `perform ... if not
-- found` because `perform` sets FOUND and nothing could then be placed between
-- the probe and the branch reading it.
--
-- The lock is unconditional, so a project's state changes serialize against each
-- other and against a finalize. Taking it only on the branch that needs it would
-- require the condition evaluated before the lock and re-checked under it, which
-- is the staleness problem TASK-219 covers.
-- ============================================================

create or replace function public.set_story_state(p_story_id uuid, p_state_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_role text;
  v_story record;
  v_target_category text;
  v_current_id uuid;
  v_is_personal boolean;
  v_rows int;
begin
  -- Unlocked, and only to build the advisory-lock key below. RLS applies, so a
  -- caller who cannot see the story cannot tell it from one that does not exist.
  select project_id into v_project_id from public.stories where id = p_story_id;
  if v_project_id is null then
    raise exception 'Story not found' using errcode = 'P0002';
  end if;

  -- Authorize, then serialize — the order every sibling RPC uses. Without this a
  -- caller who can merely SEE the story (the SELECT policy admits a viewer) would
  -- queue on, and briefly hold, a project-wide lock on a call certain to be
  -- refused. The FOR UPDATE below stays authoritative; this only raises the same
  -- code and message earlier. `is null` first because project_role returns NULL
  -- for a non-member and `NULL not in (...)` is NULL, which `if` reads as false.
  v_role := public.project_role(v_project_id);
  if v_role is null or not (v_role = any(array['owner', 'member'])) then
    raise exception 'Not allowed to change this story''s state' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || v_project_id::text));

  -- Authoritative locked read. SECURITY INVOKER means RLS reaches this
  -- FOR UPDATE, applying the stories UPDATE policy — a caller who may READ but
  -- not WRITE this story is filtered to 0 rows here.
  select project_id, state_id, story_type, points, iteration_id, is_container
    into v_story
    from public.stories
    where id = p_story_id
    for update;
  if not found then
    raise exception 'Not allowed to change this story''s state' using errcode = '42501';
  end if;

  -- A container has no board state (doc-18 §4) — its progress rolls up from its
  -- children. Reject before the raw CHECK does, with an actionable message.
  if v_story.is_container then
    raise exception 'A container has no board state — split or regroup its children instead' using errcode = 'P0001';
  end if;

  -- Personal projects are a purely personal surface (doc-15): no estimation,
  -- no iterations. Read the flag (member-visible under INVOKER) to skip the
  -- auto-assign below.
  select is_personal into v_is_personal from public.projects where id = v_story.project_id;

  if p_state_id is not null then
    select category into v_target_category
      from public.project_states
      where id = p_state_id and project_id = v_story.project_id;
    if not found then
      raise exception 'Target state not found in this project' using errcode = 'P0002';
    end if;
  end if;

  -- Auto-assign to the current iteration on entering an in_progress-category
  -- state from no iteration — skipped for personal projects (they never have
  -- iterations; the story stays iteration-less). iteration_finalize is already
  -- held from above, so this read is as safe as it was when the branch took the
  -- lock itself.
  if not coalesce(v_is_personal, false)
     and v_target_category = 'in_progress' and v_story.iteration_id is null then
    select id into v_current_id
      from public.iterations
      where project_id = v_story.project_id and state <> 'done'
      order by number desc
      limit 1;
    if v_current_id is null then
      raise exception 'No active iteration' using errcode = 'P0001';
    end if;
  end if;

  -- The estimation gate fires here, from stories_enforce_board_invariants.
  -- Icebox (state_id NULL) never carries an iteration_id.
  update public.stories
    set state_id = p_state_id,
        iteration_id = case
          when p_state_id is null then null
          when v_current_id is not null then v_current_id
          else iteration_id
        end
    where id = p_story_id;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'Not allowed to change this story''s state' using errcode = '42501';
  end if;

  return jsonb_build_object('story_id', p_story_id, 'state_id', p_state_id);
end;
$$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- Restore the body from 20260728040200_set_story_state_drop_duplicated_gate.sql,
-- which reintroduces the inversion this migration removes.
-- ============================================================
