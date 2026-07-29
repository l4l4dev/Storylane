---
id: TASK-219
title: 'Re-derive RPC preconditions after the last wait, not per-value at the exit'
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-29 03:59'
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
- [ ] #1 The three known open cases are closed: retained assignee, reshape_current_iteration's iteration_length, and finish_story_from_git's forward-only state positions
- [ ] #2 The approach is a single mechanism (re-derivation or a broader lock), not one more per-value check, and spec/rls.md records it
- [ ] #3 Each closed case has a test that fails when its guard is removed
- [ ] #4 The DB-side point-scale literals are reduced to one source
<!-- AC:END -->
