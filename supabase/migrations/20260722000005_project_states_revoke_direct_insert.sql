-- ============================================================
-- TASK-115 (doc-13 finding #7): close the direct-INSERT bypass on
-- project_states.
--
-- The original table-level INSERT policy (20260719000005) let any
-- owner/member do a direct client INSERT with an arbitrary `position`,
-- sidestepping create_project_state's (20260719000014) advisory-lock-
-- protected, category-block-contiguity logic. computeStateGate
-- (packages/core story-state.ts) assumes each category occupies a
-- contiguous run of positions; a row landed at an arbitrary position (e.g.
-- an in_progress state after Rejected) corrupts the board's advance-button
-- graph.
--
-- Both LEGITIMATE insert paths are SECURITY DEFINER functions owned by the
-- migration role, which bypasses RLS on this ENABLE (not FORCE) ROW LEVEL
-- SECURITY table — so neither is affected by dropping the policy:
--   - seed_project_states / handle_new_project_states (20260719000006) —
--     the project-creation template seed.
--   - create_project_state (20260719000014) — the Settings "+ Add" and
--     board "+ Add column" path.
-- No authenticated client has any legitimate reason to INSERT here
-- directly (createProjectState() calls the RPC), so revoking the policy —
-- rather than adding a BEFORE INSERT contiguity trigger that would only
-- duplicate create_project_state's logic and fire redundantly on the
-- security-definer inserts — is the complete, minimal fix.
--
-- SELECT (members) / UPDATE (members) / DELETE (owner) policies are
-- unchanged.
-- ============================================================

drop policy "members can create project states" on public.project_states;

-- Belt-and-suspenders with the dropped policy (ENABLE RLS + no policy already
-- defaults to deny, same SQLSTATE 42501): revoking the table-level INSERT
-- grant matches the iterations lockdown (TASK-110) so the "INSERT is RPC-only"
-- intent is explicit at the grant layer too, not just the policy layer.
revoke insert on public.project_states from authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- grant insert on public.project_states to authenticated;
-- create policy "members can create project states"
--   on public.project_states for insert to authenticated
--   with check (public.project_role(project_id) in ('owner', 'member'));
