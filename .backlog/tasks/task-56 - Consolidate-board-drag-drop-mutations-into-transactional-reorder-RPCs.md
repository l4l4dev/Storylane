---
id: TASK-56
title: Consolidate board drag/drop mutations into transactional reorder RPCs
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:11'
updated_date: '2026-07-11 19:32'
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

DESIGN (Fable, 2026-07-12 — treat as the advisor-approved design; covers TASK-51/57/58's shared foundation):
CORE DECISION: clients stop sending full position sequences. They send INTENT (move story X to zone Z before/after Y, insert item at zone bottom, swap A with its neighbor); the server derives and rewrites dense positions from CURRENT DB order inside one transaction. This eliminates the stale-client-sequence overwrite class entirely, not just its symptoms.
RPC FAMILY (one migration, all SECURITY DEFINER, internal role check project_role in (owner,member), all serialized by ONE per-project advisory lock, key 'positions:'||project_id — project-wide serialization is correct at this scale and avoids row-lock deadlock ordering):
1. move_story_board(p_story_id, p_target jsonb {zone, before_id?|after_id?|to_end}, p_expected_state text) — validates the moved story still has p_expected_state (stale-read rejection: raise, client refreshes), applies state change + iteration_id/custom_status_id + dense resequence of the affected zone(s) atomically. Backs dropStory/dropStoryFree/setStoryFocus/list drop; retires persistBacklogOrder's full-sequence model.
2. insert_board_item(p_project_id, p_kind story|divider, p_payload jsonb, p_target) — TASK-51's insert+resequence in one transaction (quickCreateStory backlog branch, createBacklogDivider, dropStoryInList insertion). Story/divider share the position sequence (spec/data-model.md), so one RPC owns that interleaving.
3. swap_adjacent(p_table in ('custom_statuses','swimlanes'), p_id, p_direction in ('up','down')) — TASK-57; rejects any other direction value; both UPDATEs in the function = atomic.
INVARIANTS (TASK-58 layer, after the RPCs land): deferrable UNIQUE (initially deferred) per position scope where the scope is a single column set; document the dense-order invariant in spec/data-model.md. max+1 creation sites (addTask, epics, lanes, recurring) either move behind insert_board_item-style allocation or take the same advisory lock.
NOTES: transitions embedded in a move fire the existing activity trigger (state column change) — no bespoke logging. Web actions become thin callers mapping RPC errors to visible UI feedback (ux-principles #2). EXECUTE granted explicitly per TASK-55's lockdown. Rollout order: TASK-56 (RPCs + 4 drop paths) → TASK-51 (3 insert sites) → TASK-57 (swaps) → TASK-58 (constraints + leftovers).
<!-- SECTION:NOTES:END -->
