---
id: TASK-134
title: >-
  move_story_board: tracker-view drags skip the cross-iteration guard,
  corrupting story position
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 13:14'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-5
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
- [x] #1 The column-end anchor-resolution query and the position-rewrite loop use the same iteration scope so they can no longer diverge
- [x] #2 The anchor-resolution query's duplicated 3-condition filter is factored into a single CTE reused by both the max(position) lookup and the next-id lookup
- [x] #3 A test reproduces the race (a done-category story whose iteration is finalized between staleness-check-passing input and RPC execution) and proves the RPC now rejects it or rescopes correctly instead of corrupting position
- [x] #4 rls-security-reviewer pass is clean; migration passes local supabase db reset; pnpm test + lint green
- [x] #5 The reroute/scope logic treats any non-'list' p_view (tracker or an unknown/forged value) the same for the cross-iteration check: a state-bearing move where the story's actual iteration IS DISTINCT FROM the current iteration (or there is no current iteration) is rejected with 'stale story state; refresh and retry' instead of silently renumbering into the wrong iteration's sequence; p_view='list' still routes such a move to the backlog splice as before
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
ONE migration (20260722000001) fixes both TASK-134 + TASK-136 (same function). Advisor-reviewed (修正付き承認).
TASK-134: (1) zone selection restructured — a state-bearing move whose destination isn't the current iteration routes to backlog for p_view='list' (legit current->backlog drag) but RAISES 'stale' for ANY non-'list' p_view (advisor hole-1: tracker OR a forged/unknown p_view, since the RPC is granted to authenticated with no enum check). (2) single-zone rewrite + column-end anchor now share one iteration scope (v_new_iteration). (3) anchor query's duplicated 3-cond filter factored into one CTE.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in 20260722000001_move_story_board_iteration_guard_range.sql. Verified: supabase db reset applies clean; integration suite move-story-board (13 tests incl. 3 new: cross-iteration tracker reject, forged p_view reject, range-limiting) + stories-write-model + grant-lockdown = 22 pass. Existing TASK-111 within-column + column-end tests still pass (range logic gives identical final positions). Fixed a pre-existing test (stories-write-model 'member move') that did a tracker move on a state-bearing BACKLOG story (iteration_id null) — per columnForStory that's never a tracker target; scheduled it into the current iteration so it's a valid target (permission assertion unchanged). Full unit suite 573 pass, lint clean. rls-security-reviewer pass pending.

rls-security-reviewer: CLEAN, no findings (auth gate first, all range UPDATEs project-scoped, raise rolls back the whole txn, search_path pinned, no dynamic SQL). All ACs met.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
move_story_board no longer corrupts position on a stale/forged cross-iteration move: a state-bearing move whose destination isn't the current iteration routes to the backlog splice for p_view='list' but is rejected with 'stale' for any other p_view (tracker or forged) — closing the done-category-story race and the direct-RPC path. The column-end anchor and the position rewrite now share one iteration scope (v_new_iteration) via a single CTE. Verified: advisor-approved, rls-security-reviewer clean, supabase db reset applies, 22 integration tests pass (incl. 3 new), unit 573 pass, lint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
