---
id: TASK-136
title: >-
  move_story_board: within-column drag now re-densifies the whole iteration
  under a project-wide lock
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 13:14'
updated_date: '2026-07-22 00:54'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in code review (2026-07-21). TASK-111's fix widened move_story_board's single-zone position-rewrite loop from scoping by (iteration_id, state_id) -- one state column -- to scoping by iteration_id alone (every column in the current iteration), to fix List/Kanban ordering consistency. Correct for cross-column consistency, but as a side effect a plain within-column reorder drag (dragging a card up/down inside the same Kanban column, no state/iteration change) now re-densifies every column's positions in one pass, via N individual per-row UPDATE statements rather than a set-based bulk write, while holding the same project-wide pg_advisory_xact_lock (iteration_finalize:<project_id>) that finalize_iteration also takes. On a board with many columns/stories, a single drag now holds that lock proportionally longer than before TASK-111, serializing concurrent drags and iteration finalization for that much longer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The position-rewrite write is a single set-based statement (e.g. via unnest(...) with ordinality) rather than N individual per-row UPDATEs, for whichever scope ends up being rewritten
- [x] #2 rls-security-reviewer pass is clean if grants/policies are touched; migration passes local supabase db reset; pnpm test + lint green
- [x] #3 A reorder only rewrites positions in the AFFECTED RANGE (between the moved story's old position and its target position within the one iteration-wide sequence), not the whole iteration -- rows outside that range keep their position untouched, regardless of which column they're in, preserving TASK-111's single dense iteration-wide order
- [x] #4 A move that newly ENTERS the scope (backlog/Icebox -> current iteration) has no old position in the sequence, so it shifts target..end and is O(N) worst case; this is inherent to dense-integer positions and out of scope here -- documented as a why-not in the migration
- [x] #5 An integration test proves a short-distance reorder leaves out-of-range rows' positions untouched (not just 'same column'), and that both List-view (cross-column flatten) and Kanban within-column ordering remain correct afterward
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Same migration as TASK-134. Advisor corrected my original plan: NOT column-scoped (would break TASK-111's dense iteration-wide sequence) and NOT just a whole-iteration bulk UPDATE (still O(N) rows). Correct unit = AFFECTED RANGE [least(old,target), max(old,target)]: an in-scope reorder shifts only that range via one set-based UPDATE (+ one row for the moved story); rows outside keep their position. A move ENTERING the scope (no old slot) shifts target..end (O(N) worst case, inherent to dense ints — documented as a why-not).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in the same 20260722000001 migration. Range-limiting proven by an integration test using a gap sentinel (Finished parked at 20/21; a short Started reorder leaves them at 20/21 — a whole-iteration re-densify would collapse them to 3/4). db reset clean; 22 integration tests pass; unit 573 pass; lint clean.

rls-security-reviewer: CLEAN (shared with TASK-134's migration). All ACs met.

/code-review high (3 finders + hand-verify) caught a REAL BUG in my first cut: the append path used v_target := count(*) as the end index, which only equals max+1 when positions are DENSE. Positions go sparse in production (a List current→backlog drag and finalize_iteration each vacate an iteration slot and never re-densify), so an appended card landed MID-sequence instead of last. Fixed: append now uses coalesce(max(position),-1)+1 and does no shift (the card jumps past the max; its old slot is left as a gap, consistent with the gap-tolerant model). Dropped the now-unused v_n_others. Also closed the coverage gaps the review flagged: added integration tests for append-into-a-gap (the bug repro — fails on the count() version), in-scope DOWN move (only up-moves were tested), ENTERING into a POPULATED iteration (prior entering test had n_others=0), and Icebox null-scope reorder. Re-verified: db reset applies; move-story-board 17 pass, stories-write-model + grant-lockdown 9 pass, unit 573 pass, lint clean. RLS unaffected (append query keeps the same project_id + scope filter; no auth/grant/search_path change) so the prior rls-security-reviewer pass still holds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A reorder now rewrites only the affected position range (between the moved story's old and target slot) via set-based range UPDATEs, not the whole iteration via N per-row UPDATEs — cutting advisory-lock hold time while preserving TASK-111's single dense iteration-wide sequence (out-of-range rows keep their position, proven by a gap-sentinel integration test). A move entering the scope still shifts target..end (O(N), inherent to dense-integer positions, documented as a why-not). Verified alongside TASK-134 in migration 20260722000001.
<!-- SECTION:FINAL_SUMMARY:END -->
