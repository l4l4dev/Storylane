---
id: TASK-5
title: Account settings page (/settings)
status: To Do
assignee: []
created_date: '2026-07-07 14:24'
labels:
  - web
dependencies: []
references:
  - spec/screens.md
priority: medium
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Profile identity (username, display name) is edited on a dedicated account settings page, not on the Projects page and not per project. See spec/screens.md route map. Avatar upload stays Phase 2 (avatar_url comes from OAuth).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /settings page exists with username and display name editing (reusing the existing updateUsername action pattern)
- [ ] #2 UsernameEditor is removed from /dashboard
- [ ] #3 Sidebar account menu links to /settings
- [ ] #4 Component tests cover the settings form (success and validation error)
<!-- AC:END -->
