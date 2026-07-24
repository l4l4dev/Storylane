---
id: TASK-180
title: Roll-up + board/velocity/My Work integration for containers
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
updated_date: '2026-07-24 04:22'
labels: []
milestone: m-6
dependencies:
  - TASK-179
documentation:
  - doc-18
type: feature
ordinal: 1900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Exclude containers from board/velocity/My Work via one is_container=false filter, and compute container progress as a read-side roll-up (doc-18 §5).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 backlog zone predicate gains is_container=false, mirrored in _splice_backlog, move_story_board, buildBacklogRows, zoneForStory
- [ ] #2 velocity points-counted, auto-assign, and virtual-group walk exclude containers; children count as terminal stories
- [ ] #3 My Work assigned-stories query excludes containers
- [ ] #4 container roll-up (headline state + point sum from children per doc-18 §5 rule) is a packages/core pure function with golden fixtures (Web/iOS parity); never fed into velocity
- [ ] #5 set_story_state rejects is_container=true stories with a clear message (container has no board state) — the guard is in the RPC, not only the UI (doc-18 §4)
- [ ] #6 roll-up rule handles partial completion: not-all-done + any done/in_progress/rejected child => in_progress (never falls through to unstarted); matches doc-18 §5
<!-- AC:END -->
