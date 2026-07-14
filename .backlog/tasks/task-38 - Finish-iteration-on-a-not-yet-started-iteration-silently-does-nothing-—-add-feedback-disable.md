---
id: TASK-38
title: >-
  Finish iteration on a not-yet-started iteration silently does nothing — add
  feedback/disable
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 05:18'
updated_date: '2026-07-14 16:05'
labels:
  - web
  - bug
  - ux
milestone: m-0
dependencies: []
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: after manually finishing iteration #1, iteration #2 is created starting TOMORROW (finalize_iteration RPC: v_next_start = end_date + 1). Pressing Finish iteration on #2 the same day hits the guard in supabase/migrations/20260709000002_finalize_iteration.sql line 80 (start_date <= today required for manual finish) and exits with no events — the button appears dead.

Fix on the UI side (kanban-board.tsx Finish dialog / board page): when the current iteration has not started yet, either disable Finish iteration with the reason shown ('Iteration #2 starts 2026-07-12 — nothing to finish yet'), or after an RPC call that returns zero events show that message instead of silence. Decide whether a not-yet-started iteration should be finishable at all (spec/velocity.md 'Manual finish') — if yes, that is an RPC change and needs /advisor review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pressing Finish iteration never results in zero visible feedback
- [x] #2 Tests cover the zero-event manual finish path
- [x] #3 Manual Finish works on a not-yet-started current iteration (skip), with confirm dialog stating what will happen
- [x] #4 Skipped iterations do not corrupt velocity (rule decided and documented in spec/velocity.md)
- [x] #5 Double-click / concurrent manual finish remains safe (no runaway iteration creation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260715000002_skip_iteration.sql: add iterations.skipped bool not null default false; DROP finalize_iteration(uuid,boolean), CREATE finalize_iteration(uuid,boolean,uuid default null). Manual finish requires p_iteration_id (raise if null). Guard: if latest.id<>p_iteration_id OR latest.state='done' return noop 'already_finished'. Skip branch: v_first manual, state<>done, start_date>today -> end_date:=start_date, skipped=true, successor starts start_date+1. Started branch unchanged.
2. spec/velocity.md: skip semantics + velocity window excludes skipped. spec/data-model.md: add skipped column.
3. actions.ts: FinalizeIterationEvent gains 'noop' kind + optional skipped on 'finalized'; notifyFinalizeEvents ignores noop; finishIteration takes iteration_id, passes p_iteration_id, returns {events}.
4. kanban-board.tsx FinishIterationButton: iterationId + iterationStartDate props, notStarted copy, noop feedback, pass iteration_id.
5. board/page.tsx + dashboard/page.tsx: exclude skipped from velocity window, select skipped. iterations/page.tsx: Skipped badge.
6. database.types.ts: patch skipped + Args.
7. Tests: skip integration test (SUPABASE_INTEGRATION), FinishIterationButton noop/future copy component tests. Apply migration locally, regen types.
8. rls-security-reviewer on migration, fable-advisor review, verification steps.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECIDED (owner, 2026-07-11): option B — a not-yet-started iteration CAN be manually finished (skipped). This changes the finalize_iteration RPC (supabase/migrations/20260709000002_finalize_iteration.sql): the manual-finish branch currently requires start_date <= today; allow finishing a future-start current iteration too. Open design points for the implementer: (1) what dates the skipped iteration keeps (end_date < start_date must not happen — consider collapsing it to a zero-length/dated-today row), (2) velocity: a skipped iteration finalizes with velocity from its accepted stories (normally 0) and will drag the running average — decide whether skipped iterations are excluded from the velocity window (spec/velocity.md update required), (3) the double-click guard the start_date check was protecting must be preserved some other way (advisory lock already serializes; re-derive the guard condition). MANDATORY: /advisor (fable-advisor) review of the RPC change before implementation. Also keep the UI half: Finish must never end in silent no-change — surface returned events or an explanatory message.

Follow spec/ux-principles.md (landed with TASK-46), especially principle 2 (every action produces visible feedback) and 6 (irreversible actions out of the primary click path). End with a fable-advisor design review before manual verification.

DESIGN (Fable, 2026-07-11 — written while Fable is available so Opus can implement without a further advisor pass; treat as the advisor-reviewed design):
1. SEMANTICS: manually finishing a not-yet-started iteration = 'skip'. It finalizes immediately: velocity = accepted sum as usual (normally 0), non-accepted stories move to the successor via the existing path.
2. DATES: the skipped iteration keeps start_date and gets end_date := start_date (its end_date currently >= start_date; no DB check constraint exists but keep dates sane). Successor starts start_date + 1 with full iteration_length.
3. NEW COLUMN: iterations.skipped boolean not null default false, set true by the RPC when it manually finalizes an iteration whose start_date > today. Velocity window (spec/velocity.md) EXCLUDES skipped iterations — a skipped 0 must not drag the average. UI shows a 'skipped' badge instead of 'velocity 0'. spec/data-model.md + spec/velocity.md updates are part of this task.
4. DOUBLE-CLICK GUARD REPLACEMENT (the start_date<=today check being removed was the guard): make manual finish target-explicit — add p_iteration_id to finalize_iteration's manual branch. The RPC finishes exactly that row iff it is still the project's latest and state <> 'done'; a second click posts the same id (now done) and returns an 'already finished' event instead of cascading into the fresh successor. Lazy (p_manual=false) path unchanged. The advisory lock stays.
5. UI: confirm dialog for a future-start iteration says what will happen ('Iteration #2 starts 2026/7/12 and hasn't begun — finishing now skips it; its stories move to #3'). Every RPC outcome renders visible feedback (ux-principles.md #2); zero-event responses show the returned reason.
6. Migration touches finalize_iteration + new column: run rls-security-reviewer; both Web and (future) iOS/MCP inherit the RPC change for free — no client-side logic.

IMPLEMENTED (2026-07-15, Opus 4.8):
- Migration 20260715000002_skip_iteration.sql: added iterations.skipped bool not null default false; dropped finalize_iteration(uuid,boolean), created finalize_iteration(uuid,boolean,uuid default null). Manual finish requires p_iteration_id (raises if null - the double-click guard). Guard returns noop 'already_finished' when p_iteration_id != latest or latest is done; 'nothing_to_finish' when no iterations. Skip branch: future-start current -> end_date:=start_date, skipped=true, successor starts start_date+1. Started branch unchanged (truncate end_date to today). Advisory lock + membership checks preserved. Migration applied locally, types regenerated (skipped + p_iteration_id present).
- spec/velocity.md: 'Skipping a not-yet-started iteration' section + velocity-window exclusion. spec/data-model.md: skipped column.
- actions.ts: FinalizeIterationEvent gains 'noop' kind + skipped flag on 'finalized'; notifyFinalizeEvents skips 'noop'; finishIteration takes iteration_id, passes p_iteration_id, returns {events}.
- kanban-board.tsx FinishIterationButton: iterationId + iterationStartDate props; future-start copy ('Skip iteration #N?', stories move to #N+1, won't count toward velocity); noop shows reason inline with a Done button instead of closing silently; real finish/skip closes+refreshes.
- board/page.tsx + dashboard/page.tsx: exclude skipped from velocity window. iterations/page.tsx: 'Skipped' badge.
- Tests: skip-iteration.integration.test.ts (SUPABASE_INTEGRATION gate) verifies skip semantics + double-click noop + no runaway creation + skipped flag, PASSED against local Supabase. kanban-board.test.tsx: added skip-copy + noop-feedback tests. Full suite 425 pass. tsc + eslint clean.
Reviews launched: rls-security-reviewer + fable-advisor (in progress).

REVIEWS DONE (2026-07-15):
- rls-security-reviewer: no blocking issues. search_path/membership checks unchanged & fail-closed; p_iteration_id cannot touch another project (v_latest is project-scoped, only produces noop); advisory lock preserved; drop+recreate correctly re-inherits EXECUTE for authenticated via default privileges (no gap window). Two informational, non-blocking, pre-existing: (a) PUBLIC EXECUTE grant on all RPCs (inert here due to fail-closed null checks; belongs to TASK-55 grant lockdown), (b) skipped column directly UPDATEable by owner/member via existing table policy, same trust boundary as velocity/state/end_date already.
- fable-advisor: 修正付き承認. Applied both fixes:
  F1 (mandatory): client notStarted used LOCAL date but RPC uses UTC -> dialog copy could contradict actual behavior across TZ boundary. Added shared utcTodayKey() to lib/utils/format.ts (UTC, matches finalize_iteration v_today); kanban-board.tsx uses it; actions.ts todayDateOnly now delegates to it (single source).
  F2 (recommended): skip dialog now names the start date via formatDate(iterationStartDate) per approved design point 5 ('Iteration #N starts YYYY/M/D and hasn't begun...'). Test asserts the date (timezone-independent via formatDate).
  Non-blocking follow-up noted by advisor (out of scope, candidate for a new task): notifyFinalizeEvents sends a normal 'iteration done velocity 0' Slack message even for skipped iterations — could tailor via event.skipped.
Post-fix: full suite 425 pass, skip integration test pass, tsc + eslint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Manually finishing a not-yet-started iteration now skips it (finalize_iteration gains iterations.skipped + p_iteration_id target guard); skipped iterations are excluded from the velocity window and shown with a Skipped badge; the Finish dialog reframes as Skip with the start date and never ends in silence (noop reason surfaced). Migration 20260715000002. Verified: skip integration test + 425 unit tests pass, tsc/eslint clean, rls-security-reviewer (no blockers) + fable-advisor (approved, F1 UTC-boundary + F2 start-date-copy fixes applied). Committed as 4099bab.
<!-- SECTION:FINAL_SUMMARY:END -->
