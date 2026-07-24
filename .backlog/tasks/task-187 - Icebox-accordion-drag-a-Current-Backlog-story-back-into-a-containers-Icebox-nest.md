---
id: TASK-187
title: >-
  Icebox accordion: drag a Current/Backlog story back into a container's Icebox
  nest
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 13:48'
labels: []
milestone: m-6
dependencies:
  - TASK-184
documentation:
  - doc-18
ordinal: 1710
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split from TASK-186 per fable-advisor review (2026-07-24): the symmetric counterpart to TASK-186's "drag a container's Icebox child out to Current/Backlog" — dragging a Current/Backlog story onto a container's Icebox accordion row to re-parent it there (parent_id = that container) and demote it to that container's Icebox nest.

Unlike TASK-186 (which only reassigns state_id/iteration_id — parent_id never changes), this direction genuinely needs new backend capability: neither existing RPC covers it alone.
- update_story (20260724051506_epic_story_unification_rpcs.sql) writes parent_id but never touches position.
- move_story_board (20260722000001_move_story_board_iteration_guard_range.sql) handles state/iteration + position + the advisory lock + staleness check, but has no parent_id parameter.

Advisor-recommended approach: extend move_story_board to accept an optional parent_id delta, resolving the position scope to "this container's Icebox children" when the target is a container's nest — reusing its existing pg_advisory_xact_lock(project_id) and staleness-check machinery rather than inventing a third RPC.

Explicitly NOT in scope here: the Parent picker's "target becomes an epic" containerize-confirmation dialog (spec/screens.md / doc-18 §9) never applies — the drop target here is always an EXISTING container (is_container already true), so no confirmation is needed and that dialog logic must not be reused/triggered by this path.

Architecture-sensitive (new RPC surface, position-scope design, concurrency) — per CLAUDE.md's Backlog Assignee & Model Policy, this is an @claude-opus-4-8 task, not @claude-sonnet-5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dragging a Current/Backlog story (any parent, or none) onto a container's Icebox accordion row sets parent_id to that container and demotes it to that container's Icebox nest (state_id/iteration_id cleared per the existing icebox-crossing rule)
- [ ] #2 The move is placed with a dense position among that container's existing Icebox children (anchor-based, consistent with dropStoryInList's before_item_id pattern) — no upward-shift renumbering of unrelated rows
- [ ] #3 No containerize confirmation dialog fires (the target is already a container)
- [ ] #4 Concurrent-safe: reuses move_story_board's existing pg_advisory_xact_lock(project_id) + staleness check rather than a new lock
- [ ] #5 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->
