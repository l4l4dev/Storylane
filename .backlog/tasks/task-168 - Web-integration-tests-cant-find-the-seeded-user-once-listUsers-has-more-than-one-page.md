---
id: TASK-168
title: >-
  Web integration tests can't find the seeded user once listUsers() has more
  than one page
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review (2026-07-23) found apps/web/lib/utils/membership.integration.test.ts:67 and working-day-calendar.integration.test.ts:53 locate an existing auth user by scanning only supabase.auth.admin.listUsers()'s default first page. As the dev DB's auth.users grows past one page, both tests silently fail to find their target user — not reliably re-runnable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both integration tests locate their target user regardless of how many auth users exist (e.g. paging through listUsers or filtering by a known unique attribute instead of scanning the default page)
- [ ] #2 Both integration test files pass when run against a dev DB seeded past listUsers()'s single-page limit
<!-- AC:END -->
