---
id: TASK-115
title: project_states INSERT has no position-contiguity check
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
labels: []
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
- [ ] #1 Direct client INSERT on project_states can no longer land a state at an arbitrary position that breaks category-block contiguity (revoke table-level INSERT in favor of create_project_state exclusively, or add a BEFORE INSERT trigger enforcing contiguity)
- [ ] #2 create_project_state (the legitimate path) still works — integration test covers it
- [ ] #3 A test proves the direct-insert exploit from doc-13 no longer corrupts contiguity
- [ ] #4 Migration passes rls-security-reviewer; pnpm test + lint green
<!-- AC:END -->
