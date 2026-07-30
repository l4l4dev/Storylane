---
id: TASK-222
title: 'DB: pin split_story''s source iteration, or take the finalization key'
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-30 05:58'
updated_date: '2026-07-30 12:48'
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
- [x] #1 The unlocked `iterations.state` read in split_story can no longer decide a child's iteration_id: either the row is pinned before the story row lock or the function holds iteration_finalize:<project>
- [x] #2 spec/rls.md records which mechanism was chosen and adds `iterations` to the list of pinned config, or explains why the advisory key was preferred
- [x] #3 The chosen lock order is stated in the migration header and does not conflict with split_story's existing positions:/story_number: keys
- [x] #4 An integration test fails when the new guard is removed (a split racing a finalization must not land children in the finished iteration)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New migration 20260730040000_split_story_iteration_finalize.sql recreating split_story with one added line: pg_advisory_xact_lock('iteration_finalize:<project>') immediately before the existing positions:/story_number: keys. Header states the order iteration_finalize -> positions -> story_number -> config for share -> story row locks, referencing 20260729050000 and 20260729090000 as the same invariant. Taken unconditionally: branching on whether the source has an iteration would need the story row, which is locked after the keys.
2. Keep the unlocked iterations.state read, with a comment recording that the key is what makes it sound.
3. spec/rls.md: add an iterations.state paragraph to the 'Pin the config a SECURITY DEFINER RPC enforces itself' section — advisory key rather than row pin, why the row cannot be pinned in tier, and the direct UPDATE policy that makes this a 'convention only RPCs follow' (AC#2).
4. Test in split-story-lock-order.integration.test.ts: hold iteration_finalize on a second connection, assert split_story parks with the source row still FOR UPDATE NOWAIT-able and positions: still free. A real race is deliberately not used — both existing lock-order test files record why it has no discriminating power.

Advisor verdict (fable): (b) approved with corrections — name the iterations UPDATE policy in spec/rls.md, and use the park-shape test rather than a real race. A state-transition guard trigger on iterations was raised as out of scope.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented option (b), the iteration_finalize:<project> advisory key (fable-advisor verdict: (b) approved with corrections).

Migration 20260730040000_split_story_iteration_finalize.sql recreates split_story with one added statement — pg_advisory_xact_lock(hashtext('iteration_finalize:' || v_project_id::text)) — immediately before the existing positions:/story_number: keys. Taken unconditionally: branching on whether the source has an iteration needs the story row, which is locked after the keys, and re-taking an advisory lock in the same transaction is free. The unlocked iterations.state read stays, with a comment recording that the key is what makes it sound. Header states the order iteration_finalize -> positions -> story_number -> config for share -> story row locks, and cites 20260729050000 / 20260729090000 as the same invariant.

Why not (a), the row pin: v_source.iteration_id is only known from the locked story read, so the row cannot be pinned in tier (spec/rls.md's own caveat, the one that made project_states a per-project set). Pinning the set instead would block unrelated goal/retro_notes edits and would leave create_draft_story and set_story_state on the advisory key anyway.

AC evidence:
#1 the key is taken before every read that decides the child's iteration_id; verified in the live catalog (pg_proc.prosrc contains the pg_advisory_xact_lock call).
#2 spec/rls.md's 'Pin the config a SECURITY DEFINER RPC enforces itself' section gained an iterations.state paragraph: advisory key rather than row pin, why the row cannot be pinned in tier, and — on the advisor's correction — that iterations carries a `members can update iterations` UPDATE policy with no column restriction, so this is the same 'convention only RPCs follow' as the rejected membership: proposal. A state-transition guard trigger is named as the thing that would close it.
#3 the migration header states the order; create_draft_story (20260729050000) and set_story_state (20260729090000) take the same one. rls-security-reviewer confirmed finalize_iteration / override_iteration_length / reshape_current_iteration take only iteration_finalize: and never positions:/story_number: afterwards, so no reverse-order pair exists.
#4 split-story-lock-order.integration.test.ts gained 'parks on iteration_finalize before it takes positions'. Guard removed from the live function (comment-only variant of the same file): that test alone failed with 'the RPC never parked on the advisory lock', the other six passed; the function was then restored from the migration and the guard and grant re-verified in the catalog. A real race is deliberately not used — both existing lock-order test files record that a two-caller race is decided by whoever wins the row and comes out green either way.

rls-security-reviewer: no findings. Confirmed by catalog rather than by migration text — prosecdef, search_path=public, EXECUTE granted to authenticated (and not anon) after create or replace; the new lock sits after the DEFINER project_id probe and the project_role gate, so neither a viewer nor a non-member can park the project-wide lock; only finalize_iteration writes iterations.state and it takes the key before the write. It re-flagged the pre-existing direct-PATCH gap on iterations (already documented in spec/rls.md by this change) as follow-up material, not a regression.

Verification: supabase migration up --local applied cleanly. SUPABASE_INTEGRATION=1 pnpm test = 1240 passed / 141 files. pnpm run lint and tsc --noEmit clean.

/code-review high — one Low finding, fixed. The comment on the unlocked iterations.state read stated the invariant absolutely ('no writer runs outside the key'), which is true of every RPC but not of the database: the UPDATE policy admits a direct PATCH of the column. Reworded to say so and to point at spec/rls.md and TASK-225. The review also established the practical blast radius, which the comment now records: reject_done_iteration_assignment re-reads state at insert time, so a PATCH that commits mid-call costs a P0001 rather than a child in a closed iteration.

The review's own verification, read-only against the live catalog: a lock-order sweep over every public function (comments stripped from prosrc) found that all eight functions taking iteration_finalize: take it first, and none takes positions:/story_number:/a stories row lock before it — no 40P01 cycle. Writers of iterations.state are finalize_iteration, override_iteration_length and reshape_current_iteration, all of which hold the key. The live split_story body matches the migration file, so the guard-removal experiment left no drift.

Re-verified after the fix: SUPABASE_INTEGRATION=1 pnpm test = 1240 passed / 141 files.
<!-- SECTION:NOTES:END -->
