-- ============================================================
-- TASK-57: transactional adjacent swap for custom_statuses / swimlanes.
-- Advisor-approved (Fable, 2026-07-16) — RPC #3 of the TASK-56 position-rules
-- DESIGN, concretised.
--
-- moveCustomStatus / moveLane (settings/actions.ts) each read the ordered list,
-- then swapped two neighbours' position VALUES with two independent parallel
-- UPDATEs — no transaction, no lock (doc-1 High concurrency; TASK-26 added
-- result checks but not atomicity). Two concurrent swaps from the same stale
-- snapshot could leave duplicate positions, and the action coerced any
-- direction other than the exact string 'up' to 'down' (doc-1 Low) instead of
-- rejecting it.
--
-- This RPC serialises every swap for a project under the family's single
-- 'positions:' advisory lock, then applies the DESIGN's core rule: read the
-- CURRENT order under the lock, move the item one step, and rewrite dense
-- positions 0..n-1. Rewriting (not value-swapping) self-heals any duplicate
-- positions the old non-atomic path may have already left in the data — a bare
-- value-swap would preserve them, and neighbour-by-nearest-position breaks when
-- two rows share a position. Lists are a handful of rows, so the full rewrite
-- is free.
--
-- Cross-tenant: the ordered read is scoped `where project_id = p_project_id`,
-- so a status/lane id from another project is simply absent from the array →
-- P0002 (mirrors the guard rls-security-reviewer required on move_story_board's
-- divider branch). Every UPDATE targets an id that came from that scoped read.
--
-- Lock: positions key ONLY — this path never touches iteration_id, so (like
-- insert_board_item) it does not take the iteration_finalize lock. The
-- advisory lock is the serialisation mechanism (same as move_story_board's
-- reads), so the ordered read needs no FOR UPDATE — and array_agg could not
-- carry one anyway.
--
-- Signature note: DESIGN listed swap_adjacent(p_table, p_id, p_direction);
-- p_project_id is added to match move_story_board / insert_board_item and
-- because the role check and lock key both need it.
-- ============================================================

create function public.swap_adjacent(
  p_project_id uuid,
  p_table text,       -- 'custom_statuses' | 'swimlanes'
  p_id uuid,
  p_direction text    -- 'up' | 'down'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_ids uuid[];
  v_index int;
  v_swap int;
  v_tmp uuid;
  i int;
begin
  if p_table not in ('custom_statuses', 'swimlanes') then
    raise exception 'invalid table' using errcode = 'P0001';
  end if;
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction' using errcode = 'P0001';
  end if;

  v_role := public.project_role(p_project_id);
  if v_role is null or v_role not in ('owner', 'member') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('positions:' || p_project_id::text));

  -- Read the current order (project-scoped: a foreign id can't appear here).
  -- Static branch per table so no dynamic SQL / %I is needed.
  if p_table = 'custom_statuses' then
    select array_agg(id order by position, id) into v_ids
      from public.custom_statuses where project_id = p_project_id;
  else
    select array_agg(id order by position, id) into v_ids
      from public.swimlanes where project_id = p_project_id;
  end if;

  v_index := array_position(v_ids, p_id);
  if v_index is null then
    raise exception 'row not found' using errcode = 'P0002';
  end if;

  v_swap := case when p_direction = 'up' then v_index - 1 else v_index + 1 end;
  if v_swap < 1 or v_swap > array_length(v_ids, 1) then
    return;  -- already at the edge; no-op (matches the UI's disabled arrow)
  end if;

  v_tmp := v_ids[v_index];
  v_ids[v_index] := v_ids[v_swap];
  v_ids[v_swap] := v_tmp;

  -- Dense-rewrite 0..n-1 in the new order (also normalises any pre-existing
  -- duplicate/gapped positions from the old non-atomic path).
  if p_table = 'custom_statuses' then
    for i in 1 .. array_length(v_ids, 1) loop
      update public.custom_statuses set position = i - 1 where id = v_ids[i];
    end loop;
  else
    for i in 1 .. array_length(v_ids, 1) loop
      update public.swimlanes set position = i - 1 where id = v_ids[i];
    end loop;
  end if;
end;
$$;

-- Per the TASK-55 grant lockdown: revoke the implicit grants, re-grant EXECUTE
-- to authenticated explicitly. Keep the grant-lockdown allowlist test in sync.
revoke execute on function public.swap_adjacent(uuid, text, uuid, text) from public, authenticated;
grant execute on function public.swap_adjacent(uuid, text, uuid, text) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.swap_adjacent(uuid, text, uuid, text);
