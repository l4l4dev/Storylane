---
id: TASK-119
title: Shared pendingKey in task-checklist lets a second delete fire mid-flight
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 11:00'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #11. apps/web/components/features/story/task-checklist.tsx:29 uses one shared pendingKey string (not per-task) for every task's busy-lock. Clicking Delete on task A then Toggle on task B before A resolves re-enables A's Delete button while A's delete is still in flight.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 task-checklist.tsx's busy-lock is scoped per-task (not one shared pendingKey), so a second task's action can never re-enable a different task's in-flight control
- [ ] #2 A test proves the double-delete race is closed
- [ ] #3 pnpm test + lint green
<!-- AC:END -->
