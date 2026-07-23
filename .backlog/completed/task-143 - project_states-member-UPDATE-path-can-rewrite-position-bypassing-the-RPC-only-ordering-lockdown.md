---
id: TASK-143
title: >-
  project_states: member UPDATE path can rewrite position, bypassing the
  RPC-only ordering lockdown
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 09:04'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-115 (2026-07-22): TASK-115 locked project_states INSERT down to RPC-only paths (20260722000005_project_states_revoke_direct_insert.sql) to protect position contiguity, but the member-writable UPDATE policy still lets any member set position directly, bypassing the sanctioned reorder RPC and corrupting the contiguous ordering the board relies on. Investigate the exact policy shape first, then close the gap with the smallest DB-level mechanism consistent with TASK-115's approach (e.g. revoke UPDATE(position) column privilege from client roles so only the SECURITY DEFINER reorder path may change it - verify the RPC still works after). Keep legitimate member edits (rename, action label, category rules per spec) intact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A member can no longer change project_states.position via direct UPDATE (RLS/privilege test proves it), while the sanctioned reorder RPC still reorders correctly
- [x] #2 Legitimate member UPDATE fields (name, action label) still work; owner-only fields unchanged
- [x] #3 rls-security-reviewer pass on the migration
- [x] #4 supabase db reset green; pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260722000011: revoke table-level UPDATE on project_states from authenticated, then grant update(name, action_label, category, project_id) to authenticated. This locks position (the fix) + id + created_at at the column-privilege layer while leaving the legitimate member edits (name, action_label) intact. Mirrors 20260719000001_profiles_is_agent.sql's revoke-table-then-grant-columns pattern and TASK-115's grant-layer approach.
2. WHY category/project_id stay granted: the reject_project_state_category_change trigger (20260719000005) already blocks those with friendly P0001 messages, and project-states.integration.test.ts asserts those exact messages. Excluding them from the grant would swap the friendly trigger error for a generic 42501 and break those tests + degrade UX. Granting them changes nothing (trigger still rejects) - only position/id/created_at are newly locked. The UPDATE RLS policy is unchanged.
3. reorder_project_state (SECURITY DEFINER, postgres-owned) bypasses column grants - it still updates position. Verify empirically after reset.
4. Add an integration test: a member's direct .update({position}) is denied (42501) while reorder_project_state still reorders; name/action_label update still works.
5. rls-security-reviewer pass; supabase db reset green; pnpm test + lint green.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: migration 20260722000011 - revoke table-wide UPDATE on project_states from authenticated, re-grant only (name, action_label, category, project_id). Locks position + id + created_at at the column-privilege layer; reorder_project_state (SECURITY DEFINER, postgres-owned) is unaffected and still swaps position. category/project_id kept granted on purpose so the reject_project_state_category_change trigger stays the enforcement layer with its friendly P0001 messages (project-states.integration.test.ts asserts them).

PROVEN not assumed: restored the old table-wide grant via psql and re-ran the new 'position column lockdown' tests - member position UPDATE returns error === undefined (succeeds = the hole); reapplied the migration and they pass with 42501. reorder_project_state and name/action_label edits verified still working.

Tests added (project-states.integration.test.ts 'position column lockdown' block, 4 cases): position-only UPDATE denied + order unchanged; reorder RPC still reorders; name/action_label still editable; mixed name+position UPDATE rejected wholesale (name doesn't leak). Full suite 821 pass, only the 2 known pre-existing unrelated failures. tsc + lint clean.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-opus-4-8
created: 2026-07-22 10:31
---
rls-security-reviewer: CLEAN, no findings. Empirically verified on a reset DB: authenticated has UPDATE only on name/action_label/category/project_id (position/id/created_at have no UPDATE row); a position-only and a mixed name+position UPDATE both 42501 (column privilege checked per-statement); anon has no UPDATE at all; service_role unaffected. reorder_project_state (SECURITY DEFINER, postgres-owned) still swaps position. name single-column update succeeds through RLS + grant; category change still hits the friendly P0001 trigger, not 42501. All 21 project-states integration tests green including the new lockdown block. Two-layer RLS-policy + column-grant composition confirmed correct.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed the direct-UPDATE bypass on project_states.position (migration 20260722000011): revoked the table-wide UPDATE grant from authenticated and re-granted only (name, action_label, category, project_id), so position/id/created_at are writable only by the SECURITY DEFINER reorder_project_state RPC. The reorder-verb twin of TASK-115's INSERT lockdown, closing the same category-contiguity corruption computeStateGate depends on. category/project_id stay granted so their friendly immutability trigger (P0001) remains the enforcement layer rather than a bare 42501. Legitimate member edits (name, action_label via Settings) and the reorder RPC are intact; the UPDATE RLS policy is unchanged (the grant narrows which columns, not who). Verified by restoring the old table-wide grant and watching the new lockdown tests fail (member position UPDATE succeeds, error undefined), then pass (42501) once re-applied. rls-security-reviewer: clean. Added 4 integration tests (position-only denied + order intact, reorder RPC still works, name/action_label still editable, mixed UPDATE rejected wholesale). tsc + lint clean; full suite 821 pass with only the 2 known pre-existing unrelated failures.
<!-- SECTION:FINAL_SUMMARY:END -->
