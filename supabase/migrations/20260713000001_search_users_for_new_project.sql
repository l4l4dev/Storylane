-- supabase/migrations/20260713000001_search_users_for_new_project.sql
-- ============================================================
-- TASK-7: exact-match user search for the project-creation panel's
-- initial-invite picker, used before a project row exists (so
-- search_users_for_invite's p_project_id-required, owner-gated,
-- fuzzy-ILIKE search cannot apply — see 20260712000001's note).
--
-- fable-advisor reviewed this design (2026-07-10): exact match is an
-- acceptable narrowing of TASK-6's fuzzy search — each call only
-- confirms/denies one specific username (not an enumerable set), and
-- this app already exposes an equivalent oracle via the "username
-- already taken" unique-violation error on /settings profile edits
-- (apps/web/app/settings/actions.ts). No new rate-limiting
-- infrastructure is added for this; wordlist brute-force against a
-- single-username-per-call oracle is an accepted residual risk, same
-- as the existing settings-page oracle.
-- ============================================================

create function public.search_users_for_new_project(p_query text)
returns table(id uuid, username text, display_name text, avatar_url text)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_query text := lower(trim(p_query));
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Same format as profiles_username_format (20260702000001) — a
  -- non-matching input can never match a row, so skip the query.
  if v_query !~ '^[a-z0-9_]{3,30}$' then
    return;
  end if;

  return query
    select p.id, p.username, p.display_name, p.avatar_url
    from public.profiles p
    where lower(p.username) = v_query
      and p.id <> auth.uid()
    limit 1;
end;
$$;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public.search_users_for_new_project(text);
