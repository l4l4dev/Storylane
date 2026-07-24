---
id: TASK-185
title: Retire TASK.md — consolidate all task tracking into Backlog
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 04:08'
labels: []
milestone: m-2
dependencies: []
type: docs
ordinal: 5100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner decision 2026-07-24: task tracking is fully in Backlog; TASK.md should go. Migrate its residual content (the deferred iOS port scope and the Task-13 residual: responsive / a11y / performance) into Backlog (a doc or tasks), repoint every reference to TASK.md (CLAUDE.md token-economy rules, spec/*, ARCHITECTURE.md, README), then delete TASK.md. Kept separate from the Epic/Story unification work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TASK.md residual (iOS deferred items; Task-13 responsive/a11y/perf) is captured in Backlog (doc or tasks) with no loss
- [ ] #2 every git-tracked reference to TASK.md is updated or removed (grep -r TASK.md returns only intended mentions)
- [ ] #3 TASK.md is deleted; CLAUDE.md token-economy guidance no longer points readers at it
<!-- AC:END -->
