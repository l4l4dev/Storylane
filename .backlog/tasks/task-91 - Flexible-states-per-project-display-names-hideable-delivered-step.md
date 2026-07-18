---
id: TASK-91
title: 'Flexible states: per-project display names + hideable delivered step'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 03:05'
labels:
  - web
  - db
dependencies:
  - TASK-83
priority: medium
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §2 (advisor-narrowed scope, owner confirmation pending — do not start before the owner confirms). The state SET stays the fixed enum; flexibility is per-project display names for states plus hiding the delivered step (and optionally rejected) so accept follows finish directly for non-development projects. The accepted literal stays intact everywhere (finalization RPC, completed_at trigger, transition_story, backlog zone predicate) — this task must not touch velocity or zone semantics. Scope: settings storage for names/hidden steps, transition UI honoring both, MCP tool descriptions surfacing display names.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A project can rename states and hide delivered (and rejected); transitions skip hidden steps correctly
- [ ] #2 Velocity, completed_at, and backlog zone behavior are unchanged (regression tests)
- [ ] #3 pnpm test passes
<!-- AC:END -->
