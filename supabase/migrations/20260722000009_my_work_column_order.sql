-- ============================================================
-- TASK-141 (doc-15): My Work column display order — covers the fixed
-- Todo/Today/Done slots as well as the user's my_work_columns (doc-15: "the
-- order covers the three fixed slots too - per-user ordered list, mechanism
-- free"). One text[] of slot ids ('todo' | 'today' | 'done' | a
-- my_work_columns uuid) per user, read-side merged against the live free
-- column set by lib/utils/my-work.ts's resolveColumnOrder (stale/missing ids
-- degrade gracefully, so this column never needs its own migration on
-- add/delete).
--
-- No new RLS: profiles' existing own-row UPDATE policy (20260627000001,
-- `id = auth.uid()`, no column restriction) already covers writing this
-- column. But 20260719000001_profiles_is_agent.sql revoked profiles' table-
-- wide UPDATE grant and re-grants it column-by-column ("future columns are
-- locked by default until granted here") — this NEW column needs its own
-- grant or every write 42501s before RLS is even evaluated
-- (rls-security-reviewer HIGH finding).
-- ============================================================

alter table public.profiles
  add column my_work_column_order text[] not null default '{}'::text[];

grant update (my_work_column_order) on public.profiles to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.profiles drop column my_work_column_order;
