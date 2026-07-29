-- ============================================================
-- TASK-212: create_draft_story — quick-add in one transaction.
--
-- The draft card's save used to be three round trips: create, then reposition,
-- then apply the remaining fields. A failure in the last step left a title-only
-- story behind and a retry created a second one, because nothing tied the three
-- together. One RPC makes the whole save atomic, so any failure leaves no row.
--
-- Not folded into insert_board_item: that is a shared primitive the divider path
-- ("+ Add note") also calls, so story-only keys there would make which parts of
-- the payload are meaningful depend on the caller.
--
-- The `unstarted` target resolves the current iteration and the landing state
-- AFTER taking iteration_finalize, not before and not from a parameter. Resolving
-- it first — as the server action did — lets a concurrent finalize_iteration land
-- the new story in an iteration that has just been finalized
-- (spec/velocity.md "Finalization concurrency & permissions"). move_story_board
-- takes the same two locks for the same reason.
--
-- SECURITY INVOKER, matching create_story_tracker / update_story / set_story_state
-- and unlike insert_board_item. This is load-bearing, not stylistic: the
-- cross-project label guard is an RLS WITH CHECK on story_labels, and DEFINER
-- would bypass RLS entirely and silently accept a foreign-project label. Under
-- INVOKER the policy fires and, in one transaction, rolls the story back with it —
-- which is the orphan fix. Labels therefore need no pre-validation here, the same
-- way its sibling create paths need none.
--
-- Being INVOKER, authorization is RLS itself — exactly how create_story_tracker
-- does it. require_project_role is NOT called: it is revoked from authenticated
-- (that helper exists for SECURITY DEFINER callers, which is why
-- insert_board_item is DEFINER), so calling it here would fail every request with
-- "permission denied for function require_project_role".
--
-- That also means there is no exit guard to add in the TASK-211 sense: RLS
-- re-evaluates on every statement below as the caller, including after any wait,
-- so the protection an explicit re-check provides for DEFINER functions is
-- already present here.
-- ============================================================

create or replace function public.create_draft_story(
  p_project_id uuid,
  p_target text,
  p_title text,
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
  v_title text := btrim(coalesce(p_title, ''));
  v_state_id uuid;
  v_iteration_id uuid;
  v_new_id uuid;
  v_before_kind text := p_anchor->'before'->>'kind';
  v_before_id uuid := (p_anchor->'before'->>'id')::uuid;
begin
  if v_title = '' then
    raise exception 'title required' using errcode = 'P0001';
  end if;
  if p_target not in ('backlog', 'unstarted', 'icebox') then
    raise exception 'invalid target: %', p_target using errcode = 'P0001';
  end if;

  -- The current iteration is only meaningful under iteration_finalize, so the
  -- unstarted target takes it before resolving anything.
  if p_target = 'unstarted' then
    perform pg_advisory_xact_lock(hashtext('iteration_finalize:' || p_project_id::text));
  end if;
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

  insert into public.stories (
    project_id, title, description, story_type, points, assignee_id, state_id, iteration_id
  )
  values (
    p_project_id, v_title, nullif(btrim(coalesce(p_description, '')), ''),
    coalesce(p_story_type, 'feature'), p_points, p_assignee_id, v_state_id, v_iteration_id
  )
  returning id into v_new_id;

  if coalesce(array_length(p_label_ids, 1), 0) > 0 then
    insert into public.story_labels (story_id, label_id)
    select v_new_id, x from (select distinct unnest(p_label_ids) as x) d where x is not null;
  end if;

  -- Reuses the shared check rather than inlining the scale values, which would
  -- be another copy of a literal TASK-219 is already reducing.
  if p_points is not null then
    perform public.assert_points_on_scale(p_project_id, v_new_id);
  end if;

  -- Position last: the row has to exist before it can be spliced in. An absent
  -- anchor leaves it where stories_position_seq put it, at the zone's end.
  if v_before_id is not null then
    perform public._splice_backlog(p_project_id, 'story', v_new_id, v_before_kind, v_before_id);
  end if;

  return v_new_id;
end;
$$;

revoke execute on function public.create_draft_story(uuid, text, text, text, text, int, uuid, uuid[], jsonb) from public, anon;
grant execute on function public.create_draft_story(uuid, text, text, text, text, int, uuid, uuid[], jsonb) to authenticated;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.create_draft_story(uuid, text, text, text, text, int, uuid, uuid[], jsonb);
-- (and restore createDraftStory's three-step body in
--  apps/web/app/projects/[id]/board/actions.ts)
-- ============================================================
