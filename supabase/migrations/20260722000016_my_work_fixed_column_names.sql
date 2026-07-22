-- ============================================================
-- Lets a user rename the three FIXED My Work slots (Todo/Today/Done) —
-- display label only, the underlying slot id/behavior never changes. A jsonb
-- map keyed by slot id
-- ('todo' | 'today' | 'done'), read-side merged against defaults by
-- lib/utils/my-work.ts's resolveColumnNames (a missing/invalid key falls
-- back to the default label, same graceful-degradation shape as
-- my_work_column_order/resolveColumnOrder above).
--
-- No new RLS: same reasoning as 20260722000009_my_work_column_order.sql —
-- profiles' own-row UPDATE policy already covers this row, but the
-- column-by-column grant lockdown (20260719000001_profiles_is_agent.sql)
-- means this NEW column needs its own explicit grant.
-- ============================================================

alter table public.profiles
  add column my_work_column_names jsonb not null default '{}'::jsonb;

grant update (my_work_column_names) on public.profiles to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- alter table public.profiles drop column my_work_column_names;
