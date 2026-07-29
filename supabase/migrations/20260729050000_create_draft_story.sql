-- ============================================================
-- create_draft_story — the draft card's save (spec/screens.md "Quick-add") as a
-- single transaction: insert, fields, position. Any failure leaves no row.
--
-- A wrapper, not a reimplementation. It delegates to update_story and
-- move_story_board rather than doing their work, because open-coding it would
-- fork the point-scale clamp, the label replacement and the backlog splice into
-- a second copy each.
--
-- Not folded into insert_board_item: that is a shared primitive the divider path
-- ("+ Add note") also calls, so story-only keys there would make which parts of
-- the payload are meaningful depend on the caller.
--
-- The `unstarted` target resolves the current iteration AFTER taking
-- iteration_finalize, never from a parameter: resolving it first lets a
-- concurrent finalize_iteration land the story in an iteration that has just
-- closed (spec/velocity.md "Finalization concurrency & permissions").
--
-- SECURITY INVOKER, unlike insert_board_item, and load-bearing rather than
-- stylistic: the cross-project label guard is an RLS WITH CHECK on story_labels,
-- which DEFINER bypasses entirely, silently accepting a foreign-project label.
-- Under INVOKER the policy fires and rolls the story back with it. That is why
-- labels need no pre-validation here.
--
-- Being INVOKER also decides which helpers are reachable: require_project_role,
-- _splice_backlog and assert_points_on_scale are all revoked from authenticated
-- (they exist for SECURITY DEFINER callers), so the guards below call
-- project_role, which is granted because policies reference it, and positioning
-- and the point scale go through the two granted RPCs.
--
-- INVOKER is NOT a reason to skip TASK-211's exit guard. Per-statement RLS closes
-- the INSERT, because a WITH CHECK violation always raises. But update_story's
-- writes are an UPDATE and a DELETE, where a failed USING clause matches zero
-- rows and raises nothing — so a caller demoted mid-transaction keeps SELECT
-- visibility, has every field silently dropped, and gets success back. The
-- demotion case in create-draft-story.integration.test.ts fails without the
-- guard.
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

  -- iteration_finalize for every target, not only `unstarted` (the one that
  -- reads the current iteration): taking just positions here and letting
  -- move_story_board add iteration_finalize underneath would invert the order
  -- against every other board RPC and deadlock against a concurrent finalize.
  -- Re-taking it there is a no-op — advisory locks are re-entrant per
  -- transaction.
  perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));
  -- positions only when something is actually spliced, but taken HERE rather
  -- than beside the move_story_board call below: the INSERT's numbering trigger
  -- takes story_number, and the order is positions -> story_number
  -- (insert_board_item, split_story).
  if p_anchor ? 'before' then
    perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));
  end if;

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
      -- board/actions.ts's draftErrorMessage matches on this string to swap in a
      -- user-facing message; reword it there too.
      raise exception 'project has no unstarted-category state' using errcode = 'P0001';
    end if;
  end if;

  -- Title only; every other field is update_story's job below. position defaults
  -- from stories_position_seq, landing the row at the zone's end until the splice
  -- moves it.
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
