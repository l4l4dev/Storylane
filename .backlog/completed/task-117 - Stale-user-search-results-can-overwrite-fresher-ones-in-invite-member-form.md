---
id: TASK-117
title: Stale user-search results can overwrite fresher ones in invite-member-form
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
updated_date: '2026-07-21 13:42'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #9. apps/web/components/features/projects/invite-member-form.tsx:33's debounced search effect calls setResults unconditionally on resolution with no request-id/abort guard — a slower earlier query can resolve after a faster later one and overwrite its results.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The debounced search guards against out-of-order responses (request-id or AbortController), so a stale slower response can never overwrite a fresher one
- [x] #2 A test proves the race no longer reverts results to a stale query
- [x] #3 pnpm test + lint green
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. apps/web/components/features/projects/invite-member-form.tsx: guard the debounced search effect's async resolution with a per-effect 'cancelled' flag set true in the effect's own cleanup (fires on the next keystroke/query change) -- React's standard fix for out-of-order async effects, no request-id ref or AbortController plumbing needed since search_users_for_invite is a server action, not a fetch.
2. Add a regression test in invite-member-form.test.tsx using manually-resolvable deferred promises to force the out-of-order resolution (earlier 'ab' query resolves after the later 'abc' query) and assert the stale result never appears.
3. Verify the new test actually fails against the pre-fix code (git stash the fix, rerun, confirm red; restore).
4. Run pnpm test + pnpm run lint.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix: invite-member-form.tsx's debounced search effect now closes over a 'cancelled' flag, set true by the effect's own cleanup on the next query change, guarding the setResults call so a slower earlier response can't overwrite a fresher one. Test: new case in invite-member-form.test.tsx using deferred promises to resolve the later ('abc') query before the earlier ('ab') one, asserting the stale result is never rendered -- confirmed this test fails on the pre-fix code (manually verified via git stash) and passes with the fix. Verified: pnpm exec vitest run on the file (5/5 pass), pnpm run lint clean, full pnpm test (560 passed, 186 pre-existing skips, 0 failed).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The invite-member-form debounced search no longer lets a slower earlier query overwrite a faster later one's results -- each effect's own cleanup cancels its in-flight response before a newer query's effect runs. Verified via a new regression test (confirmed to fail pre-fix, pass post-fix) plus full pnpm test (560 passed) and pnpm run lint (clean).
<!-- SECTION:FINAL_SUMMARY:END -->
