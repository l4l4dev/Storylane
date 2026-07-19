-- ============================================================
-- TASK-91: create_project_state — atomic insert for the Settings "States"
-- section's "+ Add" and the board's "+ Add column".
--
-- Plain client-side insert (the original createProjectState) appended the
-- new row at the END OF THE WHOLE PROJECT'S position sequence, not the
-- end of its own category's block. computeStateGate (packages/core
-- story-state.ts) walks `states` sorted by position and treats the
-- immediate successor as "next" — it assumes each category occupies a
-- contiguous run of positions. A state appended past every other category
-- (e.g. an in_progress state landing after Rejected) breaks that
-- contiguity: reordering it back in with reorder_project_state (adjacent
-- same-category swap) pushes whatever it swaps past OUT of its own
-- category's block instead, corrupting the advance graph for unrelated
-- states. Inserting directly into the category's own block (shifting
-- every position at or after the insertion point by one) keeps every
-- category contiguous from the moment of creation, no manual reorder
-- required.
--
-- The insertion point is "the position right after the last existing row
-- whose category sorts at or before this one" (unstarted < in_progress <
-- done < rejected), not "the last row of this exact category" — a project
-- can have zero rows in the target category (e.g. the 'minimal' template
-- seeds no 'rejected' row at all), and computing off an empty same-category
-- set would land the new row at position 0, ahead of everything, rather
-- than after the nearest preceding category's block.
--
-- Own advisory lock namespace (`project_states_positions:<project_id>`,
-- shared with reorder_project_state, 20260719000013) distinct from the
-- `positions:<project_id>` key used throughout supabase/migrations/ for
-- stories.position — those serialize an unrelated table/resource and
-- sharing one key would block story drag-reorders on board-column edits
-- (and vice versa) for no reason.
-- ============================================================

create function public.create_project_state(
  p_project_id uuid,
  p_name text,
  p_category text,
  p_action_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_rank int;
  v_position int;
  v_id uuid;
begin
  if p_category not in ('unstarted', 'in_progress', 'done', 'rejected') then
    raise exception 'invalid category' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'name is required' using errcode = 'P0001';
  end if;

  perform public.require_project_role(p_project_id, 'owner', 'member');

  perform pg_advisory_xact_lock(hashtext('project_states_positions:' || p_project_id::text));

  v_category_rank := case p_category
    when 'unstarted' then 0
    when 'in_progress' then 1
    when 'done' then 2
    else 3 -- 'rejected'
  end;

  select coalesce(max(position), -1) + 1 into v_position
    from public.project_states
    where project_id = p_project_id
      and (case category
             when 'unstarted' then 0
             when 'in_progress' then 1
             when 'done' then 2
             else 3
           end) <= v_category_rank;

  update public.project_states
    set position = position + 1
    where project_id = p_project_id and position >= v_position;

  insert into public.project_states (project_id, name, action_label, category, position)
    values (p_project_id, trim(p_name), p_action_label, p_category, v_position)
    returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_project_state(uuid, text, text, text) from public, authenticated;
grant execute on function public.create_project_state(uuid, text, text, text) to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.create_project_state(uuid, text, text, text);
