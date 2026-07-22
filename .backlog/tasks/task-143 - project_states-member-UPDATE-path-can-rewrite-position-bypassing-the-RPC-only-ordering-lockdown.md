---
id: TASK-143
title: >-
  project_states: member UPDATE path can rewrite position, bypassing the
  RPC-only ordering lockdown
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 09:04'
labels: []
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
- [ ] #1 A member can no longer change project_states.position via direct UPDATE (RLS/privilege test proves it), while the sanctioned reorder RPC still reorders correctly
- [ ] #2 Legitimate member UPDATE fields (name, action label) still work; owner-only fields unchanged
- [ ] #3 rls-security-reviewer pass on the migration
- [ ] #4 supabase db reset green; pnpm test + lint green (from apps/web/)
<!-- AC:END -->
