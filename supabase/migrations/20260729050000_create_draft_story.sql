-- ============================================================
-- TASK-212: create_draft_story — quick-add in one transaction.
--
-- The draft card's save used to be three round trips from the server action:
-- create, then reposition, then apply the remaining fields. A failure in the
-- last step left a title-only story behind and a retry created a second one,
-- because nothing tied the three together. Wrapping the same three steps in one
-- RPC makes the save atomic, so any failure leaves no row.
--
-- Deliberately a wrapper, not a reimplementation: it inserts the row and then
-- delegates to update_story and move_story_board, the exact RPCs the action
-- called. Re-doing their work here would fork the point-scale clamp, the label
-- replacement and the splice into a second copy each, and the point of this task
-- is atomicity, not new semantics.
--
-- Not folded into insert_board_item: that is a shared primitive the divider path
-- ("+ Add note") also calls, so story-only keys there would make which parts of
-- the payload are meaningful depend on the caller.
--
-- The `unstarted` target resolves the current iteration and the landing state
-- AFTER taking iteration_finalize, not before and not from a parameter. Resolving
-- it first — as the server action did — lets a concurrent finalize_iteration land
-- the new story in an iteration that has just been finalized
-- (spec/velocity.md "Finalization concurrency & permissions").
--
-- SECURITY INVOKER, matching create_story_tracker / update_story and unlike
-- insert_board_item. This is load-bearing, not stylistic: the cross-project label
-- guard is an RLS WITH CHECK on story_labels, and DEFINER would bypass RLS
-- entirely and silently accept a foreign-project label. Under INVOKER the policy
-- fires and, in one transaction, rolls the story back with it — which is the
-- orphan fix. Labels therefore need no pre-validation here, the same way its
-- sibling create paths need none.
--
-- Being INVOKER, the backstop on every write is RLS itself: stories' INSERT
-- policy already demands owner/member and created_by = auth.uid().
-- require_project_role is NOT used for the explicit guards below, because it is
-- revoked from authenticated (it exists for SECURITY DEFINER callers, which is
-- why insert_board_item is DEFINER) and calling it would fail every request;
-- project_role is granted, being policy-referenced, so the guards call that.
--
-- For the same reason this function calls no other revoked helper:
-- _splice_backlog and assert_points_on_scale are both revoked from authenticated
-- too, so an INVOKER caller cannot reach them — which is why positioning goes
-- through move_story_board and the point scale through update_story rather than
-- being open-coded here.
--
-- It still needs TASK-211's exit guard, though, and being INVOKER is NOT a reason
-- to skip it. Per-statement RLS closes the INSERT — a WITH CHECK violation always
-- raises — but update_story's writes are an UPDATE and a DELETE, and there a
-- failed USING clause matches zero rows and raises nothing at all. So a caller
-- demoted to viewer mid-transaction (they keep SELECT visibility, so nothing else
-- notices) had every field silently dropped and still got a success back, leaving
-- the title-only row this whole migration exists to prevent. Measured, not
-- theorised: see create-draft-story.integration.test.ts's demotion case, which
-- fails without the guard below.
-- ============================================================

create or replace function public.create_draft_story(
  p_project_id uuid,
  p_target text,
  p_title text,
  p_view text default 'list',
  p_description text default null,
  p_story_type text default 'feature',
  p_points int default null,
  p_assignee_id uuid default null,
  p_label_ids uuid[] default array[]::uuid[],
  p_anchor jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- Both guards read this one list, so widening or narrowing one cannot leave
  -- the other behind (the shape insert_board_item and move_story_board use).
  v_roles text[] := array['owner', 'member'];
  v_role text;
  v_title text := btrim(coalesce(p_title, ''));
  v_state_id uuid;
  v_iteration_id uuid;
  v_new_id uuid;
  -- Only `unstarted` sits in a per-view ordering (Kanban orders the state
  -- column, List the whole iteration). The other two zones have exactly one
  -- ordering, and move_story_board rejects a backlog-zone move under any view
  -- but 'list', so the parameter is ignored rather than trusted there.
  v_view text := case when p_target = 'unstarted' then coalesce(p_view, 'list') else 'list' end;
begin
  if v_title = '' then
    raise exception 'title required' using errcode = 'P0001';
  end if;
  -- `is null` first: `NULL not in (...)` is NULL, which `if` treats as false, so
  -- the obvious spelling waves a null target through — and every branch below
  -- then reads false too, quietly filing the story in the Icebox. Same trap as
  -- the role guard beneath this one.
  if p_target is null or p_target not in ('backlog', 'unstarted', 'icebox') then
    raise exception 'invalid target: %', coalesce(p_target, 'null') using errcode = 'P0001';
  end if;

  -- RLS would reject the INSERT below on its own, so this is about the message,
  -- not the permission: `iterations` and `project_states` are invisible to a
  -- non-member, so without it the two lookups further down come up empty and a
  -- non-member is told "No active iteration" — a plausible-sounding lie.
  v_role := public.project_role(p_project_id);
  if v_role is null or not (v_role = any(v_roles)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Both locks, in move_story_board's order, for every target — not only for
  -- `unstarted`, which is the only one that reads the current iteration. Taking
  -- just positions here and letting move_story_board add iteration_finalize
  -- underneath it would invert the order against every other board RPC and
  -- deadlock against a concurrent finalize. Re-taking them inside
  -- move_story_board is a no-op: advisory locks are re-entrant per transaction.
  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));
  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  if p_target = 'unstarted' then
    select id into v_iteration_id
      from public.iterations
      where project_id = p_project_id and state <> 'done'
      order by number desc
      limit 1;
    if v_iteration_id is null then
      raise exception 'No active iteration' using errcode = 'P0001';
    end if;
  end if;

  -- Both `backlog` and `unstarted` land in the project's lowest unstarted state;
  -- `icebox` has no state at all (spec/data-model.md "Backlog zone predicate").
  if p_target <> 'icebox' then
    select id into v_state_id
      from public.project_states
      where project_id = p_project_id and category = 'unstarted'
      order by position, id
      limit 1;
    if v_state_id is null then
      raise exception 'project has no unstarted-category state' using errcode = 'P0001';
    end if;
  end if;

  -- Title only, exactly as the action's plain insert did. Every other field is
  -- update_story's job below; position defaults from stories_position_seq, which
  -- lands the row at the zone's end until the splice moves it.
  insert into public.stories (project_id, title, state_id, iteration_id)
  values (p_project_id, v_title, v_state_id, v_iteration_id)
  returning id into v_new_id;

  -- The remaining fields through the same RPC a later edit uses, so the point
  -- scale clamp, the non-pointed-type rule and the label replacement stay in one
  -- place. Its story_labels insert is what an RLS WITH CHECK rejects for a
  -- foreign-project label, and that rejection now rolls the story above back.
  -- New stories are always top-level: nesting happens via the Parent picker or
  -- Split Studio (doc-18), never at quick-create time.
  perform public.update_story(
    v_new_id, v_title, p_description, coalesce(p_story_type, 'feature'),
    p_points, null, p_assignee_id, coalesce(p_label_ids, array[]::uuid[])
  );

  -- Position last: the row has to exist, and carry its final state, before it
  -- can be spliced in. An absent anchor leaves it where the sequence put it, at
  -- the zone's end — which is what an empty panel wants anyway.
  if p_anchor ? 'before' then
    perform public.move_story_board(
      p_project_id,
      jsonb_build_object('kind', 'story', 'id', v_new_id),
      v_view,
      -- Freshly inserted in this transaction, so the snapshot cannot be stale
      -- and it cannot have a parent yet.
      jsonb_build_object('state_id', v_state_id, 'iteration_id', v_iteration_id, 'parent_id', null),
      '{}'::jsonb,
      p_anchor
    );
  end if;

  -- Exit guard (TASK-211's shape, and load-bearing here for the reason in the
  -- header): update_story's UPDATE and DELETE fail SILENTLY under RLS for a
  -- caller demoted while this transaction ran, so nothing above would have
  -- raised. One check at the end covers every path — when move_story_board does
  -- run it carries its own, and when it does not this is the only one. Nothing
  -- is durable until commit, so raising here rolls the insert back.
  v_role := public.project_role(p_project_id);
  if v_role is null or not (v_role = any(v_roles)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return v_new_id;
end;
$$;

revoke execute on function public.create_draft_story(uuid, text, text, text, text, text, int, uuid, uuid[], jsonb) from public, anon;
grant execute on function public.create_draft_story(uuid, text, text, text, text, text, int, uuid, uuid[], jsonb) to authenticated;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.create_draft_story(uuid, text, text, text, text, text, int, uuid, uuid[], jsonb);
-- (and restore createDraftStory's three-step body in
--  apps/web/app/projects/[id]/board/actions.ts)
-- ============================================================
