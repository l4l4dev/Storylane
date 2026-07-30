---
id: TASK-222
title: 'DB: pin split_story''s source iteration, or take the finalization key'
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-30 05:58'
labels: []
milestone: m-2
dependencies: []
priority: high
type: bug
ordinal: 1275
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex P1 on PR #9 (comment 3670890056), confirmed still open after TASK-219 merged.

split_story takes `positions:<project>` and `story_number:<project>` but NOT `iteration_finalize:<project>`, and it decides whether children inherit the source's iteration from an UNLOCKED read of `iterations.state`:

    select state = 'done' into v_iter_done from public.iterations where id = v_source.iteration_id;

A concurrent finalize_iteration can mark that iteration done after this read. The split then inserts children into an iteration the finalizer has already closed: the insert trigger sees the finalizer's prior committed 'active' version, while the finalizer's rollover UPDATE cannot see rows inserted after it started. Children end up in a finished iteration, which is exactly the shape stories_enforce_board_invariants and the velocity snapshot assume cannot exist.

This is the same class TASK-219 closed for projects/project_states/integrations: a precondition the RPC is the only enforcement of, read unlocked before a wait. spec/rls.md's rule ("Pin the config a SECURITY DEFINER RPC enforces itself") already covers it in spirit but does not name `iterations`.

Two candidate mechanisms, needs a decision rather than a patch:
  (a) pin the source iteration row with `select ... for share` in tier (before the story row lock), extending the existing rule to `iterations`; or
  (b) take `iteration_finalize:<project>` at the top of split_story, matching create_draft_story and set_story_state.

(b) is the repo's existing convention for anything that races finalization, but it serializes every split against rollover; (a) is narrower and matches TASK-219. Note the lock-order interaction: iteration_finalize: would have to be ordered against split_story's existing positions:/story_number: keys, and spec/rls.md's three-tier order records advisory locks first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The unlocked `iterations.state` read in split_story can no longer decide a child's iteration_id: either the row is pinned before the story row lock or the function holds iteration_finalize:<project>
- [ ] #2 spec/rls.md records which mechanism was chosen and adds `iterations` to the list of pinned config, or explains why the advisory key was preferred
- [ ] #3 The chosen lock order is stated in the migration header and does not conflict with split_story's existing positions:/story_number: keys
- [ ] #4 An integration test fails when the new guard is removed (a split racing a finalization must not land children in the finished iteration)
<!-- AC:END -->
