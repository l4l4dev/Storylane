---
id: TASK-115
title: project_states INSERT has no position-contiguity check
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 11200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #7. supabase/migrations/20260719000005_project_states.sql:40 has a bare owner/member INSERT policy with no constraint on position, letting a direct client insert bypass create_project_state's advisory-lock-protected contiguity logic that the board's advance-button graph depends on.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Direct client INSERT on project_states can no longer land a state at an arbitrary position that breaks category-block contiguity (revoke table-level INSERT in favor of create_project_state exclusively, or add a BEFORE INSERT trigger enforcing contiguity)
- [x] #2 create_project_state (the legitimate path) still works — integration test covers it
- [x] #3 A test proves the direct-insert exploit from doc-13 no longer corrupts contiguity
- [x] #4 Migration passes rls-security-reviewer; pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-22 08:05
---
fable-advisor reviewed the plan and approved Option A (drop INSERT policy) over Option B (contiguity trigger), confirming the load-bearing assumption (SECURITY DEFINER functions owned by the migration role bypass RLS on this ENABLE-not-FORCE table) against two live precedents: TASK-55 (activity_logs) and TASK-110 (iterations). Required plan fixes applied: added 'revoke insert ... from authenticated' to match TASK-110, and updated spec/rls.md. rls-security-reviewer then passed the migration with no findings (drop-policy + revoke-grant correct and complete; SECURITY DEFINER paths unaffected; docs in sync). Empirically verified via supabase db reset + integration tests: project-creation seed and create_project_state both still work, direct owner INSERT now returns 42501.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed the project_states direct-INSERT bypass: dropped the table-level authenticated INSERT policy and revoked the INSERT grant (migration 20260722000005), so states can only be created through the SECURITY DEFINER paths (create_project_state RPC + handle_new_project_states seed trigger), which enforce category-block contiguity. A direct client INSERT now returns 42501. Added an integration test proving the exploit is closed and contiguity is untouched; converted two setup inserts to the create_project_state RPC. Updated spec/rls.md. fable-advisor + rls-security-reviewer both approved. NOTE: the members UPDATE policy has the same class of position bypass (direct UPDATE sidesteps reorder_project_state) — deliberately out of INSERT-only scope, flagged for a follow-up task.
<!-- SECTION:FINAL_SUMMARY:END -->
