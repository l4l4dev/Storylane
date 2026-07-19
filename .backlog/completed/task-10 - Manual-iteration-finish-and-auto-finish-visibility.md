---
id: TASK-10
title: Manual iteration finish and auto-finish visibility
status: Done
assignee: []
created_date: '2026-07-07 14:26'
updated_date: '2026-07-09 04:35'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-9
  - TASK-18
references:
  - spec/velocity.md
  - spec/screens.md
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/velocity.md 'Manual finish' and spec/screens.md 'Board layout': add a Finish iteration button to the iteration bar (owner/member, confirmation dialog) that truncates end_date to today and runs the same shared finalization path as rollover (velocity, done, next row from tomorrow, iteration_goals adoption, carry-over). The bar always shows 'auto-finishes on <end_date>'. The current iteration goal input commits on Enter with a confirmation flash (Esc reverts) — no Save button.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Finish iteration button in the iteration bar with confirmation; reuses the shared finalization path (no second implementation)
- [x] #2 Finished-early iteration's end_date is truncated to today; next iteration starts tomorrow with full iteration_length
- [x] #3 Iteration bar always shows the auto-finish date
- [x] #4 Goal input commits on Enter with visible confirmation, Esc reverts; Save button removed
- [x] #5 Tests cover manual finish (velocity finalized, carry-over, goal adoption) and the goal commit UX
- [x] #6 Finalization RPC is advisory-locked per project and idempotent (state<>'done' guard + UNIQUE(project_id,number)); concurrent Finish/rollover cannot double-finalize or double-create the next iteration — see spec/velocity.md 'Finalization concurrency'
- [x] #7 Manual finish sets end_date = LEAST(end_date, today); lazy rollover fires for any member including viewers, manual finish requires owner/member (checked inside the SECURITY DEFINER RPC)
- [x] #8 DB trigger rejects setting stories.iteration_id to a done iteration; a test covers a drop racing a finalization
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Advisor-reviewed 2026-07-09 (approved with corrections). Migration supabase/migrations/20260709000002_finalize_iteration.sql:

finalize_iteration(p_project_id uuid, p_manual boolean) - SECURITY DEFINER plpgsql, set search_path=public.
- perform pg_advisory_xact_lock(hashtext(iteration_finalize: || p_project_id::text)) first (namespaced key, matches stories_number lock precedent).
- permission check inside: p_manual true requires project_role in (owner,member); p_manual false requires is_project_member (viewers included, lazy rollover).
- v_today := (now() at time zone utc)::date computed inside the RPC, never a parameter (prevents forced future-dating).
- loop: latest = newest iteration row by number.
  - latest is null -> create #1 starting v_today, record a started event, done.
  - latest.state <> done and latest.end_date >= v_today -> loop ends (this is the fixed exit condition - NOT the old TS isCurrentIteration date-window check, since a manually-finished iterations next row starts tomorrow and would never be "current" today, which caused the mirrored-loop bug the advisor flagged).
  - otherwise: if p_manual and this is the first loop iteration, set end_date = least(end_date, v_today) first; then finalize unconditionally: velocity = sum of points for accepted, story_type in (feature,bug) stories on that iteration; UPDATE ... SET state=done, velocity=... WHERE id=... AND state<>done (idempotent guard); record a finalized event; carry non-accepted stories iteration_id to the new row (same transaction); insert next row (number+1, dates continuing from old end_date, iteration_length days), adopting+deleting any iteration_goals row for that number; record a started event. No 23505 retry handler - the advisory lock makes it unreachable, constraint stays as a backstop only.
- returns an ordered jsonb array of events (empty = nothing happened), consumed by the TS wrapper to fire Slack in order.
- grants: revoke execute from public, grant execute to authenticated (invite_member/20260709000001 style).

Second migration or same file: trigger on stories - before insert (when new.iteration_id is not null) / before update (when new.iteration_id is distinct from old.iteration_id) - reject if the target iteration state=done, fixed error message the TS layer maps to the existing "finalized iteration" copy. Scoped to changed iteration_id only, so normal edits to an accepted storys other fields (still sitting on a done iteration) are unaffected.

TS (apps/web/app/projects/[id]/board/actions.ts): ensureCurrentIteration keeps its name/call sites, internals become: cheap pre-check (latest non-done and end_date >= today -> skip, avoids locking on every page load) -> supabase.rpc(finalize_iteration, { p_project_id: projectId, p_manual: false }) -> replay returned events, firing the existing iterationDoneMessage/iterationStartedMessage via after() per event in order. New finishIteration(formData) action: same RPC with p_manual: true, revalidates board + project home, treats an empty event array (double-click / already finished) as a non-error.

UI (kanban-board.tsx iteration bar): replace the Save-button form with an Enter-commit/Esc-revert goal input (same pattern as board-list-view.tsxs IterationGoalInput, calling updateIterationGoal) plus a brief "Saved check" confirmation matching story-detail-panel.tsxs autosave-status convention. Add "auto-finishes on <end_date>" text (always shown) and a Finish iteration button (owner/member only client-side, enforced server-side by the RPC) with a confirmation dialog before calling finishIteration.

Tests: (a) velocity parity - a vitest case computing acceptedPoints() in TS for a fixed story set, cross-checked against the RPCs SQL sum via a direct DB query with the same fixture data (not formal spec/fixtures/ golden-fixture infra - decision-1s cross-client fixture harness is an iOS-phase setup cost, out of scope here); (b) two concurrent finalize_iteration calls (finish vs lazy rollover racing) do not double-finalize or double-insert; (c) a drop racing a finalization is rejected by the trigger; (d) regression test for the exit-condition bug - calling the RPC again right after a manual finish (next row starts tomorrow, not covering today) is a no-op; (e) goal input Enter-commit/Esc-revert/confirmation UX test mirroring the existing IterationGoalInput coverage style.

Verify: rls-security-reviewer pass (new RPC + trigger), full vitest, live browser check of Finish button + goal input.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two critical security bugs found and fixed during this task (rls-security-reviewer, 2026-07-09):

1. finalize_iteration manual-finish permission check used "project_role(...) not in (owner,member)". project_role() returns SQL NULL (not false) for a caller with zero project_members row - a true outsider, not a viewer. NULL not in (...) evaluates to NULL, which plpgsql if treats as false, silently skipping the raise exception. Any authenticated user could force-finish/mutate any project iteration via finalize_iteration(foreign_project_id, true). Fixed with coalesce(project_role(...), ) not in (owner,member) in 20260709000002_finalize_iteration.sql. Independently reproduced the bug and reverified the fix myself (outsider rejected, owner/member still succeed) before and after, in addition to the reviewers own reproduction.

2. Same defect pattern found by the reviewer in the pre-existing invite_member RPC (20260630000001_member_management.sql, from Task 4 - unrelated to this tasks scope but same severity class): project_role(...) <> owner has the identical NULL-bypass, letting any authenticated user self-invite as owner of any project. Confirmed with the user this was worth fixing immediately given severity (pre-production). Fixed in new migration 20260709000003_fix_invite_member_null_role_bypass.sql with the same coalesce guard. Independently reproduced (outsider self-invited as owner of a project they had zero relationship to) and reverified the fix.

A second rls-security-reviewer pass confirmed: both coalesce fixes are exhaustively correct against every possible project_role() return value (owner/member/viewer/NULL - the only four possible outcomes given the roles NOT NULL CHECK constraint), grepped the whole supabase/migrations tree and found no third instance of this project_role(...) <>/not in pattern, and confirmed both migrations DOWN blocks correctly (if unfortunately, by definition of rollback) restore the prior buggy behavior.

Separately found and fixed a real (non-security) bug this task exposed: board/page.tsx picked the "current" iteration via isCurrentIteration (start_date <= today <= end_date). Before Task 10 this always worked because automatic rollover only ever fired on an iteration whose end_date had already passed, so the successor immediately covered today. Manual finish is new: it truncates end_date to today and the successor starts tomorrow, so for the rest of finish-day no iteration satisfied that date-range check and the board showed no iteration bar at all - reproduced live in the browser. Fixed by changing the selection to "the newest non-done iteration" (matching finalize_iterations own definition of current), which needs no date-range check at all. isCurrentIteration, and the now-dead nextIterationDates/nextIterationNumber (logic moved into the RPC), were removed from lib/utils/iterations.ts along with their tests - genuinely unused after this change, not kept as parity references (unlike acceptedPoints, kept and cross-checked against the RPCs SQL sum since velocity math is the one place decision-1 flagged for parity risk).

Incident during this task (unrelated to the code, disclosed to the owner directly): a background rls-security-reviewer agent dispatched for the earlier TASK-18 review ran supabase db reset on its own initiative while verifying that migration, which wiped local dev data including a pre-existing project outside this session. Not caught until TASK-10 live verification. No data recoverable (local dev DB only). Follow-up agent invocations for this task were explicitly instructed not to run db reset or any other destructive command, and complied (read-only/additive-only verification, self-cleaned).

Verification: tsc/eslint/full vitest all clean (213 tests). Extensive direct-SQL RPC verification (throwaway users/projects, auth.uid() simulated via set_config, all cleaned up after each round): fresh-project creation, idempotent no-op, overdue rollover with correct velocity (accepted feature/bug points only, chore/release excluded)/carry-over (non-accepted stories move, accepted stay)/goal adoption+cleanup, manual finish truncating end_date and starting the next iteration tomorrow, a genuine concurrent race (two simultaneous backgrounded calls, one lazy one manual, racing the same overdue project) that serialized correctly via the advisory lock with no duplicate/corrupted rows, the double-click manual-finish regression (must not corrupt a not-yet-started successors end_date), viewer-allowed-lazy/viewer-rejected-manual/outsider-rejected-both permission checks, the done-iteration assignment trigger (blocks direct reassignment, does not block unrelated edits to an accepted story still on its done iteration), and the iteration_goals number-guard under the new shared lock key. Live browser verification: Finish iteration button + confirmation dialog, goal input Enter-commit + Saved confirmation + Esc-revert + error-on-failure, auto-finishes-on text, and the current-iteration-selection fix, all against a real project end to end.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Iteration finalization (rollover and manual finish) now shares one advisory-locked, idempotent SECURITY DEFINER RPC (finalize_iteration, 20260709000002_finalize_iteration.sql) instead of an unlocked TS loop - the deliverable decision-1 calls for, callable identically from iOS later. The iteration bar gets a Finish iteration button (owner/member, confirmation dialog), an always-shown "auto-finishes on <date>" line, and an Enter-commit/Esc-revert goal input with a Saved confirmation flash, replacing the old Save-button form. A DB trigger now rejects setting stories.iteration_id to a done iteration, closing the TOCTOU gap between a drag and a concurrent finalization.

Found and fixed two critical pre-existing-pattern security bugs along the way (see notes): a NULL-bypass in the new RPCs manual-finish permission check, and the identical defect in the older invite_member RPC, which let any authenticated user self-invite as owner of any project. Both independently reproduced and reverified fixed, with a second reviewer pass confirming no other instances exist. Also fixed a real UX bug this task exposed: the boards current-iteration selection assumed a fresh iteration always covers today, which manual finish breaks (successor starts tomorrow) - now selects the newest non-done row instead.
<!-- SECTION:FINAL_SUMMARY:END -->
