---
id: TASK-91
title: 'State model rework: per-project custom states on fixed categories'
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:05'
updated_date: '2026-07-19 12:38'
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

Phase A review (2026-07-19):
- rls-security-reviewer: no findings. Live-exploitation-verified: project_states RLS (member CRUD, owner-only delete, cross-tenant blocked), stories.state_id composite FK blocks cross-project assignment at the DB level, set_story_state confirmed SECURITY INVOKER with correct viewer/outsider denial, all new/changed function grants correct (grant-lockdown allowlist 3/3), finish_story_from_git still service_role-only, auto-seed trigger has no privilege-escalation surface.
- code-review (high, 8-angle): 2 confirmed bugs, both fixed —
  1. promote_story_to_epic spawned Icebox children were keeping the original story's iteration_id unless that iteration was done, breaking the "Icebox (state_id NULL) never carries an iteration_id" invariant finalize_iteration's rollover query depends on. Fixed: children now always get iteration_id = NULL alongside state_id = NULL.
  2. set_story_state(story_id, NULL) (move to Icebox) left iteration_id untouched, same invariant break. Fixed: iteration_id is now explicitly cleared when p_state_id is NULL.
  3rd finding (lock-order inversion between set_story_state and move_story_board's iteration_finalize advisory lock vs row lock) confirmed real but PRE-EXISTING (same pattern already present between the old transition_story and move_story_board before this task) — not fixed in Phase A, left as-is; may be worth a separate follow-up if the owner wants it addressed.
- Full web test suite: 518/518 passing after fixes. database.types.ts regenerated.
- Deploy-order risk identified and confirmed with owner: Phase A migrations are committed LOCALLY ONLY. Pushing now would apply the DB migration to production immediately (deploy.yml: migrate -> functions deploy -> Vercel hook) while currently-deployed app code (board/page.tsx etc.) still queries the dropped stories.state column — that would break production before Phase D (web app re-anchor) lands. Push/deploy deferred until Phase D is complete.

Phase B review (2026-07-19):
- code-review (medium): 3 findings, all addressed —
  1. computeStateGate's advance branch didn't special-case a next-by-position state whose category is 'rejected' (nothing in the schema forbids a rejected-category state being positioned outside the spot immediately after a pre-done state) — a plain advance button could silently land a story in a rejected state under a misleading label. Fixed: next.category === 'rejected' now returns {kind:"none"}; added a regression test.
  2. Duplicate-position tie-break (id-string sort) flagged as non-deterministic — reviewed and confirmed this matches the Phase A advisor's own documented design ("no UNIQUE constraint on position ... ORDER BY position, id is sufficient"), not a gap. Left as-is; added a code comment pointing at that design note for future readers.
  3. Three comments violated CLAUDE.md's Code Comment Policy (history narration referencing "TASK-91"/"TASK-19"/"re-anchored from X to Y"). Fixed: reworded to state the current invariant/why only, no task-number narration.
- packages/core test suite: 40/40 passing (added 1 test for the fixed edge case). tsc clean. Golden fixture (spec/fixtures/state-templates.json) hand-traced against both templates by the reviewer — no data bugs found. acceptedPoints' category-based filter cross-checked against finalize_iteration's SQL — matches exactly.
- Known, accepted breakage (per owner decision, asked and confirmed before committing): committing this phase leaves `pnpm test` failing for apps/web (42 unit tests across kanban.test.ts, transition-buttons.test.tsx, story-detail-panel.test.tsx, story-list-row.test.tsx, board-list-view.test.tsx, board/actions.test.ts) because those files still import the OLD story-state API this phase removed (STORY_STATES, availableTransitions, applyTransition, canTransition, transitionLabel, StoryTransitionAction). This is NOT integration-test-gated (unlike Phase A's tsc-only breakage) — it's real unit-test failure in the default `pnpm test` run. Re-anchoring these consumers onto the new computeStateGate API is Phase C (apps/mcp) and Phase D (apps/web) work, not yet started. Committed locally only (not pushed), same as Phase A.

Phase C review (2026-07-19):
- code-review (medium): 4 findings, all addressed —
  1. board_summary's by_state built from two unsynchronized reads (project_states snapshot, then stories) could silently drop points/count for a state created in the gap between them. Fixed: an orphaned state_id (present in the story aggregation but not the states snapshot) now folds into a "(unknown state)" fallback row instead of vanishing. Narrow window in practice — state creation is a Settings-UI-only action, not an MCP tool, so an agent alone can't trigger it.
  2. setStoryState re-implemented shouldAssignCurrentIteration's rule inline and dropped the hasIterationId half, causing a redundant ensureCurrentIteration round-trip on every in_progress-category target even when the story already has an iteration. Fixed: now reads the story's iteration_id and calls the shared @storylane/core shouldAssignCurrentIteration(category, hasIterationId).
  3. apps/mcp/README.md's tool table still listed the dropped transition_story tool and described list_stories as filtering "by state". Fixed: updated to set_story_state / state_id.
  4. getStory's select string duplicated STORY_SELECT's state-embed fragment verbatim. Fixed: extracted a shared STATE_SELECT constant used by both.
- apps/mcp integration suite: 21/21 passing after fixes (rewritten against the new state_id/set_story_state API — including a new test asserting board_summary's by_state exposes every project state for set_story_state target discovery, and a re-worked concurrent-write test reflecting any-to-any semantics: both concurrent set_story_state calls now succeed serially rather than one being state-machine-rejected, since neither depends on a specific prior state anymore).
- Committed locally only — not pushed, same reasoning as Phase A/B (Phase D, the web app re-anchor, hasn't landed).

Phase D reviews (2026-07-19):
- fable-advisor (design/parity): AC#3 parity verdict = MATCHES. Verified against tag pre-concept-redesign (5930e1f): classic-template column order/icons/tints (category+categoryRank palette reproduces old COLUMN_META byte-for-byte), badge colors (CATEGORY_PALETTES = old STORY_STATE_META), one-click buttons (computeStateGate = old verb table: Start/Finish/Deliver/Accept+Reject/Restart/none), rejected-hide, quick-add placement — all identical. Recorded divergences (intentional, not Phase D defects): TASK-80's Estimate-popover (already design-reviewed), and doc-8 board-level management controls (hidden from viewers). Two corrections raised: (#2 BLOCKING) new-column default placement must be category-end not global-end, because reorder_project_state only value-swaps within a category so a global-tail state is permanently unreachable via the arrows — needs a create_project_state RPC (category-end insert + shift, positions lock, rls-security-reviewer pass); (#3 owner-decision) a null-action_label state is a drag+button dead-end since evaluateDrop reuses computeStateGate — advisor recommends decoupling drag-legality from action_label. (#4 minor) verify git-webhook no-ops on a stale merge_target_state_id.
- rls-security-reviewer (reorder_project_state migration): no findings; live-verified viewer/outsider rejection, cross-tenant scoping (P0002), position-swap correctness, grants. Flagged missing regression test -> added (4 cases in project-states.integration.test.ts).
- /code-review (high, 8-angle): 3 low-severity findings — (1) Slack name lookup after set_story_state can read 'Unknown' on a concurrent rename (cosmetic race, left documented); (2) new-column global-end placement = same as fable-advisor #2; (3) reorder arrows lacked per-row pending -> FIXED (reorderingId disables the active row's arrows).
- AC#3 parity: MATCHES (recorded above). Full web suite 536/536, packages/core 40/40, apps/mcp 21/21, tsc + lint clean before the concurrent-session comingling below.

CONCURRENT-SESSION NOTE: while these reviews ran, a Codex session (@codex-gpt-5 / owner-driven) implemented the fable-advisor corrections directly in the shared working tree, comingled with the Phase D re-anchor: 20260719000014_create_project_state.sql (fix #2), kanban.ts drag-decouple (fix #3), integration-settings optional merge-target, git-webhook + finish_story_from_git edits (fix #4), plus a project_id-immutability guard on 20260719000005. Phase D was therefore NOT committed by @claude-sonnet-5 to avoid clobbering that in-flight work — handoff to the owner to reconcile/commit.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 05:49
---
State-editing UI decided by the owner 2026-07-18 (doc-8 §2, option C hybrid): board-level everyday edits (inline column rename; trailing "+ Add column" with a small category picker — reuse the old free-mode ColumnNameEditor / AddColumnButton interaction patterns) plus a project-settings "States" section for structural management (reorder within category, action_label editing, delete with a stories-remain error, category badges) and a classic/minimal template picker at project creation. Include both surfaces in this tasks UI scope.
---

created: 2026-07-19 07:38
---
Second-opinion review requested via Codex CLI (@codex-gpt-5), to be run separately by the owner outside this session — not a reassignment of TASK-91 itself. Review scope: the per-project custom-states-on-fixed-categories model (spec/data-model.md project_states, doc-8 §2) and the set_story_state write path once implemented.
---

created: 2026-07-19 12:03
---
Codex CLI (@codex-gpt-5) second-opinion review result: HOLD FOR FIXES, do not merge.

Tests/build all green (Web 532/532, MCP 21/21, Core 40/40, ESLint, Next build) but 5 High + 2 Medium spec/security deviations found — passing tests do not cover them:

1. [High] project_states.project_id is mutable under member UPDATE (only category is protected) — supabase/migrations/20260719000005_project_states.sql:44. A member of two projects can move an unused state's project_id to bypass owner-only DELETE and the 'at least one unstarted/done' DELETE trigger. Fix: make project_id immutable too, add a direct-PostgREST-UPDATE regression test.
2. [High] Kanban drag only allows the single next state from computeStateGate, not free any-to-any drag — apps/web/lib/utils/kanban.ts:152 vs spec/screens.md:138 ('drag = any state, ordering only enforced by the advance button'). Existing tests assert the wrong one-step constraint, so green tests hide this.
3. [High] git-webhook RPC picks the earliest-created active Git integration regardless of provider, so GitHub vs Forgejo merge targets can be swapped when both are configured — supabase/functions/git-webhook/index.ts:173 (Edge Function knows provider but doesn't pass it) + supabase/migrations/20260719000012_reanchor_finish_story_from_git.sql:50.
4. [High] finish-from-git RPC sets state_id to finished before checking for an active iteration; with no active iteration (lazy-created on Board visit — apps/web/app/projects/[id]/board/page.tsx:71) the story is left stranded — supabase/migrations/20260719000012_reanchor_finish_story_from_git.sql:103. Fix: create the iteration if missing, or roll back the state update.
5. [Medium] Newly-added project state always appends to the end of the whole ordering, not the end of its own category's slot — apps/web/app/projects/[id]/settings/actions.ts:171, reorder only swaps positions within the same category (supabase/migrations/20260719000013_reorder_project_state.sql:53). E.g. adding an in_progress state to 'classic' leaves it after Rejected; advance graph looks wrong.
6. [Medium] merge_target_state_id is nullable per spec (null = transition disabled) but both the settings UI and server action require it — apps/web/components/features/projects/integration-settings.tsx:70, apps/web/app/projects/[id]/settings/actions.ts:356.

No test exists for StateManager or reorder_project_state behavior directly. No files changed by the review itself — working tree/backlog diffs outside this review untouched.

Per project workflow: holding merge, no auto-fix without owner go-ahead.
---

created: 2026-07-19 12:38
---
All 6 Codex findings fixed and verified this session, plus 3 additional issues found by a self-run 5-angle code-review + rls-security-reviewer pass on the fix patch itself:

Codex findings (all fixed):
1. project_states.project_id now immutable (same trigger as category).
2. Kanban drag is any-state-to-any-state per spec (evaluateDrop no longer restricts to computeStateGate's offered target); ordering discipline lives only in the advance button.
3. finish_story_from_git now takes p_provider and filters by it; old 2-arg overload dropped, new one re-revoked (Postgres grants EXECUTE to PUBLIC on new function signatures by default — caught by grant-lockdown.integration.test.ts).
4. finish_story_from_git resolves the target iteration BEFORE writing state_id; fails closed with 'no_active_iteration' instead of stranding a Backlog/Icebox story when the project has none yet.
5. New states now insert via a new create_project_state RPC that lands at the end of their own category's block (category-rank based, not global max), keeping computeStateGate's per-category contiguity intact.
6. integrations.merge_target_state_id is nullable end-to-end (UI select + server action) per spec — unset disables the merge transition instead of being force-required.

Additional findings from this session's own review pass (all fixed):
7. create_project_state's position math broke when the target category had zero existing rows in the project (e.g. 'minimal' template has no 'rejected' state) — landed the new state at position 0 ahead of everything. Fixed with a category-rank-based insertion point; regression test added (minimal-template Rejected-state case).
8. create_project_state and reorder_project_state shared the generic positions:<project_id> advisory lock key with ~9 unrelated stories.position RPCs — renamed both to a dedicated project_states_positions:<project_id> key.
9. Both RPCs hand-wrote the owner/member role guard instead of using the shared require_project_role helper (supabase/migrations/20260717000001_guard_helpers.sql) that spec/rls.md says new RPCs must use — switched both over.

Also fixed in passing: IntegrationRow.config.merge_target_state_id type widened to include null; removed reviewer-attribution phrasing ('Codex review, TASK-91') from comments per this repo's Code Comment Policy.

Verification: apps/web 543/543 tests (incl. SUPABASE_INTEGRATION=1 integration suite), apps/mcp 21/21, packages/core 40/40, eslint clean, next build clean, local supabase db reset applies all migrations cleanly, rls-security-reviewer pass clean (no RLS/grant holes; the one note it raised — the guard-helper drift — was fixed).

Not yet done: manual browser verification (deferred, this repo's convention — Mika verifies interactively) and a final fable-advisor design-principles pass for the UI-facing pieces (kanban drag behavior change, nullable merge-target select) per this repo's UI review workflow. Ready for commit review.
---
<!-- COMMENTS:END -->
