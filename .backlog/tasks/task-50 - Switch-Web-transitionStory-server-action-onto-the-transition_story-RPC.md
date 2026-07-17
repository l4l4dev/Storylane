---
id: TASK-50
title: Switch Web transitionStory server action onto the transition_story RPC
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 07:50'
updated_date: '2026-07-17 11:52'
labels:
  - web
  - refactor
milestone: m-3
dependencies:
  - TASK-48
priority: medium
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up mandated by the TASK-47 advisor verdict: TASK-48 creates a transition_story Postgres RPC owning the unestimated-feature guard and the start-from-backlog current-iteration assignment (TASK-19) so all clients share one enforcement point. Once it exists, apps/web/app/projects/[id]/board/actions.ts transitionStory must call that RPC instead of performing the guard + UPDATE in TypeScript, so the rule cannot drift between Web and MCP. Behavior must be identical (same errors surfaced to the UI, TASK-19 regression tests keep passing).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 transitionStory delegates to the transition_story RPC; no duplicate guard logic remains in the action
- [x] #2 Existing transition and TASK-19 regression tests pass unchanged (or updated only for error-message plumbing)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-17 implemented (Sonnet 5): transitionStory (apps/web/app/projects/[id]/board/actions.ts) now delegates entirely to the transition_story RPC (TASK-48) — removed the TS state machine, unestimated-feature guard, and current-iteration assignment (applyTransition/shouldAssignCurrentIteration/isUnestimatedFeature no longer imported here; still used elsewhere for the drag path's evaluateDrop and the button-set rendering in transition-buttons.tsx, so nothing dead in @storylane/core). The action now just reads {number, title} for the Slack message, calls the RPC, and surfaces its error verbatim.

Regenerated apps/web/lib/database.types.ts (supabase gen types typescript --local) — transition_story wasn't in it yet (also picked up assert_not_last_owner/require_project_role from TASK-58's guard-helpers migration, previously un-regenerated; purely additive diff).

Per the code-review NOTE on this task: move_story_board (the drag path) still validates transitions via TS evaluateDrop, not this RPC — left as is, out of this task's AC scope. Flagging for a follow-up task if drift between the two transition paths becomes a real problem (they currently encode the same rules from @storylane/core's story-state.ts, so no drift today, just two enforcement points).

Verified: added a transitionStory describe block to actions.test.ts (5 cases: RPC call shape, unestimated-feature/no-active-iteration/permission-denied error passthrough, fetch-error short-circuit) — 32/32 pass. Full web suite 490/490 (incl. SUPABASE_INTEGRATION=1 against local Supabase). tsc and eslint clean.

e2e/core-flow.spec.ts (the only e2e that clicks the real Start button) fails at an EARLIER, unrelated step (project-creation dialog, strict-mode getByLabel("Name") match) — confirmed pre-existing via git stash (same failure with this task's changes removed). Filed as TASK-69, not fixed here (out of scope).
<!-- SECTION:NOTES:END -->
