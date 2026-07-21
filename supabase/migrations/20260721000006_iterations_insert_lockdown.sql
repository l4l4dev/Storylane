-- ============================================================
-- TASK-110 (doc-13 finding #1): lock down direct INSERT on iterations.
--
-- The original INSERT policy (20260627000004_iterations.sql) let any
-- owner/member insert an arbitrary iterations row through PostgREST, and RLS
-- cannot restrict values — so a member could forge a finished-sprint row with
-- any state/number/velocity/capacity. Confirmed exploitable: inserting a
-- state='done', number=999999, velocity=999999, capacity=0.001 row then
-- makes finalize_iteration start #1,000,000 (derailing sprint numbering) and
-- poisons the rolling rate = Σpoints / Σcapacity window forever — the exact
-- class of forgery the 20260720000002 UPDATE lockdown closed for the metric
-- columns, but INSERT was left wide open.
--
-- No client inserts iterations directly: every new row (including a brand-new
-- project's first iteration, via ensureCurrentIteration) is written by the
-- finalize_iteration SECURITY DEFINER RPC (which also absorbed the old
-- skip-iteration path via its p_manual branch), run as the postgres owner and
-- unaffected by the authenticated grant. So the fix is the mirror of the
-- UPDATE treatment:
-- revoke the table-level INSERT grant. The `update (goal)` client path stays;
-- there is no analogous client INSERT column, so the whole INSERT grant goes.
revoke insert on public.iterations from authenticated;

-- Drop the now-unreachable policy too, rather than leave it as misleading
-- dead weight (the UPDATE policy stayed because `goal` is still client-
-- updatable; INSERT has no such carve-out). This doubles as defense-in-depth:
-- with RLS enabled and no INSERT policy, a future migration re-granting the
-- INSERT privilege still can't let authenticated insert — a missing policy is
-- a deny.
drop policy "members can create iterations" on public.iterations;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- create policy "members can create iterations"
--   on public.iterations for insert to authenticated
--   with check (public.project_role(project_id) in ('owner', 'member'));
-- grant insert on public.iterations to authenticated;
