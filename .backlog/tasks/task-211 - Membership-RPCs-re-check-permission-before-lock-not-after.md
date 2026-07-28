---
id: TASK-211
title: 'Membership RPCs re-check permission before lock, not after'
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
labels: []
milestone: m-2
dependencies: []
references:
  - supabase/migrations/20260717000001_guard_helpers.sql
  - supabase/migrations/20260722000003_drop_story_pins.sql
priority: high
type: bug
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
change_member_role, remove_member, and invite_member (20260717000001_guard_helpers.sql) check the caller's role via require_project_role BEFORE taking pg_advisory_xact_lock(hashtext('membership:'...)), then never re-check it after acquiring the lock. If the caller is demoted or removed by another owner while blocked on the lock, the operation still proceeds once the lock is granted. move_story_board and split_story have the same before-lock-only permission check shape. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 change_member_role, remove_member, and invite_member re-verify the caller's role after acquiring the advisory lock and before writing
- [ ] #2 A concurrent demotion that commits while the caller is blocked on the lock causes the blocked call to fail with an authorization error, not succeed
- [ ] #3 move_story_board and split_story get the same after-lock re-check treatment
<!-- AC:END -->
