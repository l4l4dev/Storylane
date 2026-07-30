---
id: TASK-223
title: >-
  Test gaps: exit guards and a lock-order test that passes on a failed
  transition
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-30 05:58'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two Codex findings from the review sweep (PR #9 comment 3670890052, PR #10 comment 3675289851), both confirmed still open. Neither is a product bug: both are tests that stay green when the behaviour they name is broken.

1. set_story_parent / set_epic_pinned exit guards are untested. 20260728140000_story_rpc_exit_guards.sql gave both an exit guard, but no test revokes access while either is blocked after authorization — set-story-parent.integration.test.ts and epic-pinned.integration.test.ts have no revoke-while-blocked case, and role-recheck-after-lock.integration.test.ts does not cover either setter. Deleting either guard leaves the whole suite green. The harness to copy is callWhileRevoked / waitForRowWaiter in role-recheck-after-lock.integration.test.ts.

2. "a backlog quick-add and a concurrent state transition both complete" (set-story-state-lock-order.integration.test.ts) does not require the transition to complete. seed() creates backlog stories with no iteration, so set_story_state into an in_progress state always ends in P0001 ("No active iteration"); the test only asserts the two calls are not 40P01 and that created.error is null. It would pass if the transition failed for any non-deadlock reason, including a lock error other than 40P01.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A race test revokes the caller while set_story_parent is blocked after authorization and asserts the write rolled back (42501); it fails when that RPC's exit guard is removed
- [ ] #2 The same for set_epic_pinned
- [ ] #3 The quick-add-vs-transition test seeds an active iteration and requires transition.error to be null, so a transition that does not complete fails the test
<!-- AC:END -->
