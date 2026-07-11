---
id: TASK-57
title: Transactional swap RPC for custom-status and lane moves
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:11'
updated_date: '2026-07-11 16:54'
labels:
  - concurrency
  - db
dependencies: []
priority: high
ordinal: 15800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex full-codebase review (2026-07-12), High (concurrency): moveCustomStatus and moveLane (apps/web/app/projects/[id]/settings/actions.ts:276-306, 369-404) swap neighbor positions as two independent parallel UPDATEs — no transaction or lock, so one side can fail (TASK-26 added result checks, but not atomicity) and concurrent moves work from the same stale snapshot, yielding duplicate positions. Also from the review: direction strings other than 'up' are coerced to 'down' — validate against an explicit union and reject anything else.

Fix: one transactional swap RPC (row locks or the project advisory lock) used by both statuses and lanes; input validation ('up'|'down') at the action boundary; consider a deferrable uniqueness constraint on (project_id, position) per table if compatible with the swap.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A status/lane swap is atomic: both rows move or neither does, under concurrency
- [ ] #2 Invalid direction values are rejected, not coerced
- [ ] #3 Tests cover concurrent swaps and the half-failure case
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.
<!-- SECTION:NOTES:END -->
