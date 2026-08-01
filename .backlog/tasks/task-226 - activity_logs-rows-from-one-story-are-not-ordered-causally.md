---
id: TASK-226
title: activity_logs rows from one story are not ordered causally
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-08-01 10:08'
updated_date: '2026-08-01 10:08'
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
- [ ] #1 A decision is recorded on clock_timestamp() vs a sequence column, naming what each costs existing activity_logs readers
- [ ] #2 Two concurrent re-estimates of one story that serialize opposite to their transaction start order are read back in the order they actually applied
- [ ] #3 buildBurndown orders point transitions by the causal key rather than created_at
- [ ] #4 An integration test reproduces the inverted-serialization case against a real database, not a hand-fed log array
- [ ] #5 Existing activity_logs readers (activity feed, story history, burndown) are checked against the change
<!-- AC:END -->
