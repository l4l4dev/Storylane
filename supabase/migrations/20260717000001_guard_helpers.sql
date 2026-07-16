-- ============================================================
-- TASK-58 item (c): shared guard helpers (incremental adoption).
-- Advisor-approved (Fable, 2026-07-17).
--
-- Two role-guard dialects coexist across the RPC family — coalesce(role,'')
-- not in (...) and `role is null or role not in (...)` — plus the last-owner
-- check is duplicated inside change_member_role and remove_member. They are all
-- semantically equivalent today (every dialect rejects NULL), so this is dedup,
-- not a fix: the point is that the NEXT hand-written guard is where a missed
-- coalesce becomes a privilege hole.
--
-- Adoption is incremental, not a big-bang re-emit of all ~12 guarded RPCs:
-- rewriting that many SECURITY DEFINER bodies verbatim buys transcription risk
-- with zero behaviour change. The rule (spec/rls.md) drives future adoption;
-- here we only convert the membership RPCs, which we re-emit anyway to extract
-- the last-owner helper. The bodies below are copied verbatim from
-- 20260715000004 with only the guard lines swapped — NOT reconstructed from
-- memory.
--
-- require_project_role is SECURITY INVOKER: it only delegates to project_role
-- (itself SECURITY DEFINER), so it needs no privilege of its own.
-- assert_not_last_owner is SECURITY DEFINER: it counts owners directly and must
-- see every owner row regardless of the caller's RLS, or the invariant it
-- protects could be defeated by a filtered count.
-- ============================================================

create function public.require_project_role(p_project_id uuid, variadic p_roles text[])
returns void
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_role text := public.project_role(p_project_id);
begin
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.require_project_role(uuid, text[]) from public, authenticated;

-- Raises if p_user_id is the project's sole remaining owner. The caller decides
-- WHEN to call it (change_member_role only on a demotion; remove_member always
-- before the delete); this function only owns the "is this the last owner"
-- test, under the caller's membership advisory lock.
create function public.assert_not_last_owner(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
      select 1 from public.project_members
      where project_id = p_project_id and user_id = p_user_id and role = 'owner'
    )
    and (
      select count(*) from public.project_members
      where project_id = p_project_id and role = 'owner'
    ) <= 1
  then
    raise exception 'Cannot demote or remove the last owner of the project';
  end if;
end;
$$;
revoke execute on function public.assert_not_last_owner(uuid, uuid) from public, authenticated;

-- change_member_role: verbatim from 20260715000004, guard + last-owner block
-- replaced with the helpers.
create or replace function public.change_member_role(p_project_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_project_role(p_project_id, 'owner');

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

  -- Last-owner invariant: only a demotion can strip the final owner. Count
  -- runs under the lock taken above so a concurrent demotion can't also pass.
  if p_role <> 'owner' then
    perform public.assert_not_last_owner(p_project_id, p_user_id);
  end if;

  update public.project_members set role = p_role
  where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- remove_member: verbatim from 20260715000004, last-owner block replaced with
-- the helper. The entry guard stays bespoke — it allows self-leave by a
-- non-owner, which require_project_role(..., 'owner') would wrongly reject.
create or replace function public.remove_member(p_project_id uuid, p_user_id uuid)
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

  perform public.assert_not_last_owner(p_project_id, p_user_id);

  delete from public.project_members
  where project_id = p_project_id and user_id = p_user_id;
end;
$$;

-- invite_member: verbatim from 20260715000004, owner guard replaced with the
-- helper (second real caller for require_project_role).
create or replace function public.invite_member(p_project_id uuid, p_user_id uuid, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_project_role(p_project_id, 'owner');

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

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- restore change_member_role / remove_member / invite_member verbatim from
-- 20260715000004_membership_admin_rpcs.sql, then:
-- drop function public.assert_not_last_owner(uuid, uuid);
-- drop function public.require_project_role(uuid, text[]);
