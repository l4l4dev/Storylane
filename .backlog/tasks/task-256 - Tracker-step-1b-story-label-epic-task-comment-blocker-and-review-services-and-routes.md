---
id: TASK-256
title: >-
  Tracker step 1b: story, label, epic, task, comment, blocker and review
  services and routes
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-16 11:55'
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
