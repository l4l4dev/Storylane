---
id: TASK-219
title: 'Re-derive RPC preconditions after the last wait, not per-value at the exit'
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-07-29 03:59'
updated_date: '2026-07-30 05:46'
labels: []
milestone: m-2
dependencies: []
priority: high
type: bug
ordinal: 1225
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-211 evolved from 'recheck the role after the advisory lock' to 'guard the exit', and closing each precondition individually did not converge: Codex rounds 5-8 produced 4-5 findings of the identical shape every time — the role, then the webhook config and projects.archived_at, then projects.point_scale, and finally the retained assignee, projects.iteration_length in reshape_current_iteration, and the forward-only state positions in finish_story_from_git. The first four are fixed and shipped; the last three are not.

The cause is structural rather than a list of oversights. 'A value read before a wait and enforced only inside the RPC' is an open set, so enumerating it fails exactly the way enumerating wait points failed in round 5 — and the waits themselves are unenumerable (advisory locks, FOR UPDATE, ordinary tuple-lock waits, foreign-key waits, locks taken by triggers, and locks taken by functions those triggers call). Adding a fourth, fifth and sixth per-value exit check would leave the same trajectory.

Two candidate designs, both needing a decision rather than a patch: re-DERIVE the inputs after the last wait instead of re-validating cached copies, or serialise these RPCs against settings changes with a broader lock so the cached values cannot go stale. spec/rls.md 'Guard the EXIT of a SECURITY DEFINER RPC' documents the current state and should be updated with whichever wins.

Known open cases to cover: the retained assignee in move_story_to_project / copy_story_to_project must still be a member of the target when the write lands (spec/features.md); reshape_current_iteration reads projects.iteration_length before taking iteration_finalize; finish_story_from_git reads the source and target state positions before the story UPDATE and its exit guard only re-checks the integration's target id, so a concurrent reorder can make the committed transition backwards.

Also in scope, found while inventorying the above: the fibonacci/linear point-scale literals exist SEVEN times across five DB functions (assert_points_on_scale, update_story, split_story, move_story_to_project, copy_story_to_project), separate from the canonical client copy in packages/core/src/story-types.ts. Reducing the DB side to one source belongs with this work, since assert_points_on_scale is one of the copies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The three known open cases are closed: retained assignee, reshape_current_iteration's iteration_length, and finish_story_from_git's forward-only state positions
- [x] #2 The approach is a single mechanism (re-derivation or a broader lock), not one more per-value check, and spec/rls.md records it
- [x] #3 Each closed case has a test that fails when its guard is removed
- [x] #4 The DB-side point-scale literals are reduced to one source
- [x] #5 split_story is closed by the same mechanism: its pre-write point-scale read is pinned (owner-approved scope addition 2026-07-30; it retains no assignee — the insert writes NULL per doc-18 §7, so the pattern it shares with move/copy is the scale, not the assignee)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design settled 2026-07-30 by fable-advisor: mechanism is (B) a single `SELECT ... FOR SHARE` on the config rows an RPC reads, taken once, then read-and-trust — the per-value exit re-reads are deleted, not extended. (A) re-derivation after the last wait was rejected: an unlocked read always races the COMMIT itself, and 20260728100000 already implements A's shape in finish_story_from_git yet still has the hole. Lock order becomes three tiers: advisory locks -> config-row FOR SHARE -> story row locks, with the FK-induced automatic KEY SHARE lock as a documented exception. The composite-FK answer for assignee membership was split out to TASK-221; split_story's copy of the same pattern was folded IN here at the owner's request.

Shipped on branch fix/pin-rpc-config-for-share (PR #12), held from Done until that merges.

Verification behind the checked ACs: 99 passing assertions across the 6 affected integration files, plus apps/web `pnpm test` (858 passed) and `pnpm run lint`. AC #3 was verified negatively as well — the state-set pin and move/copy's projects pins were removed from the local DB's function definitions and 4 tests failed, then restored.

/code-review high raised four findings, all fixed in the same branch. The load-bearing one: the first draft pinned the story's own project_states row BELOW the story row lock, which deadlocks against `delete from project_states` — its NO ACTION FK check takes FOR KEY SHARE on the referencing stories while the delete holds the state row, so a writer does hold a state row exclusively while waiting on a story row (reproduced: 40P01, victim = the webhook). finish_story_from_git now pins the project's whole project_states set in tier, above the story row lock, and takes project_states_positions: so a reorder cannot interleave. Only one out-of-tier pin is left (the assignee's project_members row, TASK-221).

finalize_iteration also reads projects.iteration_length unpinned; it was not in this task's inventory, so it is recorded in spec/rls.md's "does NOT cover" list instead of changed.

rls-security-reviewer pass: no blocking findings.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Preconditions a SECURITY DEFINER RPC is the only enforcement of are now pinned with a single `select ... for share` per config row, read once and trusted to commit; the per-value exit re-reads are deleted (an unlocked exit read races the COMMIT itself). Applies to split_story, move/copy_story_to_project, reshape_current_iteration and finish_story_from_git; the role keeps the TASK-211 exit-guard pattern, and update_story stays on a plain read because a locking clause under RLS also needs the UPDATE policy's USING. The seven copies of the point-scale literals collapse into point_scale_values(), and assert_points_on_scale is dropped.

Lock order is three tiers (advisory locks -> config-row `for share` -> story row locks), with the `projects` row ahead of any child config row and one out-of-tier pin left (the assignee's project_members row, TASK-221). Two deadlocks were found by review and both were reproduced on a local DB before fixing: a project_states row pinned below the story row lock loses to `delete from project_states` (NO ACTION FK check locks the referencing stories), and an unlocked `projects` probe loses to a project delete whose cascade reaches stories first. Both re-verified as serialised after the fix.

Verified with 99 passing assertions across the 6 affected integration files, apps/web `pnpm test` (858 passed) and `pnpm run lint`; each pin was also checked negatively by removing it from the local DB's function definition and watching the matching test fail. rls-security-reviewer: no blocking findings. Codex on the final head (ab7ce28): no issues. Merged as 8c86115 (PR #12).
<!-- SECTION:FINAL_SUMMARY:END -->
