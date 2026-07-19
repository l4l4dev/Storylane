---
id: TASK-13
title: Promote story to Epic
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 14:26'
updated_date: '2026-07-10 01:03'
labels:
  - web
  - db
milestone: m-0
dependencies: []
references:
  - spec/features.md
priority: medium
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/features.md 'Promote to Epic': a story that grew too big converts into a new epic (title/description carried over); its tasks expand into new stories at the original story's backlog position (task order preserved, original labels copied, linked to the new epic); the original story is deleted after a confirmation dialog that warns about comment deletion. Points/assignee discarded. Activity log records the promotion. Entry point: overflow menu in the side peek.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Promote to Epic appears in the side peek overflow menu with a confirmation dialog spelling out the conversion (and warning when comments exist)
- [x] #2 New epic gets the story's title/description; each task becomes an unestimated feature story at the original backlog position preserving order, linked to the epic, with labels copied
- [x] #3 Original story is deleted; promotion is atomic (single RPC/transaction) and recorded in the activity log
- [x] #4 A story with no tasks promotes to an empty epic (dialog says so)
- [x] #5 Tests cover promotion with tasks, without tasks, and with comments (warning path)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration: new RPC public.promote_story_to_epic(p_story_id uuid) returns jsonb
   - invoker rights (no SECURITY DEFINER) - operation is owner-gated via RLS
     (stories DELETE is owner-only, so promote is implicitly owner-only too)
   - select story FOR UPDATE; raise exception if not found
   - explicit coalesce(project_role(...), '') <> 'owner' check (defense in depth)
   - pg_advisory_xact_lock(hashtext('story_number:' || project_id)) to
     serialize with assign_story_number and other concurrent promotes in the
     same project (avoids shift-UPDATE deadlocks)
   - count tasks; insert epic (name=story.title, description=story.description)
   - if task_count > 0: shift stories.position += (task_count-1) for siblings
     with position > original, then insert one new story per task (in task
     order) at position, position+1, ...:
     - type feature, points=null, assignee_id=null, epic_id=new epic
     - state: 'unscheduled' if original was 'unscheduled' (icebox), else
       'unstarted' (never inherits started/finished/etc - unestimated
       features can't be started)
     - iteration_id: copied from original UNLESS that iteration's
       state='done' (then null) - avoids stories_reject_done_iteration_insert
     - custom_status_id/swimlane_id copied as-is (free-mode, no state conflict)
     - copy story_labels to each new story
   - insert one bespoke activity_logs row (action='story.promoted_to_epic',
     story_id=null, payload={epic_id, title, task_count, new_story_ids}) -
     documented as the sole exception to "clients never insert activity_logs
     directly" in ARCHITECTURE.md, since this is a DELETE-driven event the
     existing triggers can't cover
   - delete original story (cascades tasks/story_labels/comments)
   - return {epic_id, story_ids}
2. Update ARCHITECTURE.md activity_logs row: note the promote RPC exception
3. Update spec/features.md "Promote to Epic": record the state-inheritance
   rule (unscheduled stays unscheduled, else unstarted; assignee never
   inherited; done-iteration stories land back in the backlog)
4. Server action promoteStoryToEpic(storyId, projectId) in
   app/stories/[id]/actions.ts calling supabase.rpc(), redirect to
   /projects/[projectId]/epics on success
5. UI: add overflow (kebab) DropdownMenu to StoryPeek header (shadcn
   dropdown-menu, same pattern as app-sidebar.tsx) with "Promote to Epic" and
   "Delete story" (delete moves into this menu too since the peek currently
   has no delete at all - AC #1 requires it alongside Promote)
6. New PromoteToEpicDialog client component: confirmation dialog spelling out
   the conversion (epic name, N new stories), warns if comments exist (they
   are deleted with the story), notes empty-epic case when task_count=0 and
   that task completion state isn't carried over
7. Tests: integration test (SUPABASE_INTEGRATION=1 gate, mirroring
   recurring.integration.test.ts) covering: promote with tasks, promote with
   zero tasks (empty epic), promote a story with comments (cascade delete),
   promote a done-iteration story (iteration_id nulled, no exception),
   promote an icebox story (state stays unscheduled), concurrent promote of
   two different stories in the same project (serializes, no deadlock),
   non-owner member rejected. Component test for PromoteToEpicDialog wording
   variations.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation:
- Migration 20260710000001_promote_story_to_epic.sql: invoker-rights RPC
  promote_story_to_epic(p_story_id). Advisor-reviewed twice (initial design +
  the RLS-quirk fix below). Locks tasks with FOR UPDATE (array_agg) before
  counting, to close a race where a concurrent task add/delete could desync
  the position-shift amount from what the loop creates (found by
  rls-security-reviewer). Owner-only via explicit coalesce(project_role)
  check done BEFORE any locked SELECT, because Postgres RLS requires a
  locked SELECT to also satisfy the table's UPDATE policy, not just SELECT's
  - locking first made non-owner members get a misleading "Story not found"
  instead of the real permission error (found via manual integration
  testing, not caught by advisor review alone).
- spec/features.md + ARCHITECTURE.md updated with the state-inheritance
  rule (unscheduled stays unscheduled else unstarted; done-iteration stories
  drop iteration_id; assignee never inherited) and the activity_logs direct-
  insert exception.
- Server action promoteStoryToEpic (app/stories/[id]/actions.ts), UI in new
  StoryPeekMenu component (overflow menu with Promote to Epic + Delete,
  wired into both the board's side peek and the standalone /stories/[id]
  page - neither had an overflow menu before this task).
- describeActivity() (lib/utils/activity.ts) got a friendly label for
  story.promoted_to_epic so the activity feed doesn't show the raw action
  string.

Verification:
- lib/utils/promote.integration.test.ts (SUPABASE_INTEGRATION=1): tasks
  case, zero-tasks/empty-epic case, comments cascade, done-iteration story,
  icebox story, concurrent promote of two stories, non-owner rejection.
  All 7 pass.
- components/features/story/story-peek-menu.test.tsx: dialog wording
  variations (task count, empty epic, comment warning). All pass.
- lib/utils/activity.test.ts: added cases for the new action label.
- rls-security-reviewer and web-conventions-reviewer both ran clean (one
  fixed finding: the tasks-lock race above; one false positive on kebab-case
  file naming, which matches every existing component file in the repo
  despite what CLAUDE.md's naming section says - not changed).
- Full pnpm test / lint / tsc all pass.
- Manually verified end-to-end in the browser: promote with tasks (epic +
  2 ordered unestimated feature stories, original deleted, redirected to
  Epics page), promote with zero tasks (empty epic), activity log entries.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented Promote to Epic (spec/features.md) as a single invoker-rights RPC (promote_story_to_epic) plus a new StoryPeekMenu overflow-menu component wired into both the board peek and the standalone story page. Verified with a 7-case DB integration test, a component test for the confirmation dialog wording, RLS and web-conventions reviews, and manual end-to-end browser testing (task-count/empty-epic/comment-warning paths, activity log).
<!-- SECTION:FINAL_SUMMARY:END -->
