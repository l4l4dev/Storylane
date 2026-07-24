---
id: TASK-182
title: 'RLS review pass: Epic/Story unification migrations'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
labels: []
milestone: m-6
dependencies:
  - TASK-179
  - TASK-180
  - TASK-181
documentation:
  - doc-18
type: task
ordinal: 2100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Run the rls-security-reviewer agent over the doc-18 migrations (project rule for migrations) before merge/deploy. Confirm no policy gaps from dropping epics and adding split_story / parent_id.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 rls-security-reviewer pass completed; findings triaged with the owner (hold merge on findings per CLAUDE.md)
- [ ] #2 confirms: is_container has no client write path; split_story grant is minimal; parent_id writes ride the existing member UPDATE policy; dropped epics policies leave no orphaned grants
<!-- AC:END -->
