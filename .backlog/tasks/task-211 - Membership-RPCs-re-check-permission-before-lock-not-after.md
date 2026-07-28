---
id: TASK-211
title: 'Membership RPCs re-check permission before lock, not after'
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
updated_date: '2026-07-28 09:33'
labels: []
milestone: m-2
dependencies: []
references:
  - supabase/migrations/20260717000001_guard_helpers.sql
  - supabase/migrations/20260722000003_drop_story_pins.sql
priority: high
type: bug
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
change_member_role, remove_member, and invite_member (20260717000001_guard_helpers.sql) check the caller's role via require_project_role BEFORE taking pg_advisory_xact_lock(hashtext('membership:'...)), then never re-check it after acquiring the lock. If the caller is demoted or removed by another owner while blocked on the lock, the operation still proceeds once the lock is granted. move_story_board and split_story have the same before-lock-only permission check shape. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A concurrent demotion that commits while the caller is blocked on the lock causes the blocked call to fail with an authorization error, not succeed
- [x] #2 change_member_role and remove_member re-verify the caller's role after acquiring the membership advisory lock and before writing
- [x] #3 Rebuilding each function preserves the behaviour of its true latest definition (remove_member's my_work_story_state purge, split_story's duplicate-task_id rejection), not the older version the task References point at
- [x] #4 Every other RPC that takes an advisory lock gets the same after-lock re-check: move_story_board, split_story, move_story_to_project, copy_story_to_project, insert_board_item, create_project_state, reorder_project_state
- [x] #5 invite_member takes no lock, but its on-conflict insert can still wait on a row a concurrent remove_member is deleting, so its re-check sits AFTER the insert where raising rolls it back
- [x] #6 Preconditions other than the role that are read before the lock and enforced only inside the RPC (projects.archived_at, projects.point_scale) are re-read after it too
- [x] #7 The role list is hoisted into a variable in every function so the pre- and post-lock checks cannot drift apart
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Findings first, verified against the live DB and the migration sources:
- The repo already solved this exact class twice: 20260722000006 (cadence RPCs) and 20260722000010 (finalize_iteration, TASK-142). Their documented rationale applies verbatim — project_role() is STABLE but each PL/pgSQL statement gets its own READ COMMITTED snapshot, so a second call after the lock sees a revocation committed while the caller was blocked; and SECURITY DEFINER means RLS never applies inside, so an explicit re-check is the only equivalent of the RLS re-evaluation a plain UPDATE would get. TASK-142 also hoists the role set into a variable so the pre- and post-lock checks cannot drift apart. Follow that pattern rather than inventing one.
- The task description is inaccurate on one point: invite_member takes NO advisory lock at all. It checks the role then does insert ... on conflict do nothing. So it has no unbounded-wait window of the kind described, only the ordinary sub-statement race. It also does not serialize against change_member_role/remove_member, which do hold membership:<project>.
- remove_member's entry guard is deliberately bespoke (it permits self-leave by a non-owner), so its re-check must re-apply that same shape, not require_project_role(...,'owner').
- move_story_board checks project_role then takes iteration_finalize + positions locks. split_story authorizes inside a SELECT ... FOR UPDATE with a membership subquery, then takes positions + story_number locks. Both are before-lock-only, so AC #3 is real for both.
- The test harness for AC #2 already exists: finalize-iteration-role-recheck.integration.test.ts uses a raw pg client to hold pg_advisory_lock across statements (supabase-js cannot), parks the RPC on it, revokes membership while it waits, releases, and asserts the failure. Reusable for all five functions.

Plan: one migration recreating the five functions, each re-asserting its own authorization immediately after the last lock it takes and before any write, with the role set hoisted so the two checks cannot diverge.
1. change_member_role — re-assert owner after the membership lock.
2. remove_member — re-assert the owner-or-self shape after the membership lock.
3. invite_member — open question for the advisor: take the membership lock (consistent with its siblings, and it currently serialises against neither) plus a post-lock re-check, or leave it lock-free and simply re-check before the INSERT? AC #1 assumes a lock exists.
4. move_story_board — re-assert after both locks. Hot path, so the added cost is one project_role() call per move.
5. split_story — re-assert after its locks; its authorization is currently a membership subquery inside the row read, so the re-check has to be written explicitly rather than reusing that shape.

Verification: extend the existing recheck harness to cover each function, so a concurrent demotion committed while the caller is parked on the lock makes the call fail; full suite with SUPABASE_INTEGRATION=1; rls-security-reviewer pass (migration); then /code-review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced the window before fixing anything, using the technique the TASK-142 test already established (a raw pg client holds the advisory lock so the RPC parks after its pre-lock check, the caller is demoted mid-wait, then the lock is released): change_member_role returned no error and successfully changed another member's role even though the caller had been demoted from owner to viewer while parked. Confirmed, not assumed.

fable-advisor verdict: APPROVED WITH CORRECTIONS, and it caught two things that would have caused real damage.

FIRST, and most valuable: rebuilding these functions from the migrations this task's References point at would have silently reverted shipped behaviour. CREATE OR REPLACE needs the whole body, and 20260717000001_guard_helpers.sql is NOT the latest definition of remove_member or invite_member. Verified against the running database: the live remove_member purges my_work_story_state (added by 20260722000003) and the live invite_member blocks invites to personal projects (added by 20260722000014, four references) — neither appears in guard_helpers.sql. Same trap for split_story, whose latest is 20260724123806 (duplicate-task_id rejection), not the file I would have reached for. Every body in this migration is therefore taken from \sf against the live DB, and I cross-checked the advisor's file list against the repo (all five matched the last migration defining each function).

SECOND: the function inventory was short by two. move_story_to_project and copy_story_to_project have the identical shape — membership verified, then pg_advisory_xact_lock('story_number:'||target), then writes — and the advisor noted story_number is contended by every numbering path in a project (ordinary story creation, insert_board_item, split_story, other moves), making it MORE likely to be hit in practice than membership. Owner approved widening the scope to seven functions and AC #3 was reworded accordingly.

Three design rulings taken from the advisor:
- invite_member unchanged. No invariant needs the lock: change_member_role/remove_member serialise to protect the last-owner rule, whereas invite_member's on conflict (project_id, user_id) do nothing is already atomic against concurrent invites through the unique constraint. Adding a lock would protect nothing and would stall every invite behind unrelated demotions. A test asserts invite_member still succeeds while membership:<project> is held by another session, so a future change that adds a lock has to confront this decision rather than silently reintroduce the cost.
- move_story_board takes one extra project_role() call. Nothing it re-reads under the locks carries membership, so there is no cheaper equivalent, and one STABLE index lookup is negligible beside an O(N) position shift.
- split_story and move/copy_story_to_project keep their bespoke source guard. The membership subquery inside select ... for update deliberately collapses 'not yours' into 'Story not found'; converting it to require_project_role would separate 'exists but forbidden' from 'does not exist' and leak story existence across projects. The post-lock re-check keys off the project_id that read already established, so it adds no disclosure.

Implementation caught one bug of my own, via the probe rather than by inspection: require_project_role is VARIADIC, so passing the hoisted text[] needed an explicit 'variadic' keyword on the call. Without it every change_member_role call failed with 'function does not exist' — the probe surfaced it because it reported the block for the wrong reason ('function ... does not exist' instead of 'not authorized').

Verified: new role-recheck-after-lock.integration.test.ts 8/8, and NOT vacuous — reverting the six functions to their pre-fix bodies fails 6 of the 8 (the two that still pass are the self-leave case and the invite_member no-lock assertion, both of which describe unchanged behaviour). Full web suite 1153/1153 from a clean reset (was 1145), MCP 29/29, lint clean, generated types unchanged. The five suites covering the changed functions (membership, split, move-copy, move-story-board, personal-project-seal-seams) pass 60/60, which is what guards against the silent-revert trap above.

rls-security-reviewer pass (required by CLAUDE.md for migrations): NO BLOCKING FINDINGS. Verified empirically, not by inspection — it reset the stack and queried has_function_privilege directly (falling back from _grant_audit(), which is itself revoked from authenticated), and diffed each new body line-by-line against its most recent prior definition.

Confirmed on each of the six points asked: grants unchanged (all six remain authenticated=t, anon=f, service_role=t, and all six were already on grant-lockdown's AUTHENTICATED_ALLOWLIST — CREATE OR REPLACE preserves the ACL, only DROP FUNCTION clears it, matching how 20260722000006 and 20260722000010 handle it); every re-check sits after the last lock and before any write or subsequent read, including before move_story_board's divider path; remove_member's re-run guard is a verbatim copy of its entry guard, so a demoted caller is blocked from removing others while self-leave still passes both checks; the post-lock require_project_role on the source project leaks nothing new, since the project_id it uses is only reachable after the row read's membership subquery already passed; the file contains zero POLICY/ALTER TABLE statements and the per-function diffs show the guard block as the only addition. It specifically confirmed remove_member's my_work_story_state purge is present and unmodified, i.e. that taking the body from the live DB rather than the referenced migration worked as intended. All five DOWN references verified correct by locating the chronologically last definition of each name.

One non-blocking observation, recorded rather than changed: in move_story_to_project/copy_story_to_project the PRE-lock target check raises a descriptive 'Not a member of the target project' while the new POST-lock re-check raises the generic 42501 'not authorized', so a client may see either message depending on which trips. This is net-new behaviour rather than a regression (no post-lock path existed before) and mirrors the same trade-off 20260722000010's header already documents for require_project_role.

Re-ran the full suite after the reviewer's resets: 1153/1153 still green.

/code-review high, second round: 6 findings, all fixed.
1. The header claimed the role list is hoisted so pre/post checks cannot drift, then did that in 1 of 10 functions; the other 8 carried the same list twice in two different dialects (inline project_role() vs require_project_role). Concrete drift: widening move_story_board to admit viewer by editing only the inline guard would make every viewer drag fail at 42501 after both project-wide locks; the reverse edit reopens the window silently. Now hoisted everywhere, with the inline guards rewritten to  and the membership subqueries to .
2. AC #4 still said invite_member was unchanged while the migration had started changing it — a reader restoring it to 'its unchanged form' would have dropped a live guard. ACs rewritten.
3. The stale-notes finding above, plus the missing review coverage; the rls-security-reviewer pass was re-run against all ten.
4. move/copy_story_to_project re-read archived_at after the lock but left point_scale from that same pre-lock SELECT stale, so a scale narrowed during the wait would let the clamp admit an off-scale value with nothing downstream re-validating it. Both are now re-read after the lock.
5. The invite_member wait poll counted ungranted transactionid/tuple locks cluster-wide, so an unrelated blocked write could let the test proceed before the insert had parked — the same vacuousness waitForWaiter was written to prevent. Scoped to a waiter blocked on this connection's own transaction.
6. spec/rls.md documented require_project_role but had no rule about re-checking after a lock, despite this being the third migration implementing it — which is why all ten were written without one. Added, covering the re-check itself, the hoisted role list, re-reading other pre-lock preconditions (archived_at, point_scale), and the invite_member shape where the re-check follows the write.

rls-security-reviewer, second pass over all ten: NO BLOCKING ISSUES. Verified empirically from a clean reset. Bodies of the four new functions diff clean against their true sources including invite_member's personal-project ban; all ten keep authenticated=true/anon=false, with every prior grant's argument list cross-checked against the new signatures to confirm the ACL-preservation assumption; the  rewrites still fail closed on NULL (the explicit  disjunct short-circuits before any() can yield NULL, subquery matches simply miss, and the target checks coalesce to ''); invite_member's post-insert re-check genuinely closes the window because the insert is not durable until commit and the re-check runs on a fresh snapshot; the DOWN block is accurate for all ten. Its one optional nit — that the pre-lock point_scale fetch had become dead once the post-lock re-read was added — was verified independently (nothing reads those variables between the two reads) and trimmed.

SUPERSEDES the earlier note in this task that said seven functions, 8 tests and a six-function review pass — that description is stale. The shipped migration rewrites TEN functions and the test file has THIRTEEN cases. Corrected here because /code-review flagged the drift: insert_board_item, create_project_state, reorder_project_state and invite_member's re-check were added after the first advisor and RLS passes, so they sat outside every recorded review at that point.

/code-review high, second round: 6 findings, all fixed.

1. The header claimed the role list is hoisted so the pre- and post-lock checks cannot drift, then did that in 1 of 10 functions; the other 8 carried the same list twice in two different dialects (an inline project_role() test and a require_project_role call). Concrete drift the reviewer named: widening move_story_board to admit viewer by editing only the inline guard would make every viewer drag fail with 42501 after both project-wide locks were already taken, and the reverse edit reopens the window silently. Now hoisted in all ten, with the inline guards rewritten to test membership of the array and the source membership subqueries doing the same.

2. AC #4 still said invite_member was unchanged while the migration had already started changing it — a reader restoring it to "its unchanged form" would have dropped a live guard. The ACs were rewritten to match what ships.

3. The stale-notes finding above, plus the review-coverage gap it implied. The rls-security-reviewer pass was re-run against all ten functions rather than the original six.

4. move/copy_story_to_project re-read archived_at after the lock but left point_scale and custom_points from that same pre-lock SELECT stale, so a scale narrowed during the wait would let the points clamp admit an off-scale value — and nothing downstream re-validates points against a scale. Both are now re-read after the lock.

5. The invite_member wait poll counted ungranted transactionid/tuple locks cluster-wide, so any unrelated blocked write could let the test proceed before the insert had actually parked — the same vacuousness waitForWaiter was written to prevent for the lock-based cases. Scoped to a waiter blocked on this connection's own transaction.

6. spec/rls.md documented require_project_role but carried no rule about re-checking after a lock, despite this being the third migration to implement one — which is precisely why all ten of these were written without a rule to follow. Added, covering the re-check itself, the hoisted role list, re-reading other preconditions that are read before the lock and enforced only inside the RPC (archived_at, point_scale), and the invite_member shape where the re-check follows the write instead of a lock.

rls-security-reviewer, second pass over all ten: NO BLOCKING ISSUES, verified empirically from a clean reset. The four new bodies diff clean against their true sources, including invite_member's personal-project ban. All ten keep authenticated=true and anon=false, and every prior grant's argument list was cross-checked against the new signatures to confirm the ACL-preservation assumption actually holds. The rewritten array-membership guards still fail closed on NULL: the explicit is-null disjunct short-circuits before the array test can yield NULL, subquery predicates simply match no row, and the target-project checks coalesce to an empty string first. invite_member's post-insert re-check genuinely closes the window rather than moving it, because the insert is not durable until the function's transaction commits and the re-check runs as its own statement on a fresh READ COMMITTED snapshot. The DOWN block is accurate for all ten.

Its one optional nit — that the pre-lock point_scale fetch became dead weight once the post-lock re-read was added — was verified independently (nothing reads those variables between the two reads) and trimmed to fetch only archived_at.

Final: full web suite 1158/1158 from a clean reset, role-recheck 13/13, MCP 29/29, lint clean, generated types unchanged.

CI failed on the first push with a type error I had not caught: pnpm --filter web exec tsc --noEmit, exit 2, ten occurrences in the new test file. callWhileRevoked declared its revoke parameter as () => Promise<unknown>, but supabase-js's query builder is a thenable rather than a real Promise (no catch/finally/Symbol.toStringTag), so every call site failed to typecheck. Fixed by declaring it PromiseLike<unknown>, which is what the call parameter next to it already used and what the builder actually is.

My verification gap, not a flaky CI: I ran vitest and lint locally but never ran tsc, and vitest transpiles without typechecking so the tests passed against code that could not compile. Corrected by running every command web-ci.yml actually runs before pushing again — core tsc, core tests (77), web tsc, web lint, web build, and the integration suite — rather than the subset I had been checking.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed the before-lock-only authorization window in every RPC that takes an advisory lock: a caller demoted or removed while parked on one still completed the write, because these are SECURITY DEFINER and get no RLS re-evaluation. Reproduced first (a demoted owner successfully changed another member's role), then fixed by re-asserting the guard after the lock — the pattern 20260722000006 and 20260722000010 already established, now with a written rule in spec/rls.md so the next one has something to follow.

Ten functions, not the three the task named: change_member_role, remove_member, move_story_board, split_story, move_story_to_project, copy_story_to_project, insert_board_item, create_project_state, reorder_project_state, invite_member. Two rounds of review grew that list — the advisor added the cross-project moves, /code-review added the three board/state RPCs and showed invite_member was not waitless after all (its on-conflict insert blocks on a row a concurrent remove_member is deleting), so its re-check sits after the insert where raising rolls it back.

The most valuable catch was not a bug in the code but in how it was going to be built: rebuilding these bodies from the migrations the task References point at would have silently reverted remove_member's my_work_story_state purge and split_story's duplicate-task_id rejection, because CREATE OR REPLACE needs the whole body and those files are no longer the latest definitions. Every body is taken from the live database instead, and both RLS passes diffed them to confirm nothing was dropped.

Three further classes of the same TOCTOU were closed along the way: archived_at and point_scale are re-read after the lock too (both are enforced only inside these RPCs — no policy or trigger backs them up), and the role list is hoisted into a variable in every function so the pre- and post-lock checks cannot drift apart.

Verified: 13 new integration cases that park a real RPC on the lock and revoke access mid-wait, proven non-vacuous by reverting the bodies (6 of 8 failed at the time) and by a waiter poll that fails loudly rather than passing when the RPC never parks — which is how a wrong p_direction argument was caught instead of silently testing nothing. Full web suite 1158/1158 from a clean reset, MCP 29/29, lint clean, types unchanged. rls-security-reviewer passed twice, the second time over all ten.
<!-- SECTION:FINAL_SUMMARY:END -->
