---
id: TASK-50
title: Switch Web transitionStory server action onto the transition_story RPC
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 07:50'
updated_date: '2026-07-15 23:54'
labels:
  - web
  - refactor
milestone: m-3
dependencies:
  - TASK-48
priority: medium
ordinal: 15500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up mandated by the TASK-47 advisor verdict: TASK-48 creates a transition_story Postgres RPC owning the unestimated-feature guard and the start-from-backlog current-iteration assignment (TASK-19) so all clients share one enforcement point. Once it exists, apps/web/app/projects/[id]/board/actions.ts transitionStory must call that RPC instead of performing the guard + UPDATE in TypeScript, so the rule cannot drift between Web and MCP. Behavior must be identical (same errors surfaced to the UI, TASK-19 regression tests keep passing).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 transitionStory delegates to the transition_story RPC; no duplicate guard logic remains in the action
- [ ] #2 Existing transition and TASK-19 regression tests pass unchanged (or updated only for error-message plumbing)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
NOTE (code review 2026-07-16): move_story_board (TASK-56) applies state changes during drops with transition validation still in TS (evaluateDrop). When transition_story lands (TASK-48) and this task wires transitionStory onto it, the move path must share the same DB-side guard — either move_story_board calls the same validation internally or the guard function is shared — otherwise the DB has two transition paths that can drift (exactly what this task exists to prevent).
<!-- SECTION:NOTES:END -->
