---
id: TASK-179
title: 'Triggers: single-level nesting + is_container auto-maintenance + points clear'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
labels: []
milestone: m-6
dependencies:
  - TASK-178
documentation:
  - doc-18
type: feature
ordinal: 1800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the DB triggers that keep the hierarchy correct without any dedicated UI (doc-18 §3-§4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 enforce_single_level_nesting rejects parenting under a story that is itself a child, and rejects a story with children becoming a child (max depth 1, symmetric)
- [ ] #2 is_container is recomputed on parent_id INSERT/UPDATE/DELETE for affected old/new parents: true iff >=1 child, false at 0 children
- [ ] #3 on false->true the trigger NULLs points/state_id/iteration_id and writes the old points to activity_logs (SECURITY DEFINER path)
- [ ] #4 tests cover: grandchild rejected, child-with-children rejected, auto true/false flip, points cleared + logged
<!-- AC:END -->
