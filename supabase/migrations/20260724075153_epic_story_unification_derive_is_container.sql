-- ============================================================
-- TASK-182 (rls-security-reviewer remediation): pin is_container to the truth.
--
-- HIGH finding: stories has an unconditional member UPDATE policy (TASK-70) and
-- a blanket column-less GRANT UPDATE to authenticated (20260630000002), and no
-- trigger guarded the is_container column itself — maintain_is_container only
-- fires on parent_id writes. So a raw REST PATCH `UPDATE stories SET
-- is_container = false, points = 5, state_id = ...` let a member un-containerize
-- a real epic (children still nested) and route around the off-board CHECK and
-- the set_story_state guard, both of which trust is_container. decision-1 says
-- the off-board property must hold at all times, DB-enforced.
--
-- Fix: derive is_container from actual child membership on every INSERT/UPDATE,
-- overwriting whatever the client sent. Same class of fix as
-- protect_projects_is_personal (20260721000004), but derived rather than pinned
-- to OLD, because recompute_is_container legitimately flips it — and its own
-- write already equals this derived value, so it needs no change. A forged
-- is_container = false on a container is forced back to true, at which point a
-- re-estimation in the same statement (points/state) trips the off-board CHECK.
-- SECURITY DEFINER so the child-existence probe is not filtered by the caller's
-- RLS. Runs before enforce_single_level_nesting alphabetically; both touch
-- disjoint columns so ordering is immaterial.
-- ============================================================

create or replace function public.derive_is_container()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_container := exists (select 1 from public.stories where parent_id = new.id);
  return new;
end;
$$;

-- Trigger-body function: fires regardless of the invoker's EXECUTE grant, so
-- revoke it from every client role (function_grant_lockdown convention).
revoke execute on function public.derive_is_container() from public, anon, authenticated;

create trigger stories_derive_is_container
  before insert or update on public.stories
  for each row execute function public.derive_is_container();

-- DOWN (rollback — not auto-applied):
-- drop trigger stories_derive_is_container on public.stories;
-- drop function public.derive_is_container();
