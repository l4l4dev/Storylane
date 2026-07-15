-- ============================================================
-- TASK-55 (1/3): function EXECUTE grant lockdown.
-- Advisor-approved design (Fable, 2026-07-12; task notes).
--
-- 20260630000002_grants.sql granted EXECUTE on ALL current+future public
-- functions to `authenticated`, so every SECURITY DEFINER helper — including
-- internal trigger bodies — ships remotely callable via PostgREST rpc().
-- Revoke the blanket + default grant and re-grant EXECUTE explicitly to only
-- the intended entry points.
--
-- ⚠️ This locks down the *existing* functions only. It does NOT make new
-- functions private-by-default: `alter default privileges ... revoke execute
-- ... from public` does not suppress PostgreSQL's built-in "EXECUTE to PUBLIC
-- on CREATE" once a pg_default_acl row exists for the schema (verified empirically,
-- rls-security-reviewer 2026-07-15). So every future function-creating migration
-- MUST manage its own grants explicitly (see .claude/commands/db-migrate.md
-- checklist item 5) — a service-role-only RPC revokes from public/authenticated,
-- an internal helper/trigger revokes from public/authenticated, a user-facing RPC
-- grants to authenticated. The grant_lockdown integration test
-- (apps/web/lib/utils/grant-lockdown.integration.test.ts) is the backstop: it
-- fails if any public function outside the allowlist is executable by
-- authenticated/anon, catching a migration that forgot.
--
-- ⚠️ TRAP (why this is surgical, not a blanket revoke): functions referenced
-- inside RLS policies (project_role, is_project_member, shares_project_with)
-- are executed by the *querying* role, so `authenticated` must keep EXECUTE on
-- them or every policy in the DB starts failing with "permission denied for
-- function". These are re-granted below alongside the entry-point RPCs. The
-- policy-referenced set was enumerated from pg_policies (project_role ×59,
-- is_project_member ×15, shares_project_with ×1, all on {authenticated}
-- policies so anon never invokes them); the entry-point set from the web app's
-- .rpc() call sites.
--
-- The actual grant path being closed is PUBLIC, not just the direct
-- `authenticated` grant: CREATE FUNCTION grants EXECUTE to PUBLIC by default
-- and 20260630000002 additionally granted it to authenticated, so
-- has_function_privilege stayed true after revoking only authenticated. Revoke
-- both, and revoke the default so future functions are private until granted.
--
-- Trigger bodies keep firing regardless of this revoke — Postgres does not
-- check the invoking user's EXECUTE privilege on a trigger function — so
-- revoking them is safe. service_role keeps its own grants (20260707000006)
-- untouched: it is server-side only (Edge Functions / admin client), never
-- browser-reachable.
-- ============================================================

-- Reverse the blanket + default grants (from 20260630000002_grants.sql) AND
-- the built-in PUBLIC EXECUTE grant, so no function is callable by a
-- browser-reachable role except where re-granted below.
revoke execute on all functions in schema public from public, authenticated;
alter default privileges in schema public revoke execute on functions from public, authenticated;

-- Policy-referenced helpers — MUST stay executable by authenticated (see TRAP).
grant execute on function public.project_role(p_project_id uuid) to authenticated;
grant execute on function public.is_project_member(p_project_id uuid) to authenticated;
grant execute on function public.shares_project_with(p_target_user_id uuid) to authenticated;

-- Intended entry-point RPCs (the web app's .rpc() surface). finish_story_from_git
-- is intentionally absent — it stays service_role-only (20260715000003).
grant execute on function public.change_member_role(p_project_id uuid, p_user_id uuid, p_role text) to authenticated;
grant execute on function public.remove_member(p_project_id uuid, p_user_id uuid) to authenticated;
grant execute on function public.invite_member(p_project_id uuid, p_user_id uuid, p_role text) to authenticated;
grant execute on function public.finalize_iteration(p_project_id uuid, p_manual boolean, p_iteration_id uuid) to authenticated;
grant execute on function public.generate_recurring_stories(p_project_id uuid) to authenticated;
grant execute on function public.promote_story_to_epic(p_story_id uuid) to authenticated;
grant execute on function public.move_story_to_project(p_story_id uuid, p_target_project_id uuid) to authenticated;
grant execute on function public.copy_story_to_project(p_story_id uuid, p_target_project_id uuid) to authenticated;
grant execute on function public.search_users_for_invite(p_query text, p_project_id uuid) to authenticated;
grant execute on function public.search_users_for_new_project(p_query text) to authenticated;
grant execute on function public.toggle_project_favorite(p_project_id uuid, p_favorite boolean) to authenticated;
grant execute on function public.update_story(p_story_id uuid, p_title text, p_description text, p_story_type text, p_points integer, p_epic_id uuid, p_assignee_id uuid, p_custom_status_id uuid, p_label_ids uuid[]) to authenticated;

-- Read-only catalog audit backing the grant-lockdown backstop test: returns,
-- for every function in schema public, whether authenticated/anon can EXECUTE
-- it. service_role-only (the test uses the service key); never client-facing.
create function public._grant_audit()
returns table(name text, auth boolean, anon boolean)
language sql
security definer
stable
set search_path = public
as $$
  select p.proname::text,
         has_function_privilege('authenticated', p.oid, 'execute'),
         has_function_privilege('anon', p.oid, 'execute')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public';
$$;
revoke execute on function public._grant_audit() from public, authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- drop function public._grant_audit();
-- grant execute on all functions in schema public to authenticated;
-- alter default privileges in schema public grant execute on functions to authenticated;
-- -- (the PUBLIC default is not restored — the pre-lockdown behaviour is
-- --  recovered via the authenticated grant above; re-granting PUBLIC would
-- --  reopen exactly the hole this migration closes.)
