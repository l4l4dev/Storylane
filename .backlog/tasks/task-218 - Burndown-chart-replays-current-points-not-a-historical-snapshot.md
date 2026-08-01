---
id: TASK-218
title: 'Burndown chart replays current points, not a historical snapshot'
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 15:43'
updated_date: '2026-08-01 05:20'
labels:
  - tooling
milestone: m-2
dependencies: []
references:
  - apps/web/lib/utils/burndown.ts
  - supabase/migrations/20260727140000_generalize_iteration_change_log.sql
priority: high
ordinal: 2150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by Codex's review of PR #6 (TASK-207): buildBurndown (apps/web/lib/utils/burndown.ts) builds pointsByStory once from each story's CURRENT stories.points and applies that same value to every day in the chart. If a story is re-estimated mid-iteration or after it's finalized, the new points value silently rewrites every day's remaining-points total for that sprint, including already-reported/finalized history.

This is the same class of bug as the state-category-by-name issue TASK-207 already fixed (activity_logs didn't originally capture enough to reconstruct a point-in-time value) — but fixing it needs a genuinely new piece of instrumentation: point changes aren't logged anywhere today, unlike state_id/iteration_id which log_story_activity already watches.

Deferred rather than folded into TASK-207's other Codex-review fixes (grant fix, generalized iteration-change trigger, pagination, single-point chart marker) because it requires changing buildBurndown's core replay algorithm to reconstruct a story's points-at-each-date from a new point-change log, not just a mechanical fix.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 log_story_activity (or an equivalent trigger) records a story's points change, mirroring how it already records state_id and iteration_id changes
- [x] #2 buildBurndown reconstructs each day's points from that history instead of applying the story's current points uniformly across the whole chart
- [x] #3 A finalized iteration's burndown does not change after a story still linked to it is re-estimated
- [x] #4 Test fixture: a story re-estimated mid-iteration produces a chart with a visible step at the re-estimation date, not a flat rewrite of prior days
- [x] #5 The read path also handles ordinary iteration-membership scope changes (Backlog<->Current drags), not just points — currently a story's presence/absence in a chart is all-or-nothing for the whole iteration rather than scoped to the actual date it entered/left (Codex review, PR #7)
- [x] #6 describeActivity's message for story.iteration_changed distinguishes Backlog (has a state_id, iteration_id NULL) from Icebox (state_id also NULL) instead of calling both 'the Icebox' — and distinguishes an automated finalize_iteration rollover from a manual drag instead of attributing the automatic move to whichever member's page load triggered it (Codex review, PR #7)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Codex's review of PR #7 flagged a second P1 in the same area, same root cause as this task's original scope: buildBurndown treats 'was this story ever part of iteration X' as a binary membership question with no date awareness, so a story scheduled into Current on day 3 (or removed on day 3) has its points counted for the WHOLE iteration instead of only from the actual change date. This needs the same kind of replay-with-real-dates rewrite as the points-snapshot issue, so it's folded into this task's scope rather than filed separately.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added story.points_changed to log_story_activity, plus from_has_state/to_has_state and a three-state rollover marker (auto/manual/absent, carried by a transaction-local GUC set by finalize_iteration) on story.iteration_changed. Rewrote buildBurndown from a category-only replay into a per-story rewind-then-replay over category, points and membership, recomputing each day in full.

Key decisions: membership only reads logs naming the charted iteration (hops between other iterations carry no order — one finalize_iteration call stamps every row with the same now() and a random uuid); a rollover OUT of the charted iteration is rewound but never replayed forward (a manual finish lands it on endDate and would zero the sprint), while a rollover IN is replayed on day one (a lazy finalize stamps it days late and would start the chart at zero); stories.created_at bounds membership for stories created straight into an iteration, which leave no transition to rewind. The GUC is read as text, never cast — is_local reverts it to the empty string rather than unset, and a ::boolean cast would poison every pooled connection that had run finalize_iteration.

Verified: 894 unit tests, 9 trigger integration tests (SUPABASE_INTEGRATION=1, exercising both p_manual paths against the local DB), lint and tsc clean. Each regression test was confirmed to fail with its fix reverted. Four /code-review rounds (one critical, two high) plus an rls-security-reviewer pass, all findings addressed; the one disputed finding (gap iterations in a catch-up) was probed against the real function and did not reproduce. Accepted gap: story.iteration_changed rows from the ~4 days between 20260727140000 and this migration carry no rollover marker and replay as manual drags.
<!-- SECTION:FINAL_SUMMARY:END -->
