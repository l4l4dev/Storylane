---
id: TASK-220
title: >-
  split_story takes the source row lock before positions, inverting the board
  RPC lock order
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-29 10:08'
updated_date: '2026-07-30 01:55'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1235
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
split_story (supabase/migrations/20260728073000_recheck_role_after_lock.sql, function body around L505-L545) reads the source story with FOR UPDATE and only afterwards takes pg_advisory_xact_lock('positions:<project>'). Every other board RPC takes the reverse order: insert_board_item, move_story_board and create_draft_story take positions first and then row-lock stories (via _splice_backlog or the position range shift).

That is an AB-BA pair. Concrete deadlock: T1 quick-adds into the backlog anchored before story S — it holds positions and its splice UPDATE waits on S's row lock — while T2 splits S, holding S's row lock and waiting on positions. One of them dies with 40P01.

Found by /code-review high on TASK-212 (fix/create-draft-story-atomic). It is pre-existing, not introduced by that branch, so it was left out of scope there. It also fell outside TASK-212's audit of iteration_finalize acquisition order, because split_story never takes iteration_finalize.

The fix is to hoist the positions lock above the FOR UPDATE read, which needs care: the read doubles as the authorization check (its membership subquery is what collapses 'not yours' into 'Story not found'), and the project_id used to build the lock key currently comes from that same read. TASK-211's exit-guard shape and the existing require_project_role recheck after the lock are the precedent to follow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 split_story acquires positions:<project> before taking any row lock on stories, matching insert_board_item / move_story_board / create_draft_story
- [ ] #2 Hoisting the lock does not weaken the authorization or leak the existence of a story in a project the caller cannot see
- [ ] #3 An integration test drives the T1/T2 interleaving above and fails with 40P01 against the current function
- [ ] #4 The lock-order invariant stated in the create_draft_story migration header is extended to cover the positions/row-lock pair, or moved somewhere both functions point at
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Reviewed by fable-advisor (2026-07-30): approved with corrections. Steps 2, 4, 9 and 10 below carry them.

1. New migration supabase/migrations/20260730000000_split_story_lock_order.sql, replacing split_story's body from 20260728073000. No signature change, so database.types.ts is untouched.
2. Header states the invariant only, in cb4ae1f's tone: positions:<project> then story_number:<project>, both BEFORE any story row lock. Nothing about this pair is written down anywhere yet — 20260729090000's banner covers iteration_finalize only, and create_draft_story.sql:100-102 states the positions -> story_number half without the row-lock half. That comment gets "... and before any story row lock" too. This is AC #4.
3. Hoist BOTH advisory locks (positions, then story_number, relative order preserved) above the authoritative `select ... for update` read. Result: positions -> story_number -> row lock, which is what insert_board_item and create_draft_story already do in practice (their INSERT's numbering trigger takes story_number, and the sibling position shift row-locks after it).
4. The lock key comes from the story, so the locks cannot sit at the top. Add an unlocked probe read for project_id only, mirroring set_story_state (20260729090000) — but NOT its errcodes. split_story is SECURITY DEFINER, so the probe is not RLS-filtered and would otherwise be an existence oracle and a lever for parking a project-wide lock on any project.
5. Gate before the locks: `if v_project_id is null then raise 'Story not found'` and then `v_role := project_role(v_project_id); if v_role is null or not (v_role = any(v_roles)) then raise 'Story not found'`. Both raises carry NO errcode, matching the existing FOR UPDATE raise exactly (bare `raise exception 'Story not found'`, default P0001). set_story_state's `using errcode = 'P0002'` is deliberately not copied, and its two-tier message split is not either: v_roles here is owner/member with no viewer tier that can see but not act. `is null` first because project_role returns NULL for a non-member and `NULL not in (...)` is NULL, which `if` reads as false.
6. The FOR UPDATE read keeps its membership subquery and stays authoritative; the pre-lock gate only raises earlier. The existing require_project_role recheck after the read stays where it is — the FOR UPDATE can still wait on a concurrent row lock.
7. DOWN block at the end of the migration, in 20260729090000's format.
8. Test apps/web/lib/utils/split-story-lock-order.integration.test.ts, built on set-story-state-lock-order.integration.test.ts's waitForLockWaiter + NOWAIT row-lock probe: point waitForLockWaiter at positions:<project> (the first lock in the chain) and assert the source row is NOT lockable by a third session while positions is held elsewhere. Second case ported from that file's "refuses a viewer WITHOUT queueing", adapted to owner/member.
9. A pure two-RPC race is used ONLY as an end-to-end "no 40P01" check, never to discriminate the ordering — TASK-212 established that a race is decided by whoever wins the row and passes against an inverted body.
10. Out of scope, stated in the PR description: move_story_to_project (:678/:711) and copy_story_to_project (:866/:898) still row-lock before taking story_number. Source-side row lock, target-side story_number, so no same-key AB-BA, and outside this task's ACs.
11. rls-security-reviewer pass on the migration, then ask the owner to run /code-review high.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fable-advisor review before implementation: approved with corrections, all folded into the plan.
- pre-lock gate raises carry NO errcode, matching the existing FOR UPDATE raise (bare P0001). set_story_state's `using errcode = 'P0002'` and its P0002/42501 two-tier split are deliberately not copied: v_roles here is owner/member with no viewer tier that can see but not act.
- AC #4 was missing from the plan. The positions/row-lock half of the invariant was written down nowhere (20260729090000's banner covers iteration_finalize only), so the new migration's header states it and create_draft_story.sql's inline comment now points at it.
- Out of scope, confirmed: move_story_to_project and copy_story_to_project still row-lock before taking story_number. Source-side row lock, target-side story_number, so no same-key AB-BA.

Implementation: probe read (project_id only) -> project_role gate -> positions -> story_number -> the unchanged membership-subquery FOR UPDATE -> require_project_role recheck. Signature unchanged, so database.types.ts is untouched.

Both guards verified load-bearing by breaking them:
- restore the old body (row lock before the locks) -> the discriminator test fails with rowLockable false / 55P03
- delete the project_role gate -> the viewer case never settles, { kind: "parked" } after 4s

The viewer test PASSES against the old body, and that is correct: the old body read the row first, so a viewer never reached a lock. It guards the risk hoisting the locks created, not the inversion — the same role its set_story_state counterpart plays.

rls-security-reviewer: no blocking issues, all five claims confirmed. Both gate raises and the FOR UPDATE's are byte-identical with no EXCEPTION block to rewrite the SQLSTATE, so PostgREST's response is indistinguishable; the membership subquery is unchanged and remains the sole authorization source; the recheck still follows every wait; project_id cannot diverge between the probe and the locked read, because no migration ever updates stories.project_id (a move is insert-plus-delete); create or replace preserved the ACL, owner and inline search_path. Its one non-blocking suggestion — state the project_id-immutability fact rather than making a reader re-derive it — is now a comment on the v_project_id declaration.

Verified: 4 new cases + split.integration 14 + create-draft-story 16 + set-story-state-lock-order 6 = 40 passed; grant-lockdown still green; full web suite 858 passed across 94 files; tsc and lint clean.

/code-review high round 1 — two low findings, both closed.

1. The non-member branch of the pre-lock gate was untested. Correct: a viewer still has a project_members row, so it only exercises "role outside v_roles". The reviewer's check held up exactly — rewriting the gate as `if not (v_role = any(v_roles))` leaves the viewer case green while a non-member sails through to the lock, because project_role returns NULL and `NULL = any(...)` is NULL. Added a second user (member of nothing) and asserted its call SETTLES while positions is held elsewhere; verified it fails ({ kind: "parked" }) against the naive spelling. Also widened the existence-oracle case to compare viewer / non-member / missing id.

2. "stories.project_id is not immutable, so a project move between the probe and the locked read gives a confusing error" — the premise did not hold. No trigger pins the column and the UPDATE policy only checks project_role of the row's own project, both as stated, but the PATCH is refused anyway: activity_logs_story_project_fk (20260715000006) is a composite FK on (story_id, project_id), and the story.created log every story carries keeps it referenced. Measured: 23503, "Key is still referenced from table activity_logs". So the failure scenario is unreachable.
   Kept `and project_id = v_project_id` on the locked read regardless — one line, and it keeps the function's reasoning local instead of resting on a constraint two tables away — and rewrote the comment to name the FK as what actually holds the column. Did NOT add a test for the race: constructing it requires deleting the audit rows, which would pass for the wrong reason. The test asserts the move itself is refused with 23503 instead.
   Note for anyone re-reading the earlier rls-security-reviewer pass: its "no migration ever updates stories.project_id" was right about the RPCs but did not consider a direct PostgREST PATCH. The conclusion is unchanged because the FK is what closes it.

Verified: three separate breakages each fail a distinct case — old body -> ordering test (55P03); no gate -> viewer parks; gate without `is null` -> non-member parks. 45 passed across the five related integration suites, full web suite 858 passed across 94 files, tsc and lint clean.

Commits: 2f35ae2 (migration), 05e99b1 (test).

Codex review round 1 (PR #11, fired automatically on open) — one P2, valid, and it is a regression this branch introduced.

Fixing split_story's order left a FOUR-party cycle that the two-party same-project analysis could not see, because it crosses two projects. With S in A and T in B: move S A→B holds row S and waits story_number:B; split T holds number B and waits row T; move T B→A holds row T and waits story_number:A; split S holds number A and waits row S. Verified on paper against both the old and new bodies — it does not exist with the old split ordering, where everything took the row first.

Also checked and rejected a cheaper alternative: giving split the order positions -> row -> story_number breaks both this cycle and the original one, but inverts (story_number, row) against create_draft_story, whose INSERT takes story_number before move_story_board's row locks. That is the original bug again, same project, two parties.

Scope expanded on the owner's call (option A): move_story_to_project and copy_story_to_project now take story_number:<target> above their locked read (20260730010000), completing "every advisory lock before any story row lock". They were the last two holdouts, so no row->advisory edge remains, and each takes a single advisory lock, leaving no advisory->advisory edge to order.

A source gate had to go ahead of the target membership check. Not for lock-parking — the lock is on the target, which the existing check already guards — but for rejection precedence: the checks now run before the read that used to reject first, so without it a viewer of the source is told about its target membership instead of getting the read's generic 'Story not found'. move-copy.integration.test.ts already pinned that.

PROCESS MISS worth keeping: the earlier "full web suite 858 passed" runs did NOT include the integration suites — they are skipped unless SUPABASE_INTEGRATION=1, which turns 94 files into 138. role-recheck-after-lock.integration.test.ts had been failing since the split_story commit and went unnoticed for two review rounds. Always run `SUPABASE_INTEGRATION=1 pnpm test` before claiming a green suite on DB work.

That failure was a real behaviour change, not a broken test: a caller de-membered from the SOURCE while parked is now rejected by the locked read's membership subquery ('Story not found') instead of require_project_role (42501), because the authoritative read moved below the lock. The target side still raises 42501. Kept the new shape rather than adding a second pre-read require_project_role, which would restore the code at the cost of two authorization sites whose messages can drift. Test expectations updated per side with the reason.

Verified: old move/copy bodies -> both ordering tests fail with 55P03; no source gate -> the viewer cases fail with 'Not a member of the target project'. Full suite WITH integration on a database rebuilt from the whole chain: 138 files, 1210 passed, 0 failed. tsc and lint clean.

Commits: f24b348 (migration), b4d7f3e (test).
<!-- SECTION:NOTES:END -->
