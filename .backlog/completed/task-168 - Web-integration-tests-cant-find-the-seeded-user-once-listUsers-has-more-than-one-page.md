---
id: TASK-168
title: >-
  Web integration tests can't find the seeded user once listUsers() has more
  than one page
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
updated_date: '2026-07-23 05:11'
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
- [x] #1 Both integration tests locate their target user regardless of how many auth users exist (e.g. paging through listUsers or filtering by a known unique attribute instead of scanning the default page)
- [x] #2 Both integration test files pass when run against a dev DB seeded past listUsers()'s single-page limit
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Both apps/web/lib/utils/membership.integration.test.ts and
working-day-calendar.integration.test.ts look up their second test user by
email only when admin.createUser() reports it already exists (a prior
run's leftover) -- that fallback scanned only auth.admin.listUsers()'s
default first page (50 users), so it silently stopped finding the target
user once auth.users grew past that.

Added a small findUserByEmail() helper to each file (duplicated rather
than a shared module, matching these integration tests' existing
per-file-boilerplate style) that pages through listUsers({page, perPage})
via the response's `nextPage` until the email is found or pages run out.

Verified against this session's local dev DB, which already has 211
auth.users: confirmed task54-member@storylane.local and
task85-other@storylane.local rank 206/207 by creation date (deep past
page 1 under the old code -- this is a genuine, currently-live regression,
not a hypothetical). Ran both files with SUPABASE_INTEGRATION=1: 19 tests
passed. pnpm test (703 passed) and pnpm run lint also green from apps/web.
<!-- SECTION:FINAL_SUMMARY:END -->
