---
id: TASK-225
title: Containerizing a story writes four activity_logs rows for one action
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-07-31 23:49'
updated_date: '2026-08-03 14:06'
labels: []
milestone: m-2
dependencies: []
references:
  - supabase/migrations/20260724054954_epic_story_unification_triggers.sql
  - supabase/migrations/20260731000000_log_story_points_and_rollover_marker.sql
  - 'apps/web/app/projects/[id]/activity/page.tsx'
priority: medium
ordinal: 1450
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
recompute_is_container() (supabase/migrations/20260724054954_epic_story_unification_triggers.sql) inserts an explicit story.containerized row and then does a plain UPDATE setting is_container = true, points = null, state_id = null, iteration_id = null. That single UPDATE is caught by log_story_activity, which now emits story.state_changed, story.iteration_changed AND story.points_changed alongside it.

So turning one story into an epic writes four rows describing the same action, and the project activity feed (apps/web/app/projects/[id]/activity/page.tsx renders every row, no action filter) shows all four:

  Dev User turned "X" into an epic
  Dev User moved "X" from Unstarted to <nothing>
  Dev User moved "X" from iteration #3 to the Icebox
  Dev User removed the estimate from "X"

Three of those were already emitted before TASK-218; story.points_changed is the fourth, added by 20260731000000. Found by the rls-security-reviewer and /code-review passes on TASK-218, which confirmed it is not a security or RLS issue and not a defect in that migration — the burndown replay reads the co-occurring rows consistently. It is a feed-readability problem.

The open question is WHERE to fix it: suppress the redundant rows at the trigger (recompute_is_container could mark its own UPDATE the way finalize_iteration marks a rollover, via the storylane.rollover GUC pattern 20260731000000 introduced), or collapse them at the reader. The trigger side keeps activity_logs itself honest; the reader side avoids hiding real column history from anything else that reads the table. Decide before implementing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision is recorded on whether the redundant rows are suppressed at the trigger or collapsed in the reader, with the reason
- [x] #2 Turning a story into an epic produces one readable entry in the project activity feed, not four
- [x] #3 The burndown replay (apps/web/lib/utils/burndown.ts) still date-scopes a containerized story correctly — it leaves the iteration on the containerization date
- [x] #4 Story-detail history (apps/web/app/stories/[id]/actions.ts) is checked against the same change
- [x] #5 A test covers the containerization case end to end
- [x] #6 Containerizing a story in a Slack-connected project enqueues no story_state_changed notification — the state clearing is bookkeeping, and slack-notify would otherwise render its null "to" as "moved to the Icebox"
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Decision (AC#1): collapse in the READER, not the trigger — forced by evidence, not preference.

recompute_is_container clears points, state_id and iteration_id in one UPDATE, and buildBurndown needs all three transitions: they are how it knows the story held N points and sat in the iteration until the containerization date. Suppressing them at the trigger would make a containerized story read as never having been a member, which is AC#3 of this very task. activity_logs is also an audit log and those writes genuinely happened, so removing them is the wrong shape regardless.

Plan:
1. Migration: recompute_is_container sets a transaction-local GUC (storylane.bookkeeping = containerize) around its UPDATE, mirroring the storylane.rollover pattern from 20260731000000. log_story_activity stamps that value into the payload of the rows it writes while the GUC is set — it does NOT skip them.
2. Activity feed (app/projects/[id]/activity/page.tsx): drop rows carrying that marker. story.containerized already describes the action, and it alone carries old_points.
3. Story-detail history (app/stories/[id]/actions.ts): same filter, checked against its own whitelist.
4. buildBurndown: unchanged — it reads the transitions as before, marker or not. Its existing containerization test is the regression guard.
5. Integration test: containerizing a story writes the four rows, three carry the marker, and the feed-side helper keeps exactly one.

Rejected: grouping adjacent rows by timestamp in the reader. Since 20260802000000 the four rows carry distinct clock_timestamp values, so any grouping would be a time-window heuristic; an explicit marker is exact.

Needs: fable-advisor review (trigger + migration + event path), then rls-security-reviewer on the migration.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Turning a story into an epic wrote four activity_logs rows for one action, and the Slack outbox announced "moved to the Icebox" on every epic because it fires on any story.state_changed and slack-notify maps a null `to` to the Icebox.

AC#1 decision: the three rows the bookkeeping UPDATE produces are MARKED, not suppressed. buildBurndown rewinds from a story's current row — for an epic that row has points/state_id/iteration_id all NULL, so those transitions are how the replay learns the story held N points and sat in the iteration until that moment. Suppressing them would make a containerized story read as never having been a member (AC#3 of this same task). A payload marker rather than a new action name, because buildBurndown and describeActivity both switch on `action`.

Implemented in 20260803000000_mark_containerize_bookkeeping.sql: recompute_is_container and set_epic_pinned wrap their UPDATE in a transaction-local storylane.bookkeeping GUC (the storylane.rollover pattern from 20260731000000), log_story_activity stamps it into the payload, and each reader decides — burndown ignores it, the project feed / story detail / MCP get_story filter it out, and the Slack outbox trigger's WHEN clause skips it.

Three defects surfaced during review and were fixed in the same PR: story.containerized was only written for an estimated story (so an unestimated one lost its last trace); the story-detail whitelist never contained story.containerized; and set_epic_pinned — the actual "Turn into epic" button, which never routes through recompute_is_container — was entirely unfixed. A later /code-review pass caught that making that insert unconditional gave an already-container story a second story.containerized row; guarded on is_container.

Verified on merged main (cf2c7d3): 903 web unit tests, 63 tests across the nesting/burndown/activity/story-detail suites with SUPABASE_INTEGRATION=1, 4 MCP tests, lint and tsc clean. Every new integration case was confirmed to fail with its fix reverted, including the is_container guard (2 rows instead of 1) and both reader filters.

Reviews: fable-advisor, rls-security-reviewer x2, /code-review high x2 (MEDIUM 1 + LOW 2), Codex x3 (P2 x2, P3 x2). All findings addressed except one LOW accepted as-is: coalesce(auth.uid(), created_by) attributes a service-role containerization to the story's creator, matching what log_story_activity already does for the other three rows of the same UPDATE.

NOT deployed — the migration still needs supabase db push in production (tracked under TASK-94, alongside PR #18 and #19).
<!-- SECTION:FINAL_SUMMARY:END -->
