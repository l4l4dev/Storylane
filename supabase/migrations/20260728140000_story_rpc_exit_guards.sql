-- ============================================================
-- TASK-211: exit guards for the three story RPCs left out of the sweep.
--
-- Each authorizes and then writes, with waits in between that the authorization
-- cannot see: create_epic's INSERT parks in assign_story_number's
-- story_number:<project> lock, and both setters authorize through a
-- `select ... for update` that is itself a wait before their UPDATEs. Guarding
-- the exit covers all of it — nothing is durable until commit (spec/rls.md
-- "Guard the EXIT of a SECURITY DEFINER RPC").
--
-- The idempotent early returns are not guarded: they write nothing, so rejecting
-- them would turn a no-op into a 42501 for a caller whose access lapsed.
--
-- The two setters' membership subqueries stay as they are, so an inaccessible
-- story and a nonexistent one both still surface as "Story not found"; the exit
-- guard keys off the project_id that read already established.
-- ============================================================

-- ── create_epic ───────────────────────
create or replace function public.create_epic(p_project_id uuid, p_title text, p_description text DEFAULT NULL::text, p_epic_color text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if p_title is null or btrim(p_title) = '' then
    raise exception 'An epic needs a title' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = auth.uid() and role in ('owner', 'member')
  ) then
    raise exception 'Project not found' using errcode = 'P0001';
  end if;

  -- The personal project's creator is always its sole owner, so the membership
  -- check above does not keep epics out of My Work (TASK-147's pattern).
  if (select is_personal from public.projects where id = p_project_id) then
    raise exception 'Personal tasks cannot be organised into epics' using errcode = 'P0001';
  end if;

  -- points/state_id/iteration_id stay NULL: is_container flips true on insert
  -- (epic_pinned), and the off-board CHECK requires exactly that.
  insert into public.stories (project_id, title, description, story_type, epic_color, epic_pinned, created_by)
  -- nullif: an empty/blank colour is as colourless as NULL (TASK-183).
  values (p_project_id, btrim(p_title), p_description, 'feature',
          coalesce(nullif(btrim(p_epic_color), ''), '#6366f1'), true, auth.uid())
  returning id into v_id;


  -- Exit guard (spec/rls.md "Guard the EXIT of a SECURITY DEFINER RPC"): the
  -- writes above can each wait on a tuple lock, a foreign key, or a trigger
  -- (assign_story_number parks here), all of which are past the authorization
  -- this function performed. Nothing is durable until commit, so raising here
  -- rolls the writes back.
  perform public.require_project_role(p_project_id, 'owner', 'member');

  return v_id;
end;
$function$;

-- ── set_story_parent ───────────────────────
create or replace function public.set_story_parent(p_story_id uuid, p_parent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Exit guard (spec/rls.md "Guard the EXIT of a SECURITY DEFINER RPC"): the
  -- writes above can each wait on a tuple lock, a foreign key, or a trigger
  -- (assign_story_number parks here), all of which are past the authorization
  -- this function performed. Nothing is durable until commit, so raising here
  -- rolls the writes back.
  perform public.require_project_role(v_row.project_id, 'owner', 'member');
end;
$function$;

-- ── set_epic_pinned ───────────────────────
create or replace function public.set_epic_pinned(p_story_id uuid, p_pinned boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.stories%rowtype;
begin
  -- NULL would slip past the idempotence comparison below (NULL = anything is
  -- NULL, not true) and land in the unpin branch.
  if p_pinned is null then
    raise exception 'p_pinned is required' using errcode = 'P0001';
  end if;

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

  if (select is_personal from public.projects where id = v_row.project_id) then
    raise exception 'Personal tasks cannot be organised into epics' using errcode = 'P0001';
  end if;

  -- Ahead of the idempotence return: a container that is one only through child
  -- membership has epic_pinned = false already, and answering "done" to
  -- "stop being an epic" while the row stays an epic is a lie.
  if not p_pinned and exists (select 1 from public.stories where parent_id = p_story_id) then
    raise exception 'This epic still has stories in it — move them out first' using errcode = 'P0001';
  end if;

  if v_row.epic_pinned = p_pinned then
    return; -- idempotent
  end if;

  if p_pinned then
    -- A child cannot gain children, so it cannot be an epic either
    -- (single-level nesting, doc-18 §3).
    if v_row.parent_id is not null then
      raise exception 'A child story cannot become an epic (single-level nesting)' using errcode = 'P0001';
    end if;
    if v_row.points is not null then
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      values (
        v_row.project_id, v_row.id, auth.uid(), 'story.containerized',
        jsonb_build_object('old_points', v_row.points)
      );
    end if;
    update public.stories
      set epic_pinned = true, points = null, state_id = null, iteration_id = null,
          epic_color = coalesce(epic_color, '#6366f1')
      where id = p_story_id;
  else
    -- Board fields stay NULL (doc-18 §4): the story can be re-estimated and
    -- placed normally afterwards.
    update public.stories set epic_pinned = false where id = p_story_id;
  end if;

  -- Exit guard (spec/rls.md "Guard the EXIT of a SECURITY DEFINER RPC"): the
  -- writes above can each wait on a tuple lock, a foreign key, or a trigger
  -- (assign_story_number parks here), all of which are past the authorization
  -- this function performed. Nothing is durable until commit, so raising here
  -- rolls the writes back.
  perform public.require_project_role(v_row.project_id, 'owner', 'member');
end;
$function$;

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
--   create_epic / set_epic_pinned -> 20260724181957_epic_pinned.sql
--   set_story_parent              -> 20260725131513_set_story_parent.sql
-- ============================================================
