---
id: TASK-256
title: >-
  Tracker step 1b: story, label, epic, task, comment, blocker and review
  services and routes
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-16 11:55'
updated_date: '2026-09-16 13:09'
labels: []
milestone: m-10
dependencies:
  - TASK-255
references:
  - docs/plans/2026-09-16-tracker-step-1-core-model.md
  - docs/reference/tracker-notes/core-model.md
priority: high
type: feature
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Second slice of the Tracker core model (design docs/design/2026-09-16-tracker-parity-rewrite-design.md §3.2): the domain services and JSON API on top of the step-1a schema. Execute plan Tasks 7-16 of docs/plans/2026-09-16-tracker-step-1-core-model.md on branch rewrite/tracker. Task 9 (before_id/after_id ordering with sparse positions and the concurrency test) is architecture-sensitive — run it on @claude-opus-5. Every DELETE route goes into DESTRUCTIVE; every new route needs a ROUTE_ACTIONS entry or the matrix test fails.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Plan Tasks 7-16 complete: project settings PUT, stories CRUD/transitions/moves, owners, followers, labels, epics, tasks, comments with attachments, blockers, reviews, iteration overrides
- [ ] #2 Story ordering uses before_id/after_id with GAP-based sparse positions; list+state moves are one UPDATE; the concurrency test passes
- [ ] #3 Type-specific transitions hold (release finished->accepted only, chore has no finished/delivered/rejected, accepted can return to unstarted)
- [ ] #4 bun test in apps/server and bun run lint are green; /code-review run before the commit proposal
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carried from TASK-255 reviews (2026-09-16): (a) Task 9 between(): resolve upper as the smallest existing position > lower so repeated moves into one seam never collide on UNIQUE(project_id,list,position); move route is the sole writer to the far project via withTwoProjects — add tests 'target project I am not a member of → 404' and 'archived target → 409'. (b) Task 8 StoryPatch gains group?: unscheduled|scheduled|current; accepted → unstarted is allowed; reuse or drop routes/limits.ts TITLE_MAX. (c) Task 10 (authz-reviewer L4/L5): self-follow = body-less POST|DELETE …/stories/:sid/follow under follower:write; following/owning someone else under story:write with separate routes; matrix rows + 'viewer targets another user → 403' test; note in fixture/permissions.md that story owners use story:write. (d) Task 7 owns the PROVISIONAL shims in services/projects.ts, routes/projects.ts, invites.ts (point_scale validation, ProjectDetail/ProjectPatch shape, start_date default = most recent UTC Monday is INVENTED — decide the real default, activity copy strings, original_values on project writers); mintInvite/revokeInvite record project_membership_* kinds with INVITE ids — decide resource kind there. (e) Task 12: verify reorder() scopes by project_id. Task 16: service-side length_invalid / team_strength_invalid. Task 11 Step 4 needs its ROUTE_ACTIONS entry. (f) deleteProject records no activity and SSE publishes version 0 on delete; dev backstop (events/emit.ts) untested.
<!-- SECTION:NOTES:END -->
