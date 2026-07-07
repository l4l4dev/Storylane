---
id: TASK-6
title: Invite members by user search
status: To Do
assignee: []
created_date: '2026-07-07 14:24'
labels:
  - web
  - db
dependencies: []
references:
  - spec/features.md
  - spec/rls.md
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the email input invite with a search picker over registered users, per spec/features.md 'Team Collaboration' and spec/rls.md. A capped SECURITY DEFINER RPC searches profiles by username/display_name and returns minimal columns (id, username, display_name, avatar_url). The picker is used in project settings and later in the project creation form (TASK for Projects page redesign).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Search RPC exists: min 2 chars, ilike on username/display_name, capped (e.g. 10 results), minimal columns only
- [ ] #2 Project settings invite form uses the search picker with a role select; email input is removed
- [ ] #3 Already-invited users are indicated/excluded in results
- [ ] #4 rls-security-reviewer has reviewed the migration
- [ ] #5 Tests cover the RPC (search + cap) and the picker component
<!-- AC:END -->
