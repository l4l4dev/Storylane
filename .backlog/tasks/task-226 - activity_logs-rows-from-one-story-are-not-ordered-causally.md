---
id: TASK-226
title: activity_logs rows from one story are not ordered causally
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-08-01 10:08'
updated_date: '2026-08-03 01:58'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/lib/utils/burndown.ts
  - supabase/migrations/20260627000006_comments_activity.sql
  - 'https://github.com/l4l4dev/Storylane/pull/18#discussion_r3695387971'
priority: medium
ordinal: 1425
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
activity_logs.created_at defaults to now(), which is TRANSACTION START time, and id is gen_random_uuid(). Neither is causal, so rows written by different transactions touching the same story can be read back in an order that never happened.

Concrete case (Codex review, PR #18): two members re-estimate the same story concurrently. Both transactions start, then serialize on the story row lock. If the one that STARTED later commits first, its log row still carries the earlier created_at, so it sorts before the row that actually landed after it. buildBurndown (apps/web/lib/utils/burndown.ts) rewinds and replays point transitions in that order, so a chart can end a day on an estimate that was never current.

The same non-causality already bit the multi-hop rollover case: one finalize_iteration call reparents a story through several iterations and stamps every row with the same now(). That one was worked around in the reader — storiesByTouchedIteration and the membership replay only read logs naming the charted iteration, so the hops never need ordering. Points have no equivalent escape: their transitions are inherently sequential, so the reader cannot dodge it and the ordering has to come from the data.

Two candidate fixes, both touching a shared audit table: switch activity_logs.created_at to clock_timestamp() (execution time rather than transaction start — changes the meaning of an existing column for every reader), or add a monotonic sequence column and order by it. Decide which before implementing; the second is additive and safer for existing readers, the first needs no read-path changes.

Deliberately NOT folded into PR #18: that branch is a burndown fix, and this is a schema-wide semantic change that deserves its own review. Deferred with the owner acknowledging the trade-off.

Either fix is a migration, so it needs the rls-security-reviewer pass on top of the usual review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision is recorded on clock_timestamp() vs a sequence column, naming what each costs existing activity_logs readers
- [x] #2 Two concurrent re-estimates of one story that serialize opposite to their transaction start order are read back in the order they actually applied
- [x] #3 buildBurndown orders point transitions by the causal key rather than created_at
- [x] #4 An integration test reproduces the inverted-serialization case against a real database, not a hand-fed log array
- [x] #5 Existing activity_logs readers (activity feed, story history, burndown) are checked against the change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration: alter table public.activity_logs alter column created_at set default clock_timestamp(). No backfill; existing rows keep their now() values. Header comment carries the AC#1 decision record — why clock_timestamp() over a sequence column, what each costs readers, that READ COMMITTED is a premise of the causality guarantee, and that an NTP step is an accepted residual risk.

2. apps/web/app/stories/[id]/actions.ts: add .order("id", {ascending:false}) after the created_at order. It is the only reader with no tiebreaker, so its limit(50) boundary is non-deterministic on ties today.

3. Integration test reproducing inverted serialization against the real DB: two connections, the one that STARTS later takes the story row lock first and commits first. Assert the two activity_logs rows read back in commit order. Reuse the two-connection blocking pattern from finalize-iteration-role-recheck.integration.test.ts.

4. No change to buildBurndown — created_at becomes the causal key, so AC#3 is satisfied by the migration itself.

5. Do NOT touch POINTS_HISTORY_FROM: it gates whether points history EXISTS, not whether its order is trustworthy; moving it would drop unrelated charts to partial.

6. rls-security-reviewer pass before proposing the commit, even though no table or policy changes — the task requires it for any migration.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#3 needs no buildBurndown change under the chosen approach: created_at itself becomes the causal key, so the existing .order("created_at") in the iterations page and the createdAt sort inside buildBurndown are already ordering by it. Recording this so the unchanged reader is not read as an oversight during review.

Verification: both integration cases were run against the real DB with the default flipped back to now() and they fail there (inverted chains [5->8, 1->5] and [3->13, 1->3]), then pass with clock_timestamp(). The 8 other integration suites that touch activity_logs (107 tests) pass unchanged.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Changed activity_logs.created_at to default clock_timestamp() instead of now(), so rows are stamped at execution time and two writes contending on the same story row are ordered by when they applied rather than by when their transactions began. One statement; no backfill, no read-path change, existing rows keep their now() values.

Decision (AC#1) lives in the migration header rather than a Backlog doc, matching how the other activity_logs migrations record intent. A monotonic sequence column was rejected there: nextval is also drawn at INSERT execution time, so it buys monotonicity under a clock step but not causality, and it would cost a backfill plus a switch in all three readers. READ COMMITTED is documented as a premise, since a future RPC adopting SERIALIZABLE with retries would break the guarantee silently.

buildBurndown needed no change (AC#3) — created_at itself became the causal key. Its comment justifying why iteration hops are dropped did need one: that reasoning rested on same-transaction rows sharing now(), which is no longer true for new rows. The behaviour is conservative either way, but the recorded reason would have misled. story-detail history also gained the id tiebreak the other two readers already had.

Verified: both integration cases fail with the default flipped back to now() (chains invert to [5->8, 1->5] and [3->13, 1->3]) and pass with clock_timestamp(); the blocked-writer case was additionally checked to fail loudly rather than pass vacuously when nothing blocks. 901 unit tests, 107 tests across the 8 integration suites touching activity_logs, lint and tsc clean. fable-advisor approved with three corrections (all applied), rls-security-reviewer clean, /code-review high raised six findings (one medium, five low) all addressed.
<!-- SECTION:FINAL_SUMMARY:END -->
