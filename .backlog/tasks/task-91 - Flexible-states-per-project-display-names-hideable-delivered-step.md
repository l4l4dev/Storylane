---
id: TASK-91
title: 'State model rework: per-project custom states on fixed categories'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:05'
updated_date: '2026-07-18 05:49'
labels:
  - web
  - db
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

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 05:49
---
State-editing UI decided by the owner 2026-07-18 (doc-8 §2, option C hybrid): board-level everyday edits (inline column rename; trailing "+ Add column" with a small category picker — reuse the old free-mode ColumnNameEditor / AddColumnButton interaction patterns) plus a project-settings "States" section for structural management (reorder within category, action_label editing, delete with a stories-remain error, category badges) and a classic/minimal template picker at project creation. Include both surfaces in this tasks UI scope.
---
<!-- COMMENTS:END -->
