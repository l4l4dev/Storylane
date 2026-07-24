-- ============================================================
-- TASK-179 / doc-18 §3-§4: hierarchy integrity triggers.
--
-- Two triggers keep the parent_id hierarchy correct with no dedicated UI:
--   1. enforce_single_level_nesting — depth capped at 1, same-project only.
--   2. maintain_is_container — is_container derived from child membership;
--      on becoming a container the story's board fields are cleared (doc-18 §4)
--      and the lost points are audited to activity_logs.
--
-- All three functions are SECURITY DEFINER: they enforce a system invariant and
-- must see every row (RLS could otherwise hide a sibling and make an illegal
-- nest look legal) and write activity_logs (which has no client INSERT policy).
-- They are trigger/helper bodies, never called as RPCs, so EXECUTE is revoked
-- from public/authenticated (service_role keeps its default) — grant-lockdown.
-- ============================================================

-- 1. Depth-1, same-project nesting guard (doc-18 §3).
create or replace function public.enforce_single_level_nesting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_project uuid;
  v_parent_parent  uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'a story cannot be its own parent';
  end if;

  select project_id, parent_id into v_parent_project, v_parent_parent
  from public.stories where id = new.parent_id;

  -- parent_id is a single-column FK (ON DELETE SET NULL, doc-18 §2) — it carries
  -- no project guard, so a cross-project parent must be rejected here.
  if v_parent_project is distinct from new.project_id then
    raise exception 'parent story must be in the same project';
  end if;

  -- Max depth 1: the intended parent must not itself be a child.
  if v_parent_parent is not null then
    raise exception 'cannot nest under a story that is itself a child (max depth = 1)';
  end if;

  -- Symmetric guard: a story that already has children cannot become a child.
  if exists (select 1 from public.stories where parent_id = new.id) then
    raise exception 'a story with children cannot become a child itself';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_single_level_nesting() from public, authenticated;

create trigger stories_enforce_single_level_nesting
  before insert or update of parent_id on public.stories
  for each row execute function public.enforce_single_level_nesting();

-- 2b. Recompute one parent candidate's is_container (doc-18 §4). Locks the
--     parent row so concurrent child writes can't double-flip / double-log.
create or replace function public.recompute_is_container(p_parent uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row          public.stories%rowtype;
  v_has_children boolean;
begin
  if p_parent is null then
    return;
  end if;

  select * into v_row from public.stories where id = p_parent for update;
  if not found then
    return; -- parent already deleted (its children's parent_id SET NULL first)
  end if;

  v_has_children := exists (select 1 from public.stories where parent_id = p_parent);

  if v_has_children and not v_row.is_container then
    -- false -> true. Audit the points that are about to be lost (the only place
    -- the value survives — doc-18 §4). state_id/iteration_id are cleared in the
    -- same statement so the off-board CHECK (doc-18 §4 / TASK-178) holds;
    -- completed_at is cleared for free by maintain_story_completed_at (BEFORE
    -- UPDATE) since state_id goes NULL.
    if v_row.points is not null then
      insert into public.activity_logs (project_id, story_id, actor_id, action, payload)
      values (
        v_row.project_id, v_row.id, auth.uid(), 'story.containerized',
        jsonb_build_object('old_points', v_row.points)
      );
    end if;
    update public.stories
      set is_container = true, points = null, state_id = null, iteration_id = null
      where id = p_parent;
  elsif not v_has_children and v_row.is_container then
    update public.stories set is_container = false where id = p_parent;
  end if;
end;
$$;

revoke execute on function public.recompute_is_container(uuid) from public, authenticated;

-- 2a. Maintain is_container on every parent_id write. Scoped to `UPDATE OF
--     parent_id` so the recompute's own UPDATE (which changes is_container /
--     board fields, never parent_id) does not re-fire it — no recursion.
create or replace function public.maintain_is_container()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_is_container(old.parent_id);
    return old;
  elsif tg_op = 'INSERT' then
    perform public.recompute_is_container(new.parent_id);
    return new;
  else -- UPDATE OF parent_id
    if new.parent_id is distinct from old.parent_id then
      perform public.recompute_is_container(old.parent_id);
      perform public.recompute_is_container(new.parent_id);
    end if;
    return new;
  end if;
end;
$$;

revoke execute on function public.maintain_is_container() from public, authenticated;

create trigger stories_maintain_is_container
  after insert or delete or update of parent_id on public.stories
  for each row execute function public.maintain_is_container();

-- ============================================================
-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop trigger stories_maintain_is_container on public.stories;
-- drop trigger stories_enforce_single_level_nesting on public.stories;
-- drop function public.maintain_is_container();
-- drop function public.recompute_is_container(uuid);
-- drop function public.enforce_single_level_nesting();
-- ============================================================
