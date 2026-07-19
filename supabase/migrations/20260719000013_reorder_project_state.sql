-- ============================================================
-- TASK-91 Phase D: reorder_project_state — atomic adjacent-swap for the
-- Settings "States" section's up/down reorder, scoped to a single category
-- (doc-8 §2: states only reorder within their own category).
--
-- swap_adjacent (20260716000002) is NOT reusable here: it operated on the
-- now-dropped custom_statuses/swimlanes tables (TASK-84 removed free mode)
-- and, more fundamentally, its dense 0..n-1 rewrite assumed each of those
-- tables' `position` was its own flat namespace. project_states.position is
-- a single sequence spanning EVERY category in the project at once (the
-- board's left-to-right column order, spec/data-model.md) — a dense rewrite
-- scoped to just one category would collide with other categories' existing
-- position values. This RPC instead swaps the two neighbours' actual
-- position VALUES, which preserves the interleaved cross-category order
-- (project_states.position carries no uniqueness constraint by design —
-- see 20260719000005 — so a value swap can never violate one).
-- ============================================================

create function public.reorder_project_state(
  p_project_id uuid,
  p_state_id uuid,
  p_direction text   -- 'up' | 'down'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
  v_position int;
  v_neighbor_id uuid;
  v_neighbor_position int;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction' using errcode = 'P0001';
  end if;

  perform public.require_project_role(p_project_id, 'owner', 'member');

  -- Dedicated `project_states_positions:` namespace (shared with
  -- create_project_state, 20260719000014), not the `positions:` key used
  -- for stories.position elsewhere — the two tables' position columns are
  -- unrelated resources and sharing one key would serialize story
  -- drag-reorders against board-column edits for no reason.
  perform pg_advisory_xact_lock(hashtext('project_states_positions:' || p_project_id::text));

  select category, position into v_category, v_position
    from public.project_states where id = p_state_id and project_id = p_project_id;
  if v_category is null then
    raise exception 'state not found' using errcode = 'P0002';
  end if;

  -- The nearest same-category neighbour in the requested direction — NOT
  -- necessarily adjacent in the raw position sequence, since other
  -- categories' states can sit between two same-category ones.
  if p_direction = 'up' then
    select id, position into v_neighbor_id, v_neighbor_position
      from public.project_states
      where project_id = p_project_id and category = v_category and position < v_position
      order by position desc limit 1;
  else
    select id, position into v_neighbor_id, v_neighbor_position
      from public.project_states
      where project_id = p_project_id and category = v_category and position > v_position
      order by position asc limit 1;
  end if;

  if v_neighbor_id is null then
    return; -- already at this category's edge; no-op (matches the UI's disabled arrow)
  end if;

  update public.project_states set position = v_neighbor_position where id = p_state_id;
  update public.project_states set position = v_position where id = v_neighbor_id;
end;
$$;

revoke execute on function public.reorder_project_state(uuid, uuid, text) from public, authenticated;
grant execute on function public.reorder_project_state(uuid, uuid, text) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.reorder_project_state(uuid, uuid, text);
