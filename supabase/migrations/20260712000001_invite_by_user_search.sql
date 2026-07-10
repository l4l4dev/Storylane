-- ============================================================
-- TASK-6: Invite members by user search (spec/features.md "Team
-- Collaboration", spec/rls.md L20-24). Advisor-reviewed 2026-07-12.
--
-- Replaces email-based invite_member with a user-id based version, and
-- adds search_users_for_invite backing the search picker.
--
-- p_project_id is required and owner-gated (unlike an earlier draft of
-- this migration, which made it optional so a not-yet-implemented TASK-7
-- project-creation flow could search before a project exists).
-- rls-security-reviewer caught that the optional path's only fallback
-- gate was "signed in" — which was safe back when profiles had a
-- `using (true)` SELECT policy, but that was tightened in
-- 20260709000001_rls_hardening.sql to `id = auth.uid() or
-- shares_project_with(id)` specifically to stop directory enumeration.
-- Since this function is SECURITY DEFINER (bypasses RLS entirely), an
-- optional project_id would have reopened exactly that hole for any
-- authenticated caller, immediately on merge, independent of whether
-- TASK-7 ever ships. TASK-7 will add its own scoped search path (e.g.
-- exact-match only) with its own review when it's actually implemented,
-- instead of speculatively opening this one ahead of need.
-- ============================================================

drop function if exists public.invite_member(uuid, text, text);

create function public.invite_member(p_project_id uuid, p_user_id uuid, p_role text default 'member')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- coalesce guards the NULL-for-non-member footgun (project_role returns
  -- SQL NULL, not a role, for an outsider — `NULL <> 'owner'` is NULL,
  -- which `if` treats as false and silently skips the check without this).
  -- Already fixed once for the email-based version (20260709000003).
  if coalesce(public.project_role(p_project_id), '') <> 'owner' then
    raise exception 'Only project owners can invite members';
  end if;

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'Invalid role: %', p_role;
  end if;

  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'No such user';
  end if;

  -- Inherited from the email-based version: upsert means an owner can
  -- re-invite an existing member/owner at a different role, including
  -- demoting another owner. Same behavior as before, not new scope here.
  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_user_id, p_role)
  on conflict (project_id, user_id) do update set role = excluded.role;
end;
$$;

create function public.search_users_for_invite(p_query text, p_project_id uuid)
returns table(id uuid, username text, display_name text, avatar_url text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_query   text := trim(p_query);
  v_pattern text;
begin
  if coalesce(public.project_role(p_project_id), '') <> 'owner' then
    raise exception 'Only project owners can search for invites';
  end if;

  if length(v_query) < 2 then
    return;
  end if;

  -- Escape ILIKE wildcards in the query itself: username's format check
  -- (^[a-z0-9_]{3,30}$) allows `_`, a legal single-char wildcard in ILIKE,
  -- so an unescaped search for e.g. "a_b" would also match "axb".
  v_pattern := '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
    select p.id, p.username, p.display_name, p.avatar_url
    from public.profiles p
    where (p.username ilike v_pattern or p.display_name ilike v_pattern)
      and not exists (
        select 1 from public.project_members pm
        where pm.project_id = p_project_id and pm.user_id = p.id
      )
    order by p.username
    limit 10;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.search_users_for_invite(text, uuid);
-- drop function public.invite_member(uuid, uuid, text);
-- create function public.invite_member(
--   p_project_id uuid, p_email text, p_role text default 'member'
-- ) returns void language plpgsql security definer set search_path = public as $$
-- declare
--   v_user_id uuid;
-- begin
--   if coalesce(public.project_role(p_project_id), '') <> 'owner' then
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
