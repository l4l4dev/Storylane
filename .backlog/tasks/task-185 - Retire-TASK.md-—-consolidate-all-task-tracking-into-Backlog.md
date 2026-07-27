---
id: TASK-185
title: Retire TASK.md — consolidate all task tracking into Backlog
status: In Progress
assignee:
  - '@codex-gpt-5'
created_date: '2026-07-24 04:08'
updated_date: '2026-07-27 06:22'
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
- [x] #1 TASK.md residual (iOS deferred items; Task-13 responsive/a11y/perf) is captured in Backlog (doc or tasks) with no loss
- [x] #2 every git-tracked reference to TASK.md is updated or removed (grep -r TASK.md returns only intended mentions)
- [x] #3 TASK.md is deleted; CLAUDE.md token-economy guidance no longer points readers at it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Preserve the deferred iOS scope in a numbered Backlog document.
2. Create a milestone- and assignee-owned task for the residual Web responsive, accessibility, and performance work.
3. Repoint live references to Backlog and remove the legacy task-list file.
4. Verify tracked references, deletion, Backlog content, and unrelated working-tree scope.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation 2026-07-27: the retired file is absent; git grep shows only TASK-185 itself and two immutable completed-task history mentions; doc-22 preserves every deferred iOS item and sequencing constraint; TASK-217 tracks the Web responsive/accessibility/performance residual; git diff --check passes; unrelated in-progress paths remain outside this task diff.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-27 06:14
---
Delegated to Codex CLI (@codex-gpt-5, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available, task is mechanical/precisely-scoped so it fits the delegation policy without RLS/architecture concerns.
---
<!-- COMMENTS:END -->
