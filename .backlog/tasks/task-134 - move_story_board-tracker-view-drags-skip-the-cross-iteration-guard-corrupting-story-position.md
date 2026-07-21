---
id: TASK-134
title: >-
  move_story_board: tracker-view drags skip the cross-iteration guard,
  corrupting story position
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 13:14'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in code review (2026-07-21) of the range following TASK-111's fix. In supabase/migrations/20260721000007_move_story_board_global_positions.sql, the cross-iteration reroute guard (~line 120) that redirects a state-bearing move to the safe backlog-splice path only fires for p_view = 'list'. For p_view = 'tracker', any story with a non-null v_new_state_id falls into the 'single' zone regardless of whether its real iteration (v_new_iteration, from the story's own iteration_id) matches the project's actual current iteration (v_current_id) at execution time. The 'single' zone's position-rewrite loop scopes by v_current_id (line ~165), while the column-end anchor pre-resolution query (~lines 133-147) scopes by v_new_iteration -- these can diverge. Concretely: finalize_iteration does not carry forward done-category stories' iteration_id on rollover, so a done-category story's iteration_id keeps pointing at a just-finalized iteration; if that iteration finalizes between a tracker-view drag being computed client-side and this RPC executing, the story's stale iteration_id still passes the RPC's staleness check (p_expected), and the position-rewrite loop then renumbers it against the new current iteration's story set while its own iteration_id column stays on the old one -- assigning a position from the wrong iteration's numbering space. The anchor mismatch can additionally make the column-end drop fallback silently place the card at the wrong spot with no error. The RPC is a plain supabase.rpc() any project member can call directly, so this is directly reachable, not only via a timing race. While fixing this, also fold in an adjacent finding: the anchor-resolution query's 3-condition scope filter (project_id / id<>v_id / iteration_id) is duplicated verbatim between its outer query and its correlated max(position) subquery instead of being factored into one CTE -- worth cleaning up in the same pass since the fix touches this exact query.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The reroute/scope logic in move_story_board treats p_view='tracker' the same as p_view='list' for the cross-iteration check -- any state-bearing move where the story's actual iteration is not distinct from the project's current iteration gets rerouted or raises the existing 'stale story state; refresh and retry' error, instead of silently renumbering into the wrong iteration's sequence
- [ ] #2 The column-end anchor-resolution query and the position-rewrite loop use the same iteration scope so they can no longer diverge
- [ ] #3 The anchor-resolution query's duplicated 3-condition filter is factored into a single CTE reused by both the max(position) lookup and the next-id lookup
- [ ] #4 A test reproduces the race (a done-category story whose iteration is finalized between staleness-check-passing input and RPC execution) and proves the RPC now rejects it or rescopes correctly instead of corrupting position
- [ ] #5 rls-security-reviewer pass is clean; migration passes local supabase db reset; pnpm test + lint green
<!-- AC:END -->
