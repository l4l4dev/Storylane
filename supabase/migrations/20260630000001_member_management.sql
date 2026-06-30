-- ============================================================
-- Member management: invite an existing user by email.
-- (Role changes / removals use the project_members RLS policies directly.)
-- ============================================================

-- Looks up a registered user by email and adds them to the project.
-- SECURITY DEFINER so it can read auth.users; authorization is enforced
-- internally (only project owners may invite).
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
  if public.project_role(p_project_id) <> 'owner' then
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
