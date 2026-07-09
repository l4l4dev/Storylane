-- ============================================================
-- Security fix: invite_member's owner check bypassed by NULL role.
--
-- public.project_role(p_project_id) is a bare scalar subquery (no
-- exists()/coalesce) — for a caller with zero project_members row for the
-- project (a true outsider, not a 'viewer'), it returns SQL NULL rather
-- than a value that fails the check. `NULL <> 'owner'` evaluates to NULL,
-- which `if ... then` treats the same as false, so the `raise exception`
-- was silently skipped and the function fell through to inserting the
-- caller into project_members at whatever role they asked for — including
-- 'owner'. Reproduced 2026-07-09 (rls-security-reviewer, flagged as a
-- companion to the identical pattern found and fixed in
-- finalize_iteration, 20260709000002): an outsider with no relationship
-- to a project could call invite_member(project_id, own_email, 'owner')
-- and take it over.
-- ============================================================

create or replace function public.invite_member(
  p_project_id uuid,
  p_email text,
  p_role text default 'member'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if coalesce(public.project_role(p_project_id), '') <> 'owner' then
    raise exception 'Only project owners can invite members';
  end if;

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'Invalid role: %', p_role;
  end if;

  select id into v_user_id
  from auth.users
  where email = lower(p_email)
  limit 1;

  if v_user_id is null then
    raise exception 'No registered user found with email %', p_email;
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, v_user_id, p_role)
  on conflict (project_id, user_id) do update set role = excluded.role;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- create or replace function public.invite_member(
--   p_project_id uuid, p_email text, p_role text default 'member'
-- ) returns void language plpgsql security definer set search_path = public as $$
-- declare
--   v_user_id uuid;
-- begin
--   if public.project_role(p_project_id) <> 'owner' then
--     raise exception 'Only project owners can invite members';
--   end if;
--   if p_role not in ('owner', 'member', 'viewer') then
--     raise exception 'Invalid role: %', p_role;
--   end if;
--   select id into v_user_id from auth.users where email = lower(p_email) limit 1;
--   if v_user_id is null then
--     raise exception 'No registered user found with email %', p_email;
--   end if;
--   insert into public.project_members (project_id, user_id, role)
--   values (p_project_id, v_user_id, p_role)
--   on conflict (project_id, user_id) do update set role = excluded.role;
-- end;
-- $$;
