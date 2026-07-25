-- ============================================================
-- set_story_parent — attach a story to an epic, or detach it (doc-20 §5).
--
-- Dropping a story onto an epic row writes parent_id and NOTHING else: its
-- state_id, iteration_id and position stay exactly as they were, matching
-- Tracker's "drag onto the epic, the story does not move".
--
-- Why not move_story_board, which already carries a parent_id delta: its
-- position machinery has no skip-position path, and the no-anchor branch
-- unconditionally writes position = max(position) + 1, so every attach through
-- it would fling the story to the end of its zone. Why not update_story (the
-- Parent picker's path): it is a whole-row update, so a drag would have to
-- read and re-send title/description/points/assignee/labels and would clobber
-- a concurrent edit.
--
-- Why an RPC rather than a client UPDATE: the "parent must already be an epic"
-- rule below is a business rule with a mutation attached, so decision-1 §1/§2
-- puts it in the database — a TS-only guard covers Next.js but not iOS, which
-- talks to Supabase directly and will drag on the same board. It also makes
-- validation and write one transaction; checking is_container in the caller and
-- writing in a second round trip is a TOCTOU window.
-- ============================================================

create or replace function public.set_story_parent(p_story_id uuid, p_parent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.stories%rowtype;
begin
  select * into v_row from public.stories
    where id = p_story_id
      and project_id in (
        select project_id from public.project_members
        where user_id = auth.uid() and role in ('owner', 'member')
      )
    for update;
  if not found then
    raise exception 'Story not found' using errcode = 'P0001';
  end if;

  if v_row.parent_id is not distinct from p_parent_id then
    return; -- idempotent
  end if;

  if p_parent_id is not null then
    -- Attaching only, matching create_epic / set_epic_pinned. Detaching is left
    -- alone so a row that somehow already has a parent can always be freed.
    -- Not a seal: update_story can still reparent a personal task.
    if (select is_personal from public.projects where id = v_row.project_id) then
      raise exception 'Personal tasks cannot be organised into epics' using errcode = 'P0001';
    end if;

    -- This gesture's own rule, deliberately NOT a table-wide invariant: the
    -- Parent picker offers every top-level story and containerizes bottom-up on
    -- purpose (doc-18 §9), so enforce_single_level_nesting must keep allowing a
    -- plain parent. A drag has no such confirmation step, so silently
    -- containerizing whatever was under the cursor — recompute_is_container then
    -- clears its points/state/iteration — is the loss this refuses. Doubles as
    -- the malformed-uuid guard: a non-uuid matches no row instead of surfacing a
    -- raw 22P02 from the UPDATE below.
    if not exists (
      select 1 from public.stories
      where id = p_parent_id and project_id = v_row.project_id and is_container
    ) then
      raise exception 'That epic no longer exists. Refresh and try again.' using errcode = 'P0001';
    end if;
  end if;

  -- parent_id alone. Hierarchy legality (self-parent, cross-project, max depth
  -- 1, a story with children or a pinned epic becoming a child) belongs to
  -- enforce_single_level_nesting, and containerization to derive_is_container /
  -- recompute_is_container — doc-18 §3/§4, not re-implemented here.
  --
  -- The exists() check above reads the parent without locking it. That does not
  -- avoid the A→B / B→A deadlock — maintain_is_container's AFTER trigger locks
  -- the parent FOR UPDATE anyway (via recompute_is_container), so two crossed
  -- attaches can still deadlock there and Postgres aborts one, exactly as for
  -- every other caller that reparents. What the unlocked read avoids is holding
  -- that lock for longer than the fixup needs it. It is safe because the same
  -- AFTER trigger re-reads the parent under its own lock: a concurrent unpin
  -- landing between the check and the write still converges, since the recompute
  -- then sees this new child and keeps is_container true.
  update public.stories set parent_id = p_parent_id where id = p_story_id;
end;
$$;

revoke execute on function public.set_story_parent(uuid, uuid) from public, anon;
grant execute on function public.set_story_parent(uuid, uuid) to authenticated;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.set_story_parent(uuid, uuid);
-- ============================================================
