---
id: TASK-84
title: 'Remove free mode (code, tables, tests)'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:03'
updated_date: '2026-07-18 03:20'
labels:
  - web
  - db
dependencies:
  - TASK-83
priority: high
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §1: free mode is removed entirely, pre-launch, no data migration. Delete free-board UI (free-board.tsx and friends), free-mode server actions/RPCs, board column/swimlane/WIP tables and their RLS policies via a drop migration, the workflow_mode column/concept, free-mode seeds and tests. Delete existing free-mode test projects. The git tag pre-concept-redesign (at main 5930e1f) already marks the pre-removal state. Board toggle handling of the Focus view is NOT in scope here (TASK-89).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No free-mode code paths, tables, policies, types, or tests remain; database.types.ts regenerated
- [ ] #2 Drop migration reviewed by rls-security-reviewer (policy removal is a security-relevant change)
- [ ] #3 pnpm test passes; app boots and tracker boards work with workflow_mode gone
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 03:20
---
Advisor 2nd pass: stay a pure drop migration. Do NOT rename or reuse custom_statuses as project_states (free-mode leftovers like is_done/wip_limit would pollute it and muddy the RLS review) — TASK-91 creates the new table fresh.
---
<!-- COMMENTS:END -->
