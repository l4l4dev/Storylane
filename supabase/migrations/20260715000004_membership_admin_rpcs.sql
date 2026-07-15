-- ============================================================
-- TASK-54: protect the last owner; make membership mutations RPC-only.
-- Advisor-approved design (Fable, 2026-07-12; task notes).
--
-- Codex (doc-1, High): the project_members owner UPDATE/DELETE policies
-- (20260627000002) let any owner demote or delete ANY membership row —
-- including the final owner — so a project could become ownerless (no
-- settings/archive/delete/admin possible), and invite_member's upsert let an
-- owner overwrite another owner's role.
--
-- Fix: role changes and removals go through two SECURITY DEFINER RPCs that
-- take a per-project membership advisory lock and reject demoting/removing
-- the last owner; the direct owner UPDATE/DELETE policies are dropped so no
-- table write can bypass the invariant; invite_member becomes insert-only so
-- re-inviting can never change an existing member's role.
-- ============================================================

-- Serializes concurrent membership admin actions for a project so the
-- "count owners, then mutate" check can't race two demotions into an
-- ownerless project. Distinct namespace from finalize_iteration's lock.
create function public.change_member_role(p_project_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- coalesce: project_role() is a bare scalar subquery returning SQL NULL for
  -- an outsider; `NULL <> 'owner'` is NULL, which `if` treats as false and
  -- would skip the guard (the footgun already fixed in invite_member).
  if coalesce(public.project_role(p_project_id), '') <> 'owner' then
    raise exception 'Only project owners can change member roles';
  end if;

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'Invalid role: %', p_role;
  end if;

  perform pg_advisory_xact_lock(hashtext('membership:' || p_project_id::text));

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id
  ) then
    raise exception 'That user is not a member of this project';
  end if;

  -- Last-owner invariant: demoting the only owner leaves the project
  -- ownerless. Count owners under the lock so a concurrent demotion can't
  -- also pass this check.
  if p_role <> 'owner'
    and exists (
      select 1 from public.project_members
      where project_id = p_project_id and user_id = p_user_id and role = 'owner'
    )
    and (
      select count(*) from public.project_members
      where project_id = p_project_id and role = 'owner'
    ) <= 1
  then
    raise exception 'Cannot demote the last owner of the project';
  end if;

  update public.project_members set role = p_role
  where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- An owner may remove anyone; anyone may remove themselves (self-leave — a
-- gap today, since the owner-only DELETE policy blocked non-owners from
-- leaving). The last owner cannot be removed by any path.
create function public.remove_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := public.project_role(p_project_id);
begin
  if v_caller_role is null then
    -- Outsider with no membership row — not a member of this project at all.
    raise exception 'Not a member of this project';
  end if;
  if v_caller_role <> 'owner' and auth.uid() is distinct from p_user_id then
    raise exception 'Only project owners can remove other members';
  end if;

  perform pg_advisory_xact_lock(hashtext('membership:' || p_project_id::text));

  if not exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id
  ) then
    -- Idempotent: already not a member.
    return;
  end if;

  if exists (
      select 1 from public.project_members
      where project_id = p_project_id and user_id = p_user_id and role = 'owner'
    )
    and (
      select count(*) from public.project_members
      where project_id = p_project_id and role = 'owner'
    ) <= 1
  then
    raise exception 'Cannot remove the last owner of the project';
  end if;

  delete from public.project_members
  where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- invite_member becomes insert-only: re-inviting an existing member is
-- rejected rather than silently overwriting their role (the owner-overwrite
-- hole). ON CONFLICT DO NOTHING + a `not found` check keeps it race-safe
-- against a concurrent double-invite of a new user.
create or replace function public.invite_member(p_project_id uuid, p_user_id uuid, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.project_role(p_project_id), '') <> 'owner' then
    raise exception 'Only project owners can invite members';
  end if;

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'Invalid role: %', p_role;
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such user';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_user_id, p_role)
  on conflict (project_id, user_id) do nothing;

  if not found then
    raise exception 'That user is already a member of this project';
  end if;
end;
$$;

-- Role changes and removals are RPC-only now — drop the direct owner
-- UPDATE/DELETE policies so no table write can bypass the last-owner
-- invariant. SELECT and the owner INSERT policy stay (the latter is inert
-- while every insert path is SECURITY DEFINER, but kept for parity with the
-- design and in case a future direct-insert admin path is added).
drop policy "owners can update member roles" on public.project_members;
drop policy "owners can remove members" on public.project_members;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- create policy "owners can update member roles" on public.project_members
--   for update to authenticated
--   using (public.project_role(project_id) = 'owner')
--   with check (public.project_role(project_id) = 'owner');
-- create policy "owners can remove members" on public.project_members
--   for delete to authenticated
--   using (public.project_role(project_id) = 'owner');
-- -- restore invite_member's upsert body (from 20260712000001):
-- create or replace function public.invite_member(p_project_id uuid, p_user_id uuid, p_role text default 'member')
-- returns void language plpgsql security definer set search_path = public as $$
-- begin
--   if coalesce(public.project_role(p_project_id), '') <> 'owner' then
--     raise exception 'Only project owners can invite members';
--   end if;
--   if p_role not in ('owner', 'member', 'viewer') then
--     raise exception 'Invalid role: %', p_role;
--   end if;
--   if not exists (select 1 from public.profiles where id = p_user_id) then
--     raise exception 'No such user';
--   end if;
--   insert into public.project_members (project_id, user_id, role)
--   values (p_project_id, p_user_id, p_role)
--   on conflict (project_id, user_id) do update set role = excluded.role;
-- end;
-- $$;
-- drop function public.remove_member(uuid, uuid);
-- drop function public.change_member_role(uuid, uuid, text);
