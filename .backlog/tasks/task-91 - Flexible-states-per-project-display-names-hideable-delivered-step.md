---
id: TASK-91
title: 'State model rework: per-project custom states on fixed categories'
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:05'
updated_date: '2026-07-19 06:29'
labels:
  - web
  - db
milestone: m-5
dependencies:
  - TASK-83
  - TASK-84
  - TASK-70
priority: high
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §2 (owner decision 2026-07-18: fully custom states, usability first; advisor 2nd-pass corrections incorporated in doc-8 — read §2 in full before planning). New project_states table (name, action_label nullable, category CHECK in unstarted/in_progress/done/rejected, position, UNIQUE(id, project_id)); stories.state enum replaced by stories.state_id composite FK, NULL = Icebox; backlog zone predicate becomes iteration_id IS NULL AND state_id IS NOT NULL. Category immutable after creation; deletion plain-FK blocked plus min-one (unstarted+done) trigger under a per-project advisory lock. transition_story replaced by set_story_state (any-to-any within project, SECURITY INVOKER, FOR UPDATE, unestimated-feature gate, done-iteration guard, auto-assign to current iteration on entering in_progress with the existing advisory-lock pattern). Re-anchor ALL consumers: completed_at trigger (done-to-done keeps old value), finalize/skip RPCs (category=done), _splice_backlog / move_story_board / zoneForStory / buildBacklogRows, finish_story_from_git (configurable target state on integration settings, forward-only guard), MCP transition tools, board UI advance buttons via action_label with Accept/Reject pair before done and Restart on rejected, settings screen for state editing, and template seeding in create_project (classic = Pivotal 7-state parity anchor; minimal = Todo/Doing/Done). Keep next-button/pair/gate computation as a data-driven pure function in packages/core with golden fixtures shared with iOS. Do NOT reuse/rename custom_statuses (free-mode leftovers; TASK-84 drops it).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 project_states + stories.state_id land with composite FK, immutable category, min-one trigger (concurrent-delete race covered by test), RLS per custom_statuses precedent; rls-security-reviewer pass
- [ ] #2 set_story_state enforces estimation gate, done-iteration guard, and auto-assignment; any-to-any allowed; one-step ordering exists only in UI
- [ ] #3 All state consumers re-anchored to categories; no code references state name literals; classic-template board renders identically to the pre-change Kanban (parity check recorded per ux-principles Wayback procedure)
- [ ] #4 completed_at: set on entering done, cleared on leaving, preserved on done-to-done moves (tests)
- [ ] #5 Core pure functions data-driven with golden fixtures shared for iOS
- [ ] #6 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
TASK-91 phased plan (owner-approved pacing: phase-by-phase commits; iOS golden fixtures = TS-side JSON only, Swift consumption deferred).

Full codebase survey done (Explore agent, very thorough) confirming every consumer of the fixed stories.state enum across DB/core/web/mcp/tests. Key findings: current code already anticipates this task by name in two places (20260719000002's migration comment, apps/mcp/handlers.ts's transitionStory comment) and both name the target RPC set_story_state. apps/web/lib/utils/focus.ts's focusColumnForStory switch is the closest existing precedent for the category concept. stories.custom_status_id/swimlane_id are dead-but-present columns left over from TASK-84, explicitly deferred to this task -- dropping them alongside state->state_id.

PHASE A -- DB schema + core RPCs (foundation, blocks B-D)
- project_states table (id, project_id, name, action_label nullable, category CHECK unstarted/in_progress/done/rejected, position, UNIQUE(id,project_id)); RLS matches the old custom_statuses pattern (members SELECT/INSERT/UPDATE, owner-only DELETE) per spec/rls.md.
- stories.state_id composite FK (state_id, project_id) -> project_states(id, project_id) ON DELETE RESTRICT; NULL = Icebox. Drop stories.state column + its CHECK/DEFAULT. Drop stories.custom_status_id + stories.swimlane_id (dead since TASK-84, deferred here per that migration's own comment).
- Integrity triggers: category immutable after creation (block UPDATE changing category on an existing row); a per-project advisory-lock trigger enforcing >=1 unstarted and >=1 done state at all times (concurrent-delete race must be covered by a test per AC#1).
- Backlog zone predicate rewrite: iteration_id IS NULL AND state_id IS NOT NULL, in _splice_backlog and insert_board_item.
- set_story_state(p_story_id, p_state_id) RPC replacing transition_story: SECURITY INVOKER, FOR UPDATE (same optimistic-lock/race-guard pattern as transition_story), any-to-any within the project, unestimated-feature gate (category-based: only unstarted-category or NULL/icebox allowed for unestimated features), done-iteration guard (existing trigger), auto-assign to current iteration on entering an in_progress-category state.
- Re-anchor every DB consumer found in the survey onto category instead of literal state name: maintain_story_completed_at (done-category sets completed_at, cleared on leaving, preserved done-to-done), move_story_board (state->state_id throughout, zone derivation by category), finalize_iteration/skip_iteration (velocity = sum points where category=done), finish_story_from_git (configurable target state_id from integrations.config per spec/integrations.md, forward-only guard by category ordering), promote_story_to_epic (spawned stories land Icebox/unstarted-category), move_story_to_project/copy_story_to_project (land in Icebox, state_id NULL -- already true in TASK-84's redefinition, just drop the now-gone state='unscheduled' literal), create_story_tracker (p_state_id instead of p_state), log_story_activity ('story.state_changed' keyed on state_id, resolve old/new state NAMES for the payload via a join so activity history stays human-readable).
- create_project template seeding: classic (Unstarted/Started/Finished/Delivered/Accepted/Rejected matching the current fixed Kanban exactly -- the Pivotal-parity anchor) and minimal (Todo/Doing/Done) project_states rows seeded transactionally with project creation.
- rls-security-reviewer pass (AC#1).

PHASE B -- packages/core rework
- Redesign story-state.ts: replace the fixed 7-value TRANSITIONS table with a data-driven computation taking project_states (id, category, action_label, position) as input -- advance-to-next-state button (next state = next position within category-ordering, or next category's first state), Accept/Reject pair (rendered on the state immediately before a done-category state), Restart (rendered on a rejected-category state, target = first in_progress-category state). Keep pure/stateless, shared shape both Web and iOS will consume.
- velocity.ts: re-anchor acceptedPoints/PointedStory to category=done instead of state==="accepted" (this also lands person-day-rate prep groundwork for TASK-86, but TASK-86 itself -- capacity snapshot, rate formula -- stays out of scope here; only the category anchor point moves).
- New golden fixtures under spec/fixtures/ (JSON, consumed by Vitest now; Swift Testing consumption deferred to the iOS phase per owner decision) covering the classic template's advance/pair/gate computation, so the parity claim (AC#3) has a portable, language-agnostic test vector.
- Full rewrite of story-state.test.ts against the new data-driven shape; velocity.test.ts re-anchored to category fixtures.

PHASE C -- apps/mcp re-anchor
- handlers.ts: boardSummary (points/counts by category, not raw state string), listStories (filter by category or state_id, zone param unchanged in shape but implementation moves to state_id IS NULL / category), getStory, createStory (p_state_id), transitionStory -> calls set_story_state (rpc name already anticipated in the existing comment), moveStory (MOVE_ZONES map becomes state_id-based, resolved from the project's current classic/minimal template's unstarted-category state).
- index.ts tool schemas: transition_story tool becomes set_story_state addressing by state_id (per spec/mcp.md's already-written description from TASK-83), list_stories filter shape.
- handlers.integration.test.ts rewrite for the new shapes.

PHASE D -- apps/web board re-anchor + settings UI
- lib/utils/kanban.ts full rework: STATE_COLUMNS becomes dynamic (derived from the project's project_states ordered by position), columnForStory/evaluateDrop/zoneForStory/evaluateListDrop/flattenCurrentZone re-anchored to state_id + category instead of literal state comparisons.
- lib/utils/stories.ts: STORY_STATE_META (badge label/className) becomes category-driven styling + per-state display name from project_states.name.
- lib/utils/focus.ts: minimal re-anchor only to keep the build/tests green (state_id-based instead of literal state) -- the Focus view FEATURE itself is removed by TASK-89, not this task; do not invest in preserving its UX, just keep it compiling until TASK-89 deletes it.
- board/actions.ts, board/page.tsx, kanban-board.tsx, kanban-columns-board.tsx, board-list-view.tsx, story-card.tsx, story-list-row.tsx, transition-buttons.tsx, story-detail-panel.tsx: re-anchor state reads/writes to state_id, advance button / Accept-Reject pair rendering via the new packages/core computation.
- NEW: board-level inline state editing (column rename, trailing "+ Add column" with a category picker) -- owner decision option C hybrid, reusing the retired free-mode ColumnNameEditor/AddColumnButton interaction patterns as a starting point.
- NEW: project-settings "States" section -- reorder within category, action_label editing, delete-with-stories-remain-error, category badges (read-only after creation).
- NEW: classic/minimal template picker at project creation (inline-create-panel.tsx).
- Rewrite every test file identified in the survey (kanban.test.ts, stories.test.ts, focus.test.ts, epics.test.ts, activity.test.ts, notifications.test.ts, slack.test.ts, story-card.test.tsx, story-list-row.test.tsx, board-list-view.test.tsx, kanban-board-toolbar.test.tsx, quick-add-composer.test.tsx, transition-buttons.test.tsx, story-detail-panel.test.tsx, story-peek-menu.test.tsx, board/actions.test.ts) plus the integration suite (finish-story-from-git, grant-lockdown, insert-board-item, move-copy, move-story-board, position-sequence, promote, stories-write-model, skip-iteration).

PHASE E -- parity verification + final passes
- Classic-template board rendered against the pre-change fixed Kanban per spec/ux-principles.md's Wayback procedure (AC#3) -- fable-advisor design review (mandatory per CLAUDE.md for user-facing UI work) with the parity check explicitly recorded.
- rls-security-reviewer final pass covering the whole schema surface (project_states, stories.state_id, the integrity triggers) end to end.
- High-effort /code-review pass on the full diff.
- Full verification against a real local Supabase: all integration + unit suites, tsc, ESLint.
- Commit/push/deploy per phase as each lands; this final phase closes out AC#6 (pnpm test passes) for the whole task.

Ordering rationale: A blocks everything (schema is the foundation); B can start once A's RPC/category shape is settled (core doesn't need the live DB, just the shape); C and D both depend on B's pure-function shape and A's live schema; E is the closing verification/parity gate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fable-advisor plan review: approve-with-corrections, incorporated into Phase A/D scope below.
- min-one unstarted+done trigger: AFTER DELETE (not BEFORE -- multi-row DELETE accounting breaks otherwise), advisory lock acquired BEFORE the count (READ COMMITTED re-reads post-lock, closing the concurrent-delete race), dedicated lock key hashtext('project_states:' || project_id) (not shared with finalize_iteration's key -- unrelated contention). MUST short-circuit when the owning project itself is being deleted (project_states is ON DELETE CASCADE from projects; without an early-exit when the project row is gone, the cascade delete would fire this trigger and make project deletion itself fail) -- add a test proving a project with states can still be deleted.
- category-immutable trigger: BEFORE UPDATE ... FOR EACH ROW WHEN (new.category IS DISTINCT FROM old.category), matching this repo's existing reject_done_iteration_assignment pattern (20260709000002_finalize_iteration.sql).
- merge_target_state_id (finish_story_from_git's configurable target, spec/integrations.md): Phase A adds fail-closed validation (target state_id must exist in the calling project and not be done/rejected category) since it's a dangling-prone jsonb config field with no FK; Phase D adds the missing settings-form state picker (was missing from my original Phase D file list) -- keep this in Phase D, don't split into a separate task, or git integration has a period where it can't be configured.
- finish_story_from_git needs a FULL guard rewrite (not a literal-swap re-anchor): forward-only becomes a (category rank, position) comparison against the configured target, correctly handling Icebox (state_id NULL) as before-everything, plus the dangling-target fail-closed check above. The current WHERE-predicate-on-literal-states shape can't express this.
- Add one integration test asserting create_project's classic-template seed EXACTLY matches the Phase B golden fixture (name/category/position/action_label) -- prevents the seed SQL and the fixture JSON silently drifting apart, which would hollow out AC#3's parity claim.
- MCP moveStory's backlog-destination target state must be resolved at RUNTIME (the project's current min-position unstarted-category state), not assumed to be a fixed template state -- states are editable after project creation.
- promote_story_to_epic's spawned stories always land state_id = NULL (Icebox) per doc-8's Icebox=NULL rule -- simpler than my original draft (no unstarted-category resolution needed at all).
- project_states.position: no UNIQUE constraint (or DEFERRABLE INITIALLY DEFERRED if added) -- a plain settings reorder swap would deadlock/fail otherwise; ORDER BY position, id is sufficient.
- New table/RPC grants follow the 20260715000005_function_grant_lockdown.sql convention (explicit revoke+grant, RLS alone isn't the full story for RPCs).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 05:49
---
State-editing UI decided by the owner 2026-07-18 (doc-8 §2, option C hybrid): board-level everyday edits (inline column rename; trailing "+ Add column" with a small category picker — reuse the old free-mode ColumnNameEditor / AddColumnButton interaction patterns) plus a project-settings "States" section for structural management (reorder within category, action_label editing, delete with a stories-remain error, category badges) and a classic/minimal template picker at project creation. Include both surfaces in this tasks UI scope.
---
<!-- COMMENTS:END -->
