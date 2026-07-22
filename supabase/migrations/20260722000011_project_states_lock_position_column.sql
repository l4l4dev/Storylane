-- ============================================================
-- TASK-143 (found during TASK-115): close the direct-UPDATE bypass on
-- project_states.position.
--
-- TASK-115 (20260722000005) locked INSERT down to the SECURITY DEFINER RPCs so
-- a client couldn't land a row at an arbitrary position and break the
-- per-category contiguity computeStateGate (packages/core) relies on. But the
-- member-writable UPDATE policy (20260719000005) still let any member set
-- `position` directly — the same corruption by a different verb (e.g. dragging
-- an in_progress column's position value in front of Rejected's), bypassing
-- reorder_project_state's advisory-lock-protected value-swap.
--
-- Fix at the column-privilege layer (matches 20260719000001_profiles_is_agent's
-- revoke-table-then-grant-columns pattern, and TASK-115's grant-layer intent):
-- revoke the table-wide UPDATE grant and re-grant only the columns a client
-- legitimately edits. `position` — plus `id` and `created_at`, which no client
-- path writes either — are thereby updatable ONLY by the SECURITY DEFINER
-- reorder_project_state (owned by the migration role, so column grants to
-- `authenticated` don't constrain it — same reasoning as create_project_state
-- in TASK-115).
--
-- `category` and `project_id` STAY granted on purpose: the
-- reject_project_state_category_change trigger (20260719000005) already rejects
-- changing them, with specific P0001 messages the app and
-- project-states.integration.test.ts surface. Dropping them from the grant
-- would replace those friendly errors with a bare 42501 and change nothing
-- about what's actually allowed. The UPDATE RLS policy (owner/member) is
-- unchanged — this only narrows WHICH COLUMNS an already-authorized member may
-- write, not WHO may write.
--
-- anon has no UPDATE grant here (RLS has no anon policy anyway); service_role
-- keeps table-wide UPDATE, as on every other table.
-- ============================================================

revoke update on public.project_states from authenticated;
grant update (name, action_label, category, project_id) on public.project_states to authenticated;

-- DOWN (rollback — not auto-applied; run manually if reverting):
-- grant update on public.project_states to authenticated;
