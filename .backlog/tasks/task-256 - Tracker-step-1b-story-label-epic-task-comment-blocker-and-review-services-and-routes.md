---
id: TASK-256
title: >-
  Tracker step 1b: story, label, epic, task, comment, blocker and review
  services and routes
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-16 11:55'
updated_date: '2026-09-17 08:09'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Branch feat/tracker-step-1b off feat/tracker-step-1a (PR #28 still open; main lacks step 1a). 2. Execute plan Tasks 7-16 via superpowers:subagent-driven-development, ledger .superpowers/sdd/2026-09-16-tracker-step-1-core-model/progress.md (rulings recorded there: start_date default, invite activity kinds, Task 10 route split per authz carry, DESTRUCTIVE location). 3. Task 9 on worker-opus; others worker-sonnet; per-task review + final whole-branch review. 4. Owner runs /code-review, then PR stacked on #28.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carried from TASK-255 reviews (2026-09-16): (a) Task 9 between(): resolve upper as the smallest existing position > lower so repeated moves into one seam never collide on UNIQUE(project_id,list,position); move route is the sole writer to the far project via withTwoProjects — add tests 'target project I am not a member of → 404' and 'archived target → 409'. (b) Task 8 StoryPatch gains group?: unscheduled|scheduled|current; accepted → unstarted is allowed; reuse or drop routes/limits.ts TITLE_MAX. (c) Task 10 (authz-reviewer L4/L5): self-follow = body-less POST|DELETE …/stories/:sid/follow under follower:write; following/owning someone else under story:write with separate routes; matrix rows + 'viewer targets another user → 403' test; note in fixture/permissions.md that story owners use story:write. (d) Task 7 owns the PROVISIONAL shims in services/projects.ts, routes/projects.ts, invites.ts (point_scale validation, ProjectDetail/ProjectPatch shape, start_date default = most recent UTC Monday is INVENTED — decide the real default, activity copy strings, original_values on project writers); mintInvite/revokeInvite record project_membership_* kinds with INVITE ids — decide resource kind there. (e) Task 12: verify reorder() scopes by project_id. Task 16: service-side length_invalid / team_strength_invalid. Task 11 Step 4 needs its ROUTE_ACTIONS entry. (f) deleteProject records no activity and SSE publishes version 0 on delete; dev backstop (events/emit.ts) untested.

Task 10 authz-reviewer (2026-09-17): no exploitable holes in the owners/followers routes (story:write for owners/:userId and followers/:userId, follower:write body-less /follow on the actor); low notes folded into a fix round; toRow per-row SELECTs deferred.

Owner decision 2026-09-17: comment file upload is a raw application/octet-stream body (filename and content type in headers), with a narrow csrfGuard allowance for that one route, instead of the plan's multipart/form-data, which csrfGuard's JSON-only rule refuses. The csrf.ts change gets an authz-reviewer pass.

Task 13 authz-reviewer (2026-09-17): no exploitable holes in the csrf octet-stream allowance, comment/attachment object checks or the file store. Low notes (active content types served as stored, body buffered before project authorization, disabled user 400/413 before 401, missing bytes → 500) are fixed in a fix round.

State 2026-09-17: plan Tasks 7-16 implemented on feat/tracker-step-1b (764c0b1..93df2fe, stacked on PR #28). Every task passed a spec+quality review; authz-reviewer passes: Task 10, Task 13 (csrf octet-stream allowance, owner decision B), consolidated over the rest — no exploitable holes. Final whole-branch review (opus) + one fix wave, re-review clean. Gates: server 966 pass, lint + typecheck clean, core 19, web 36, web lint clean. Parked for the owner's review round: label/epic PUT answer 400 before 404 for an unknown id (routes/labels.ts); spec/permissions.md last-owner note still claims member:remove 409. Proposed follow-ups (not created, need owner approval): batch toRow/epic progress + windowed renumber before the TASK-257 board; shared route/service helpers; activity copy/shape pass; author check before upload bytes; small missing tests; matrix action-403 code. Next: owner runs /code-review (high: csrf/authz/attachments), then commit proposal + PR. All rulings: .superpowers/sdd/2026-09-16-tracker-step-1-core-model/progress.md (git-ignored).
<!-- SECTION:NOTES:END -->
