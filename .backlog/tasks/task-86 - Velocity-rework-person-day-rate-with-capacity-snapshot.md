---
id: TASK-86
title: 'Velocity rework: person-day rate with capacity snapshot'
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
updated_date: '2026-07-20 03:40'
labels:
  - web
  - db
milestone: m-5
dependencies:
  - TASK-85
  - TASK-91
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §7 with advisor corrections. Add iterations.capacity (person-days), written once by the finalization RPC (frozen at finalize time; later member/calendar changes never rewrite history). Rate = sum of accepted points / sum of capacity over the last velocity_window non-skipped capacity>0 done iterations (ratio of sums, not average of ratios). Forecast and backlog virtual-group computation change from max(velocity,1) points per group to rate x planned capacity per future sprint. Planned capacity of future sprints derives from the calendar (TASK-85) including personal time off (team-strength compensation). This math is a per-client pure function (web now, iOS later): produce shared golden fixtures covering weekday defaults, project exceptions, personal time off, member joins, capacity-0 sprints, and cadence changes. Update the Slack finalize message wording where it reports velocity (absorbs the TASK-62 re-check).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Finalization writes capacity once; re-finalization or later calendar edits cannot change a done iterations capacity (test proves it)
- [x] #2 Rate excludes skipped and capacity-0 iterations; zero-division impossible (test with empty 1-day catch-up rows)
- [x] #3 Virtual groups and auto-planning use rate x planned capacity; golden fixtures shared and passing
- [x] #4 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ADVISOR-APPROVED WITH CORRECTIONS (fable-advisor, 2026-07-20). Verdicts: (a) both SQL and TS implementations, cross-checked against ONE shared fixture — same pattern as spec/fixtures/state-templates.json, which both packages/core/src/story-state.test.ts and a DB integration test already assert against. Passing a client-computed capacity into the RPC is rejected: finalize_iteration is the single finalization path reached by lazy rollover from any client and from Edge Functions, so the invariant must live in the DB. (b) NO backfill — fabricating past capacity from today's membership is the retroactive recomputation doc-8 §7 forbids; the empty window is absorbed by the existing 'minimum 1 point per group' fallback. (c) iterations.velocity keeps its name and its done-category point-sum meaning; the rate's numerator is the SUM OF SNAPSHOTTED velocity values, never a re-aggregation of stories (that would let editing a story's points move finished history).

1. Migration: alter table iterations add column capacity numeric (nullable, no default — the capacity>0 window filter excludes NULL and 0 alike). Existing iterations RLS covers it; still run rls-security-reviewer.
2. New SQL function project_capacity(p_project_id, p_start, p_end) returns numeric — SECURITY INVOKER, called from finalize_iteration. working_weekdays (deduped as a set) + project_calendar_exceptions - user_time_off, over ALL current project_members. NO joined_at proration: doc-8 §7 means 'the member set at finalize time x every working day of the sprint', matching the snapshot-at-that-moment philosophy. Split out as its own function so fixtures can call it directly instead of assembling a whole finalize.
3. CRITICAL (AC#2): the catch-up loop inserts a new iteration and re-reads it as v_latest, so a neglected project generates AND finalizes a chain of empty gap rows in ONE call (verified in 20260719000010 lines 115-150). Only the v_first pass writes a real capacity; every later pass writes capacity = 0. Otherwise gap rows enter the window with capacity>0 and points 0 and crush the rate. This is what AC#2's 'empty 1-day catch-up rows' means.
4. Capacity must be computed from v_latest.end_date AFTER the manual-finish truncation (end_date = least(end_date, today), lines 77-89) — pin this with a test.
5. packages/core: replace calculateVelocity with ratio-of-sums rate over the last velocity_window non-skipped, capacity>0 done iterations; empty window returns 0. Keep clampVelocityWindow.
6. New pure calendar/capacity function in packages/core + spec/fixtures/capacity.json covering weekday defaults, holiday, extra_workday, personal time off, differing member sets, capacity-0, cadence change, and a DUPLICATE weekday entry (TASK-85's CHECK cannot reject repeats, so both implementations must treat the array as a set).
7. Update ALL consumers, not just the board: apps/web/app/dashboard/actions.ts, dashboard/page.tsx, projects/[id]/settings/actions.ts and their tests. Dashboard velocity display becomes points-per-person-day. Virtual groups use rate x planned capacity, keeping the minimum-1-point fallback.
8. Add capacity to the 'finalized' event jsonb; update the Slack finalize wording (absorbs TASK-62).
9. Tests cover three finalize paths: with capacity, capacity=0 gap row, and skipped. Full suite from apps/web (AC#4).

KNOWN TEMPORARY REGRESSION (accepted, no backfill): every already-finalized iteration has NULL capacity, so until velocity_window new iterations finalize, the rate window is empty and forecasting uses the minimum-1-point fallback.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
rls-security-reviewer pass 2026-07-20 on 20260720000002_iteration_capacity.sql: HIGH finding — the finalized-metric trigger only fires on OLD.state='done', so a member can set state='done' + forged velocity/capacity in ONE update (empirically reproduced); fix = revoke update (state, velocity, capacity) on iterations from authenticated (finalize_iteration is postgres-owned SECURITY DEFINER, unaffected). LOW/info: project_capacity's SECURITY INVOKER is inert (both callers bypass RLS) — needs a grant-dependency comment. Merge held per review-hold policy; awaiting owner decision.

Fix applied 2026-07-20 (commit d02f751): table-level UPDATE revoked from authenticated, update(goal) granted back; one-shot forge test added. rls-security-reviewer re-pass: CLEAN — bypass empirically confirmed closed, goal path and DEFINER RPCs unaffected. Integration 49/49 serial, unit 474 passed, lint clean.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 03:19
---
Dep added (advisor 2nd pass): the finalize RPC and rate formula must be built on category=done from the start (TASK-91), not accepted-literals, to avoid rebuilding it twice.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Person-day velocity: iterations.capacity snapshotted once by finalize_iteration, rate = ratio of sums via packages/core with shared golden fixtures (spec/fixtures/capacity.json), planning uses rate x planned capacity. Verified by integration + unit suites and two rls-security-reviewer passes (HIGH forge finding found and fixed via column grant).
<!-- SECTION:FINAL_SUMMARY:END -->
