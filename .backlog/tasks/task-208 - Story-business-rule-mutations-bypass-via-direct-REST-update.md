---
id: TASK-208
title: Story business-rule mutations bypass via direct REST update
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
labels: []
milestone: m-2
dependencies: []
references:
  - supabase/migrations/20260630000002_grants.sql
  - supabase/migrations/20260719000002_relax_stories_write_rls.sql
  - >-
    supabase/migrations/20260724061745_epic_story_unification_set_story_state_container_guard.sql
priority: high
type: bug
ordinal: 1100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
stories UPDATE RLS (20260719000002_relax_stories_write_rls.sql) allows any project member to update any column via PostgREST directly, while the estimation gate, current-iteration auto-assign, and container guard are only enforced inside the set_story_state RPC. A direct .from("stories").update() call (from the web client, MCP, or any REST caller) bypasses all three invariants — verified locally: an unestimated feature can be set to done with iteration_id = NULL. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An unestimated feature cannot be moved to a started/done category state via a direct table update, only via set_story_state
- [ ] #2 A story entering an in_progress-category state with no iteration_id still gets auto-assigned to the current iteration regardless of write path
- [ ] #3 A container's state_id still cannot be set to non-NULL via any write path
- [ ] #4 Existing RPC-driven flows (set_story_state, move_story_board, update_story) keep passing their current tests unchanged
<!-- AC:END -->
