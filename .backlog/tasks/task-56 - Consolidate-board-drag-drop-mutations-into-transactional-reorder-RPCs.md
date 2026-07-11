---
id: TASK-56
title: Consolidate board drag/drop mutations into transactional reorder RPCs
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:11'
updated_date: '2026-07-11 17:26'
labels:
  - concurrency
  - db
  - refactor
milestone: m-2
dependencies: []
priority: high
ordinal: 15700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex full-codebase review (2026-07-12), High (concurrency + maintainability): dropStory / dropStoryFree / setStoryFocus / list drop / persistBacklogOrder (apps/web/app/projects/[id]/board/actions.ts) each change the dragged story and then fire many independent position UPDATEs via Promise.all. A mid-flight failure leaves the state change plus partial reordering (duplicate/gapped positions); concurrent drags overwrite each other from stale client sequences; the transition validation itself is a stale read (validate-then-write with no state predicate). The four paths also duplicate the fetch/validate/update/reorder logic, so fixes drift.

Fix: a small set of transactional Postgres RPCs (advisory or row locks per project/zone) that validate the submitted ordering against current state and apply state + positions atomically; transition updates carry the expected old state in the predicate and reject 0 rows. Web actions become thin callers. This is the same DB-consolidation direction as the MCP write-path rules (spec/mcp.md) and TASK-50 — align RPC naming/shape with that work. Large + concurrency-sensitive: get the RPC design advisor-reviewed (Opus) before the migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A failed or concurrent drop can no longer produce duplicate/gapped positions or a state change without its reorder
- [ ] #2 Stale-state transitions are rejected (expected-state predicate), surfaced as a visible refresh cue in the UI
- [ ] #3 The four board mutation paths share the RPC-backed implementation; no per-view duplication remains
- [ ] #4 Concurrency tests (or deterministic simulation) cover mid-flight failure and competing drags
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Overlap note (2026-07-12): TASK-51 (insert+resequence RPC for quickCreateStory/createBacklogDivider/dropStoryInList, from the TASK-36 advisor review) is the same consolidation for the insertion side — design the RPC family together and share the position logic. TASK-58 items 2-3 defer to this task's position rules.

Full Codex report: backlog doc-1 (.backlog/docs/reviews/) — read the matching finding before implementing.
<!-- SECTION:NOTES:END -->
