---
id: TASK-223
title: >-
  Test gaps: exit guards and a lock-order test that passes on a failed
  transition
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-30 05:58'
updated_date: '2026-07-30 18:26'
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
- [x] #1 A race test revokes the caller while set_story_parent is blocked after authorization and asserts the write rolled back (42501); it fails when that RPC's exit guard is removed
- [x] #2 The same for set_epic_pinned
- [x] #3 The quick-add-vs-transition test seeds an active iteration and requires transition.error to be null, so a transition that does not complete fails the test
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. set-story-state-lock-order.integration.test.ts (AC#3): seed an active iteration in the quick-add-vs-transition test (finalize_iteration, p_manual: false) before racing the two RPCs, and assert transition.error is null. Without an iteration the transition always fails with 'No active iteration' regardless of lock order, so the existing 40P01-only assertions passed on a transition that never completed.
2. set-story-parent.integration.test.ts / epic-pinned.integration.test.ts (AC#1, AC#2): add a race test per RPC that holds the target story's own row FOR UPDATE on a second connection, calls the RPC (which blocks on that same row inside its own SELECT ... FOR UPDATE), de-members the caller while it is genuinely parked, then releases the row and asserts 42501 with the write rolled back.
   Verified first, empirically, against local PG 17 with throwaway tables: a SELECT ... FOR UPDATE that blocks on a locked row and then unblocks re-evaluates its WHERE clause via EvalPlanQual, but a subquery on ANOTHER table (project_members, in these RPCs' own membership filter) still sees the snapshot from before the wait, not the value committed while blocked. So a caller de-membered during the wait still passes the RPC's own initial select+lock, and only the RPC's later, separate exit-guard SELECT (a fresh statement, fresh snapshot) can catch it — which is exactly what AC#1/#2 ask the test to isolate.
3. Both new tests confirmed to discriminate: guard temporarily removed from the live set_story_parent / set_epic_pinned definitions (comment-only edits, restored from 20260728140000_story_rpc_exit_guards.sql afterward) — each RPC's new test failed alone while the rest of its file passed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC evidence:
#1 set-story-parent.integration.test.ts gained "rejects a caller de-membered while blocked on the story's own row (exit guard)". Guard removed from the live function: that test alone failed with 'expected undefined to be 42501', the other 10 in the file passed. Restored and re-verified.
#2 epic-pinned.integration.test.ts gained the analogous test for set_epic_pinned. Same removal/restore cycle: that test alone failed, the other 19 passed.
#3 set-story-state-lock-order.integration.test.ts's "a backlog quick-add and a concurrent state transition both complete" now seeds an active iteration via finalize_iteration and asserts transition.error is null, so a transition that fails for any reason (not just 40P01) fails the test.

Why the row-lock shape works for #1/#2 rather than needing a trigger-based second wait: verified directly (not inferred) that PostgreSQL's Read Committed EvalPlanQual, on unblocking a FOR UPDATE wait, re-fetches only the row that was locked — a subquery referencing another table (project_members) in the same WHERE clause still evaluates against the pre-wait snapshot. Two throwaway tables, two psql sessions: session B blocked on session A's row lock while a plain UPDATE to the OTHER table committed during the wait; once A released, B's re-evaluated query still returned the row as if the other table's change had not happened. This is what makes holding the story's own row a valid, guard-specific test rather than one that would also be caught by the RPC's own initial authorization.

Verification: SUPABASE_INTEGRATION=1 pnpm test = 1242 passed / 141 files (+2 from TASK-222's baseline). pnpm run lint and tsc --noEmit clean.

Codex review of PR #15, round 1 — one P2, accepted; it invalidated the AC#1 test's design (not the exit guard itself, which was always correct).

The original set_story_parent test held the CHILD's own row externally, same as set_epic_pinned's. Codex pointed out that only proves SOME fresh membership check runs after the initial select unblocks — not specifically the guard at the function's true exit. Confirmed empirically by moving require_project_role to right after the initial select (before the UPDATE): the original test still passed.

Fixed by holding the OLD PARENT's row instead: detaching fires maintain_is_container AFTER UPDATE, which calls recompute_is_container(old.parent_id) — a `select ... for update` on the parent taken even when it ends up writing nothing (an epic_pinned parent keeps is_container regardless of child count). That wait sits strictly after the child's own write, so a guard placed anywhere earlier — including right after the initial select — cannot see a de-membering that lands during it. Re-verified against the same three variants: guard removed (fails), guard moved to right-after-select (now correctly fails too), guard at the true exit, current definition (passes). Also strengthened the rollback assertion to cover the cascading is_container flip, not just the child's own parent_id.

set_epic_pinned's test (AC#2) was checked against the same concern and left as originally designed: this RPC has no wait between "right after the select" and its true exit (traced every trigger on stories — stories_maintain_is_container only fires on UPDATE OF parent_id, which this RPC never touches), so a guard placed at either point protects identically. Confirmed empirically — moving its guard to right-after-select still passes the existing test, because there is no real difference in protection to detect there. Comment expanded to record this reasoning so a future review does not have to re-derive it or assume the two tests should be symmetric.

Re-verified after the fix: SUPABASE_INTEGRATION=1 pnpm test = 1242 passed / 141 files, lint and tsc clean.

Codex review of PR #15, round 2 — one P2, one P3, both accepted.

P2: re-raised for epic-pinned.integration.test.ts specifically — the round-1 fix only addressed set_story_parent. Codex proposed the mechanism: lock the project row so the activity_logs insert (project_id foreign key check, taken for a points-bearing story) waits on it. Verified the FK check does take a conflicting lock: two raw psql sessions, an INSERT into activity_logs blocked for the full duration of a FOR UPDATE held on the referenced projects row by another session, then proceeded once released. Rewrote the test around that wait (holding public.projects instead of the story's own row) and confirmed the same three-variant cycle as set_story_parent: guard removed (fails), guard moved to right-after-select (now correctly fails too — previously passed), current definition (passes). Hit one assertion bug while measuring this: the first version's activity_logs rollback check counted ALL rows for the story_id, which included the unrelated 'story.created' row from the story's own insert (a leftover from the failed guard-moved-early run made this visible in the live catalog); narrowed to action = 'story.containerized'.

P3: dropped the TASK-223/Codex/PR-number narration from both new-test comments (set-story-parent and epic-pinned), keeping only the concurrency reasoning.

Re-verified after both fixes: SUPABASE_INTEGRATION=1 pnpm test = 1242 passed / 141 files, lint and tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed three test gaps that stayed green while the behaviour they named could break. set_story_parent and set_epic_pinned's exit guards (20260728140000) now each have a race test proving they — specifically, not any earlier check — reject a caller de-membered mid-flight; set-story-state-lock-order's quick-add-vs-transition test now requires the transition to actually complete.

The first attempt at the two exit-guard tests held only the target story's own row, which Codex (PR #15, two rounds) showed only proves SOME check runs after the initial select — not the guard specifically. Fixed by finding a real wait that sits strictly after the write for each RPC: set_story_parent's detach fires a trigger that locks the OLD PARENT row even when it changes nothing; set_epic_pinned's points-bearing pin inserts into activity_logs, whose foreign key takes KEY SHARE on the projects row. Both waits were verified directly (raw psql sessions, and — for set_story_parent — timing a real block) before building the tests around them, and both tests were confirmed to fail when the guard is moved to right after the initial select, not just when it's removed entirely.

Verified: SUPABASE_INTEGRATION=1 pnpm test = 1242 passed / 141 files (unchanged count from before this task — these are new assertions inside existing/new test files, no new test files beyond one). pnpm run lint and tsc --noEmit clean. Reviews: /code-review high found no correctness bugs (two Low/cleanup findings declined as pre-existing patterns, out of scope). Codex round 1 found the set_story_parent test-design flaw (fixed); round 2 found the same flaw still open in set_epic_pinned (fixed); round 3 clean. Merged as 10544ca.
<!-- SECTION:FINAL_SUMMARY:END -->
