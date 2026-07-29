-- ============================================================
-- set_story_state: take iteration_finalize BEFORE the story's row lock.
--
-- Every other board RPC acquires iteration_finalize:<project> first and only
-- then touches rows — move_story_board, insert_board_item's positions sibling,
-- finalize_iteration. set_story_state was the one exception: it took the story's
-- FOR UPDATE first and asked for iteration_finalize afterwards, and only on the
-- branch that auto-assigns the current iteration. Two callers on the same story
-- could therefore hold each half of the pair and wait for the other:
--
--   set_story_state   holds the story row, waits for iteration_finalize
--   move_story_board  holds iteration_finalize, waits for the story row
--
-- which Postgres resolves by aborting one with 40P01. Reproducible today against
-- a drag; create_draft_story reaches the same splice, so quick-add shares it.
-- See set-story-state-lock-order.integration.test.ts.
--
-- The lock key is derived from the story, so it cannot simply move to the top of
-- the function: an unlocked read resolves project_id purely to build the key,
-- and the authoritative locked read follows unchanged. That first read is
-- RLS-filtered exactly as the existence probe it replaces was, so a caller who
-- cannot see the story still gets 'Story not found'. It also replaces
-- `perform 1 ... if not found` with an `is null` test on purpose: `perform` sets
-- FOUND, so a lock acquisition could not have been placed between that probe and
-- the branch reading it.
--
-- The lock is now unconditional, where it used to guard only the
-- in_progress-from-no-iteration branch. That serializes a project's state
-- changes against each other and against a finalize — the cost move_story_board
-- already pays on every drag, and board mutations are human-paced. The
-- alternative, keeping it conditional, needs the condition evaluated before the
-- lock and re-checked after it, which is the staleness problem TASK-219 exists
-- to address; it does not belong in a deadlock fix.
--
-- Rebuilt from the live definition (pg_get_functiondef), not from an earlier
-- migration, so nothing shipped since 20260728040200 is reverted.
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
  -- caller who cannot see the story lands on the same 'Story not found' the
  -- existence probe this replaces produced.
  select project_id into v_project_id from public.stories where id = p_story_id;
  if v_project_id is null then
    raise exception 'Story not found' using errcode = 'P0002';
  end if;

  -- Ahead of the lock, matching every sibling RPC: authorize, then serialize.
  -- Hoisting the lock without this would make this the one RPC where a caller who
  -- can merely SEE the story (the SELECT policy admits a viewer) queues on — and
  -- briefly holds — a project-wide lock on a call certain to be refused. Raises
  -- the same code and message the FOR UPDATE below produces, so nothing a client
  -- sees changes. That FOR UPDATE remains the authoritative check; this is a
  -- gate, not a replacement. `is null` first because project_role returns NULL
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
