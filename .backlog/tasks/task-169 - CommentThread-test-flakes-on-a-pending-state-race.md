---
id: TASK-169
title: CommentThread test flakes on a pending-state race
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 04:01'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review (2026-07-23) found apps/web/components/features/story/comment-thread.test.tsx:69 asserts the pending comment state clears without properly waiting for it to resolve, causing intermittent failures under load/timing variance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The test waits for the pending state to resolve via waitFor/findBy queries instead of assuming synchronous resolution
- [ ] #2 The test passes consistently across repeated local runs (e.g. vitest run --repeat=10 or equivalent) with no flakes
<!-- AC:END -->
