---
id: TASK-116
title: >-
  Cadence RPCs (override_iteration_length / reshape_current_iteration) check
  role before lock, not after
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #8. Both supabase/migrations/20260720000006_flexible_cadence.sql:146 and 20260721000005_reshape_current_iteration.sql:34 check the caller's project role before taking the advisory lock and never re-check after, unlike finalize_iteration/transition_story/set_story_state which re-derive authorization after locking to close a role-revoked-mid-flight race.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 override_iteration_length and reshape_current_iteration re-check the caller's project role immediately after acquiring the advisory lock, matching finalize_iteration's pattern
- [ ] #2 A concurrency test proves a role revoked between the initial check and the lock is caught by the post-lock re-check
- [ ] #3 Migration passes rls-security-reviewer; pnpm test + lint green
<!-- AC:END -->
