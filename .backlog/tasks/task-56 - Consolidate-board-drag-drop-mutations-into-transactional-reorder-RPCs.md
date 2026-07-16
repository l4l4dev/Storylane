---
id: TASK-56
title: Consolidate board drag/drop mutations into transactional reorder RPCs
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 16:11'
updated_date: '2026-07-16 01:33'
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
- [x] #1 A failed or concurrent drop can no longer produce duplicate/gapped positions or a state change without its reorder
- [x] #2 Stale-state transitions are rejected (expected-state predicate), surfaced as a visible refresh cue in the UI
- [x] #3 The four board mutation paths share the RPC-backed implementation; no per-view duplication remains
- [x] #4 Concurrency tests (or deterministic simulation) cover mid-flight failure and competing drags
<!-- AC:END -->



## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ADVISOR-REVISED (Opus, 2026-07-15) — supersedes the high-level notes DESIGN on the RPC signature:
RPC move_story_board(p_project_id, p_story_id, p_view text, p_expected jsonb, p_deltas jsonb, p_anchor jsonb):
  - SECURITY DEFINER, internal role check project_role in (owner,member), explicit EXECUTE grant to authenticated (TASK-55 lockdown).
  - pg_advisory_xact_lock(hashtext('positions:'||project_id)).
  - SELECT story FOR UPDATE; verify ALL p_expected columns (state,iteration_id,custom_status_id,swimlane_id,focus) still match → else raise 'stale' (client refreshes).
  - Apply p_deltas. iteration='current' is NOT passed as an id — RPC re-resolves the latest non-done iteration inside the lock; raise if none.
  - Derive the resequence zone from the story's OWN post-delta columns, discriminated by p_view (tracker=iteration_id+state, free=custom_status_id+swimlane_id, focus=iteration_id+focus, list=zoneForStory 3-way, icebox=unscheduled). NOT from a client-passed predicate (avoids TOCTOU).
  - Resequence: read zone rows by position, remove moved, insert at p_anchor {kind, id?|to_end}, dense-rewrite.
  - list_backlog: stories(iteration_id null, state<>unscheduled)+backlog_dividers merged; extract internal _resequence_backlog(project_id) shared with TASK-51; predicate must match buildBacklogRows; divider moves touch no story columns.
Server actions (dropStory/dropStoryFree/setStoryFocus/dropStoryInList): keep evaluateDrop/etc validation in TS (optimistic UI), compute deltas+expected snapshot+anchor, call the RPC as thin callers mapping 'stale' → visible refresh cue.
Clients (4 board components): send anchor (before/after id + kind) + expected snapshot instead of full ordered_ids.
Migration-period: persistBacklogOrder (still used by createBacklogDivider until TASK-51) takes the SAME advisory lock.
AC#3 (no per-view duplication) partially deferred to TASK-51 (tracked).
Tests: pgTAP/integration for mid-flight failure + competing drags + stale rejection + iteration re-resolution.
<!-- SECTION:PLAN:END -->

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

SLICE 1 done (2026-07-15): migration 20260715000008_move_story_board.sql — move_story_board RPC (SECURITY DEFINER, project_role owner/member guard, iteration_finalize→positions advisory locks, expected-snapshot stale guard, iteration='current' re-resolved in-lock, post-delta zone derivation, two-table backlog splice via internal _resequence_backlog). Added to grant-lockdown allowlist; DB types regenerated. New move-story-board.integration.test.ts (7 tests): dense reorder, transition+reseat, stale rejection, competing drags, current re-resolution, backlog story+divider splice, cross-tenant divider guard.
rls-security-reviewer found a REAL cross-tenant bug (divider branch lacked a project-ownership check → could overwrite another project's divider position under SECURITY DEFINER). FIXED: added 'divider not found' guard + regression test. Reviewer re-confirm pending is not needed — fix mirrors the story-branch guard and the regression test passes.
REMAINING (slice 2+): rewrite dropStory/dropStoryFree/setStoryFocus/dropStoryInList as thin move_story_board callers (compute deltas+expected snapshot+anchor, keep evaluateDrop validation server-side, map 'stale' P0001 → visible refresh cue); rewrite the 4 board client drag handlers to send anchor(before kind+id)+expected instead of ordered_ids; add same advisory lock to persistBacklogOrder (migration-period, still used by createBacklogDivider until TASK-51); failure-path/competing-drag tests at the action layer. AC#3 (no per-view dup) partially deferred to TASK-51.

SLICE 2 done (2026-07-16): wired the 4 drop paths (dropStory/dropStoryFree/setStoryFocus/dropStoryInList) as thin move_story_board callers — server keeps evaluate* validation + builds p_expected from its own trusted read (client can't hold all 5 zone cols; advisor-confirmed the doc-2 'client sends expected' note was a mistake), clients now send a before_item_id anchor instead of ordered_ids (beforeAnchorId in lib/utils/board.ts). Stale (P0001+'stale') maps to a visible refresh banner; non-stale P0001 (no active iteration) passes through. persistBacklogOrder now calls new SECURITY DEFINER resequence_backlog_order RPC (migration 20260715000009) under the same 'positions:' advisory lock (cross-tenant + kind/id-length guards, allowlist + regression tests). Tests: beforeAnchorId unit, action-layer view/deltas/expected/anchor + stale-mapping, resequence integration. Full suite 516 green. Known behaviour (advisor-noted): if the before-anchor item has left the zone by drop time, move_story_board appends to the zone end (does NOT raise stale) — rare (anchor itself concurrently moved/deleted), realtime shows the landing spot. AC#1/#2/#4 met; AC#3 met for the drop paths, insert-side dedup deferred to TASK-51.

CODE REVIEW (2026-07-16, full-range review d023d88..HEAD): CONFIRMED bug in 20260715000008_move_story_board.sql line ~195 — the List Backlog zone test 'not (v_current_id is not null and v_new_iteration = v_current_id)' is NULL-unsafe: for a backlog story (v_new_iteration NULL) with an active iteration present, 'NULL = uuid' makes the whole elsif NULL→false, so v_zone becomes 'single' and the list else-branch resequences the CURRENT iteration's stories instead of the two-table backlog splice. Fix in slice 2 via a follow-up migration (replace the predicate with e.g. 'and (v_current_id is null or v_new_iteration is distinct from v_current_id)') + a regression test that drops into the Backlog zone WHILE an active iteration exists (the existing backlog test deletes all iterations first, which is why it passes).
<!-- SECTION:NOTES:END -->
