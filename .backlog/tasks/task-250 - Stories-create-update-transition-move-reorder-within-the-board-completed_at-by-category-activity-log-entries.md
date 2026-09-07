---
id: TASK-250
title: >-
  Stories: create, update, transition, move/reorder within the board,
  completed_at by category, activity log entries
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-09-07 02:55'
labels: []
milestone: m-9
dependencies:
  - TASK-249
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
  - spec/features.md
priority: high
type: feature
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Services + routes for stories per spec/permissions.md story:read/write/delete. number = MAX+1 inside the transaction (pinned by trigger); position via reorder() within a state column (scope = project + state; Icebox = NULL state); transition sets state_id and completed_at from the target state's category (design §5 table); estimate field validated against the project's point scale from packages/core; every mutation writes activity_logs via recordActivity in the same transaction. Board read: GET /api/projects/:id/board returns states with ordered stories. Pure ordering/transition helpers go to packages/core with fixtures where spec/fixtures already has them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All story routes in ROUTE_ACTIONS and green in the matrix; viewer cannot write, member can, owner deletes
- [ ] #2 Moving a story into a done-category state sets completed_at; moving back clears it (tests)
- [ ] #3 Two concurrent creates get distinct numbers (test with sequential immediate transactions); number cannot be updated (trigger test)
- [ ] #4 Each mutation produces exactly one activity_logs row in the same transaction (tests incl. rollback)
<!-- AC:END -->
