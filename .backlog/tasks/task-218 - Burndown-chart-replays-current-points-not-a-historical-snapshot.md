---
id: TASK-218
title: 'Burndown chart replays current points, not a historical snapshot'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 15:43'
updated_date: '2026-07-27 15:59'
labels:
  - tooling
milestone: m-0
dependencies: []
references:
  - apps/web/lib/utils/burndown.ts
  - supabase/migrations/20260727140000_generalize_iteration_change_log.sql
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
- [ ] #1 log_story_activity (or an equivalent trigger) records a story's points change, mirroring how it already records state_id and iteration_id changes
- [ ] #2 buildBurndown reconstructs each day's points from that history instead of applying the story's current points uniformly across the whole chart
- [ ] #3 A finalized iteration's burndown does not change after a story still linked to it is re-estimated
- [ ] #4 Test fixture: a story re-estimated mid-iteration produces a chart with a visible step at the re-estimation date, not a flat rewrite of prior days
- [ ] #5 The read path also handles ordinary iteration-membership scope changes (Backlog<->Current drags), not just points — currently a story's presence/absence in a chart is all-or-nothing for the whole iteration rather than scoped to the actual date it entered/left (Codex review, PR #7)
- [ ] #6 describeActivity's message for story.iteration_changed distinguishes Backlog (has a state_id, iteration_id NULL) from Icebox (state_id also NULL) instead of calling both 'the Icebox' — and distinguishes an automated finalize_iteration rollover from a manual drag instead of attributing the automatic move to whichever member's page load triggered it (Codex review, PR #7)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Codex's review of PR #7 flagged a second P1 in the same area, same root cause as this task's original scope: buildBurndown treats 'was this story ever part of iteration X' as a binary membership question with no date awareness, so a story scheduled into Current on day 3 (or removed on day 3) has its points counted for the WHOLE iteration instead of only from the actual change date. This needs the same kind of replay-with-real-dates rewrite as the points-snapshot issue, so it's folded into this task's scope rather than filed separately.
<!-- SECTION:NOTES:END -->
