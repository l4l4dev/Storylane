---
id: TASK-228
title: invite-search integration test can be crowded out by its own leftovers
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-03 02:44'
updated_date: '2026-08-04 07:13'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/lib/utils/invite-search.integration.test.ts
  - supabase/migrations/20260712000001_invite_by_user_search.sql
priority: low
ordinal: 1370
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
search_users_for_invite (supabase/migrations/20260712000001_invite_by_user_search.sql) returns at most 10 rows. invite-search.integration.test.ts asserts that a user it just created appears in the results for a prefix of that user own username (search_under_s...). Both facts together make the assertion depend on how many OTHER users match the same prefix.

Every run of that file creates users named search_<suffix>_<id-fragment>, so on a database that is not wiped between runs they accumulate and eventually fill the 10-row window. Observed on the local dev DB at 884 profiles: the file passes in isolation (8/8) but fails inside a full SUPABASE_INTEGRATION=1 run with "expected [ ...(10) ] to include <id>".

CI is not affected today because it starts from an empty database each run, and only a handful of matching users exist by the time the assertion runs. That is luck, not isolation: the same failure appears on CI the moment one run creates more than ten users matching that prefix. It also makes the local integration suite unusable as a pre-push check without a db reset first, which is worse than it sounds — a reset destroys whatever other sessions are holding.

Not caused by TASK-214, which only surfaced it by running the full integration suite locally. Fix the test isolation rather than the RPC: the 10-row cap is a deliberate product limit, not a bug.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The assertion no longer depends on how many unrelated users match the query — a database carrying hundreds of leftover profiles gives the same result as an empty one
- [x] #2 A full SUPABASE_INTEGRATION=1 run passes against a local database that has accumulated prior test data
- [x] #3 search_users_for_invite keeps its 10-row cap unchanged
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: the escaping test queried a fixed literal prefix (target.username.slice(0,14) = 'search_under_s') shared by every run's test user, so leftover profiles from prior un-wiped runs could crowd the new user out of the RPC's 10-row cap once matches exceeded 10. Other tests in the file were unaffected (count-only or absence-only assertions). Fix: slice from the id-fragment tail (target.username.slice(7)) instead, unique per run, still contains '_' for the escaping check. RPC/migration untouched (10-row cap unchanged, AC#3).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Changed apps/web/lib/utils/invite-search.integration.test.ts: query for the underscore-escaping assertion now slices from the id-fragment tail instead of a fixed literal prefix, so it can't collide with leftover profiles from prior runs. Verified against the local dev DB with 930 accumulated profiles: full SUPABASE_INTEGRATION=1 pnpm test run (144 files, 1300 tests) passes, plus lint clean. RPC/migration unchanged.
<!-- SECTION:FINAL_SUMMARY:END -->
