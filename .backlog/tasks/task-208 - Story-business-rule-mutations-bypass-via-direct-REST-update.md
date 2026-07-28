---
id: TASK-208
title: Story business-rule mutations bypass via direct REST update
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
updated_date: '2026-07-28 05:04'
labels: []
milestone: m-2
dependencies: []
references:
  - supabase/migrations/20260630000002_grants.sql
  - supabase/migrations/20260719000002_relax_stories_write_rls.sql
  - >-
    supabase/migrations/20260724061745_epic_story_unification_set_story_state_container_guard.sql
priority: high
type: bug
ordinal: 1100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
stories UPDATE RLS (20260719000002_relax_stories_write_rls.sql) allows any project member to update any column via PostgREST directly, while the estimation gate, current-iteration auto-assign, and container guard are only enforced inside the set_story_state RPC. A direct .from("stories").update() call (from the web client, MCP, or any REST caller) bypasses all three invariants — verified locally: an unestimated feature can be set to done with iteration_id = NULL. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An unestimated feature cannot be moved to a started/done category state via a direct table update, only via set_story_state
- [x] #2 A container's state_id still cannot be set to non-NULL via any write path
- [x] #3 Existing RPC-driven flows (set_story_state, move_story_board, update_story) keep passing their current tests unchanged
- [x] #4 A story cannot enter an in_progress-category state with iteration_id NULL via any write path; the sanctioned RPCs keep doing the auto-assign themselves
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Findings first (all verified against the live local DB, not assumed):
- AC #3 is ALREADY enforced at DB level by the stories_container_off_board_check CHECK (NOT is_container OR (points/state_id/iteration_id all NULL)). set_story_state's guard only improves the message. Verify empirically, then check the AC without new code.
- completed_at is already trigger-maintained (maintain_story_completed_at, BEFORE INSERT/UPDATE), so it is write-path-agnostic today. ARCHITECTURE.md's wording ('maintained by the single set_story_state write path') is stale but the behaviour is fine.
- Real gaps are AC #1 (estimation gate) and AC #2 (current-iteration auto-assign): both live only in set_story_state, plus a second client-side copy of the gate in kanban.ts evaluateDrop for board drags. move_story_board writes state_id directly and enforces neither.

Plan: one migration adding a BEFORE INSERT OR UPDATE trigger on stories that owns both invariants, so every write path inherits them.
1. Early-exit when state_id and iteration_id are both unchanged (the maintain_story_completed_at idiom) so ordinary title/points edits pay nothing.
2. Read projects.is_personal and skip both gates for personal projects — set_story_state already exempts them (doc-15) and the trigger must not diverge.
3. Estimation gate: story_type='feature' AND points IS NULL AND new state's category <> 'unstarted' -> raise, reusing set_story_state's exact message and errcode.
4. Auto-assign: new state's category='in_progress' AND new.iteration_id IS NULL -> take pg_advisory_xact_lock('iteration_finalize:'||project_id), resolve the latest non-done iteration, assign it; raise 'No active iteration' if none. Same lock key set_story_state and move_story_board already use, so a nested take inside their transaction is re-entrant, not a new deadlock edge.
5. Trigger NAME must sort before stories_reject_done_iteration_update, since Postgres fires BEFORE triggers alphabetically and that one has to see the iteration_id this trigger may assign. Follow the existing stories_aa_protect_epic_pinned prefix convention.
6. Then delete the now-duplicated gate/auto-assign blocks from set_story_state, or keep them? Decide with the advisor — keeping both means two copies of one rule (the drift this task exists to fix), removing them means the RPC's friendlier errors come from the trigger instead.

Known blast radius to confirm before implementing: triggers fire for the service role too (unlike RLS), so integration tests that seed a done/started state with a direct admin update on an unestimated feature will start failing — slack-notifications-outbox (3 sites), my-work-data-model (5 sites). Those are the tests proving the fix works, so they get estimated stories or move to the RPC; this is expected churn, not a regression.

Verification: new integration test asserting each AC through a direct .from('stories').update() as a member (must fail before the migration, pass after), plus the full existing suite with SUPABASE_INTEGRATION=1 for AC #4, plus rls-security-reviewer per CLAUDE.md's migration rule.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Empirical baseline, measured against the live local DB before writing any fix. Ran as a superuser inside a transaction ending in ROLLBACK (no rows survived); RLS was not the variable under test since 20260719000002's policy is unconditional for members on every column, so the only question was whether any trigger or constraint stops the write.

AC #1 — BYPASSED, confirmed. A plain UPDATE moved an unestimated feature (points NULL, story_type 'feature') from an unstarted state straight into a done-category state. Worse than the task description implies: maintain_story_completed_at then stamped completed_at, so the story is indistinguishable from legitimately-finished work and counts toward velocity. The same move through set_story_state correctly raised 'An unestimated feature can only be in the Icebox or an unstarted state'.

AC #2 — BYPASSED, confirmed. A plain UPDATE into an in_progress-category state left iteration_id NULL. set_story_state on the same transition auto-assigned the current iteration as designed.

AC #3 — ALREADY ENFORCED, no code needed. A plain UPDATE setting a container's state_id was rejected by CHECK stories_container_off_board_check ('new row for relation stories violates check constraint'). set_story_state's guard only substitutes the friendlier doc-18 §4 message. So AC #3 is satisfied by the existing schema on every write path; it needs a regression test asserting that, not a new mechanism.

Net: the fix has to close two gaps (#1, #2), not three.

fable-advisor verdict: APPROVED WITH CORRECTIONS. Direction (invariants belong in the DB) matches decision-1 principle 2 and the existing trigger patterns, but the plan as drafted had a real bug and would have worsened a known weakness.

CRITICAL, and independently confirmed empirically before accepting it: my early-exit condition was 'skip when state_id AND iteration_id are both unchanged'. finalize_iteration's rollover UPDATE changes ONLY iteration_id, leaving state_id alone, so it would fall through to the gate. If any rolled-over story is 'in_progress category with points NULL', the gate raises and the whole finalize_iteration RPC fails. I verified that row shape is reachable through sanctioned paths, not just the bypass: started an estimated feature via set_story_state, then cleared its estimate via the update_story RPC (which applies no state-based gate to points — passing p_points NULL falls through its scale check to v_points := null), giving category=in_progress with points=NULL; a rollover-shaped UPDATE over that row succeeds today. So the planned trigger would have broken sprint rollover in production for any project where someone un-estimated a started story. FIX: gate on CATEGORY TRANSITION (old category -> new category), never on raw column equality.

Owner decisions taken on the advisor's two escalations:
- AC #2 relaxed to reject-only (was: auto-assign on every write path). The trigger now requires iteration_id to already be set when entering an in_progress category, and the sanctioned RPCs keep performing the assignment. This removes pg_advisory_xact_lock and the duplicated current-iteration resolution from the trigger entirely, which is where the concurrency risk lived. Every legitimate path (set_story_state, move_story_board, MCP) already writes with the iteration resolved, so behaviour is unchanged for them. AC text updated accordingly.
- Ordering: implement TASK-208 first WITHOUT creating an ordering dependency, rather than waiting for TASK-195's trigger-order hardening. Verified this is achievable: reject-only means the trigger never writes NEW, and I confirmed by reading all BEFORE trigger bodies on stories (protect_stories_epic_pinned, derive_is_container, enforce_single_level_nesting, pin_story_number, maintain_story_completed_at, reject_done_iteration_assignment, set_updated_at, assign_story_number) that NONE of them writes NEW.state_id or NEW.iteration_id. So no BEFORE trigger can change what this one reads, and its firing position is irrelevant. The advisor's re-examination of my own stated premise was correct: the 'must run before stories_reject_done_iteration_update' requirement did not actually exist.

Also accepted: cover INSERT as well as UPDATE (the rule belongs to the row shape, like stories_container_off_board_check); delete the now-duplicated gate blocks from set_story_state rather than keeping two copies (TASK-195 already flags SQL duplication in this migration family twice); keep kanban.ts evaluateDrop's copy, which is legitimate per-client pure logic under decision-1 principle 4, not DB-logic duplication.

Migration written and verified with a 12-case probe against the live DB (all inside a transaction ending in ROLLBACK). 4 cases must be rejected, 8 must still succeed; all 12 behaved correctly.

Rejected as intended: unestimated feature -> done by direct UPDATE; estimated feature -> in_progress with iteration_id NULL; clearing iteration_id on a story already in_progress; and an INSERT creating an unestimated feature straight into a done state.

That third case is a hole the original plan would have left open: gating only on category transition lets a direct update strip iteration_id from a story already sitting in_progress, since its category never moves. The iteration gate therefore fires when the category moves OR iteration_id changes, while the estimation gate fires only when the category moves. Splitting the two conditions is what satisfies both requirements at once — the advisor's finalize_iteration regression needs the estimation gate to ignore iteration-only writes, and this hole needs the iteration gate to notice them.

Still succeeding: the advisor's regression case (rollover of an in_progress story whose estimate was later cleared) moves to the next iteration cleanly; personal-project exemption; unestimated bug reaching done (the gate is feature-only, matching set_story_state); in_progress -> Icebox -> backlog; a plain title edit on an in_progress+points-NULL story; a move between two states sharing the in_progress category; set_story_state end to end; and set_story_state's auto-assign still filling a NULL iteration.

Second migration (20260728040200) removes set_story_state's own copy of the estimation gate, since the trigger now raises the identical message and errcode. Auto-assign and the container guard stay in the RPC by design: the trigger is reject-only so the RPC is still what resolves the iteration, and the container guard only substitutes doc-18 §4's message for the raw CHECK error. Re-ran the full 12-case probe after this change with identical results.

One deliberate behaviour change, measured not assumed: for a story that is BOTH unestimated AND in a project with no active iteration, set_story_state now reports 'No active iteration' where it previously reported the estimation error, because the auto-assign block now runs before the trigger fires. Both messages are accurate and the combination requires a project with no active iteration at all (lazy rollover normally guarantees one). Accepted rather than reintroducing the duplicate gate TASK-195 flags.

rls-security-reviewer pass (required by CLAUDE.md for migrations): NO BLOCKING ISSUES. The reviewer verified empirically rather than by inspection — applied all three migrations from a clean reset, ran 43 tests across the affected suites, and queried public._grant_audit() directly to confirm grant state.

Answers on the five points raised: (1) SECURITY DEFINER + set search_path = public matches maintain_story_completed_at's pattern, and the REVOKE closes the only vector that needs closing — Postgres does not check invoker EXECUTE for trigger dispatch, so the revoke exists purely to block a direct RPC call, which _grant_audit confirms is now blocked for anon and authenticated. (2) CREATE OR REPLACE preserves grants because they attach to the function identity, not the statement; confirmed post-reset that set_story_state remains authenticated-executable and finish_story_from_git remains service-role-only, matching their pre-migration state, and matching how 20260722000008/20260724061745 already replaced set_story_state without regranting. (3) No escalation or disclosure: the trigger only fires on a write that already passed stories' RLS, so the caller is necessarily a member, and project_states/projects SELECT RLS are scoped to that same membership — the SECURITY DEFINER lookups return nothing the caller could not already read. Error messages carry no row values. (4) No policy or table grant is touched; RLS is still evaluated independently. (5) All three DOWN comments verified accurate by diffing against the named restore files.

One non-blocking observation to settle with the owner: the trigger does not enforce 'Icebox (state_id NULL) never carries iteration_id'. A direct update setting state_id to NULL while leaving a stale iteration_id would pass silently; only set_story_state's own UPDATE forces iteration_id to NULL when clearing the state. This gap predates the migration and sits outside both ACs, so it is not a regression introduced here.

Note on process: the reviewer ran supabase db reset against the shared local DB to verify a clean apply. That wiped local dev data (projects back to 1, stories to 0). Migrations re-applied cleanly and the full web suite still passes 1136/1136 afterwards, so nothing is broken, but the wipe was not pre-authorised.

/code-review high returned 5 findings. Each was reproduced independently against the live DB before acting on it, rather than taken on the reviewer's word; all three substantive ones confirmed.

#1 HIGH, FIXED — a regression this task introduced. Merging a PR that references a never-estimated feature made finish_story_from_git raise instead of returning a result, and git-webhook converts any RPC error into a 500, so the provider redelivers a merge that can never succeed and every later story number in the same push is skipped. Reproduced: 'RPC RAISED: An unestimated feature can only be...'. Fixed by adding an 'unestimated' reason to the function's existing ignored vocabulary (alongside not_configured / target_state_invalid / no_active_iteration). Scoped to a non-unstarted target, since merge_target_state_id may legitimately point at an unstarted state, which stays open to unestimated work — the reviewer's suggested fix would have declined those too. Now returns {kind:'ignored', reason:'unestimated'} and leaves the story untouched.

#2 MEDIUM, FIXED — gating the estimation rule on category movement alone left the exact end state AC #1 forbids reachable in two writes: estimate, move to done, clear the estimate. Reproduced: the story rested in done with points NULL and completed_at still stamped, i.e. counting toward velocity. The gate now also fires when points change on a row already in a done/rejected category. Deliberately NOT extended to in_progress: that shape has to stay legal or finalize_iteration's rollover raises, which is the advisor's original finding. Both halves are now pinned by tests — one asserting the done case is rejected, one asserting the in_progress case is still allowed.

#3 MEDIUM, DOCUMENTED (owner decision) — stories.iteration_id is ON DELETE SET NULL, so deleting an iteration with in_progress stories now fails. Reproduced. No path deletes iterations today and project deletion is unaffected (the stories cascade runs first). Recorded in the migration header as a deliberate hard failure: silently orphaning in_progress work off the board is what the gate exists to prevent, so a future iteration-delete feature must clear those stories rather than lean on the FK action.

#4 LOW — the error-order change was already recorded above; the reviewer confirmed nothing in apps/web keys off the message text.

#5 LOW, ADDRESSED (owner decision) — the trigger is forward-only and does not repair rows the pre-fix bypass already created. Added a detection query to the migration header so the owner can check production for both bad shapes; no automatic repair, since the right correction depends on the data.

Re-verified after the fixes: the 12-case probe still behaves identically (including the rollover regression case), full web suite 1139/1139 from a clean supabase db reset (up from 1136 — three new regression tests for findings #1 and #2), MCP 29/29, lint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the two board invariants that only set_story_state enforced into a DB trigger, so a direct PostgREST update can no longer reach a done state on an unestimated feature (which also stamped completed_at and counted toward velocity) or leave an in_progress story with no iteration. AC #2 needed no code — stories_container_off_board_check already covered it on every path — and now has a regression test saying so.

Three migrations: the new BEFORE INSERT OR UPDATE trigger (reject-only, no advisory lock, no NEW writes, so no firing-order dependency and no conflict with TASK-195); set_story_state losing its now-duplicated estimation gate; and finish_story_from_git merging its two writes into one, since writing state_id before iteration_id left exactly the transient row shape its own comment said must never exist.

Two review passes each caught a real defect that testing alone would not have. fable-advisor: gating on raw column equality would have made finalize_iteration's rollover raise for any project holding an in_progress story whose estimate was later cleared. /code-review high: the merged git write turned a merged PR for an unestimated story into a permanently-failing webhook redelivery, and gating on category movement alone still allowed the forbidden end state in two writes (estimate, move to done, clear estimate). Both fixed and pinned by tests. The gates now key off different changes — estimation on category movement or an estimate cleared inside done/rejected, iteration on category or iteration_id movement — which is what satisfies the rollover constraint and the two bypasses simultaneously.

Verified: full web suite 1139/1139 from a clean supabase db reset (was 1127; the new cases fail 4-of-9 with the trigger disabled, so they are not vacuous), MCP 29/29, lint clean, plus a 12-case DB-level probe re-run after every change. rls-security-reviewer: no blocking issues, verified empirically including a _grant_audit query. The repo's own grant-lockdown suite caught a missing REVOKE on the new SECURITY DEFINER function before either review ran.
<!-- SECTION:FINAL_SUMMARY:END -->
