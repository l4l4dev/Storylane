---
id: TASK-139
title: >-
  My Work redesign: personal-project tracker detach (gate exemptions, quick-add,
  real-direct drags)
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 08:52'
updated_date: '2026-07-22 11:43'
labels: []
dependencies:
  - TASK-138
priority: high
type: feature
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-15 (advisor-approved). Fixes both 2026-07-22 dogfooding bugs permanently. (1) New migration: full replacement of set_story_state KEEPING SECURITY INVOKER (advisor: DEFINER is forbidden - it would break the RLS-based caller gating). When the story's project is_personal: skip the estimation gate block and the in_progress current-iteration auto-assign block (story stays iteration-less). (2) MyWorkQuickAdd: target='unstarted' -> 'backlog' (one line - insert_board_item already creates the iteration-less lowest-unstarted shape); KEEP defaultAssigneeId (completion trigger skips assignee-less stories - dropping it silently kills the personal Done log). (3) my-work drag write path: personal-project stories write REAL state via set_story_state resolved by category (Done -> done-category state; back-to-Todo -> lowest unstarted = reopen); Today/free columns stay local for everyone; the real-done guard now applies to team stories only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 set_story_state redefined per doc-15: is_personal skips estimation gate + iteration auto-assign; function remains SECURITY INVOKER (assert in the rls review)
- [x] #2 Adding a personal task from My Work works with zero iterations in the personal project (bug 1 fixed); created task lands in Todo assigned to the viewer
- [x] #3 Personal-task drags to Done/Todo transition the real state (completed_at + story_completions on done; reopen on todo); Today/free-column drags stay local; team stories are never written from My Work
- [x] #4 Real-done guard scoped to non-personal stories; personal real-done cards can be dragged back to Todo (reopen)
- [x] #5 rls-security-reviewer pass on the migration
- [x] #6 supabase db reset green; pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done in the continuous 138->140 pass: migration 20260722000008 (set_story_state is_personal exemptions, stays SECURITY INVOKER). MyWorkQuickAdd target unstarted->backlog. Drag write path (my-work/actions.ts): personal Todo/Done -> real set_story_state; team local; team->Done rejected; real-done guard team-only.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-opus-4-8
created: 2026-07-22 11:43
---
rls-security-reviewer finding for THIS migration specifically (set_story_state, 20260722000008_set_story_state_personal_exemptions.sql) — run together with TASK-138's migration in one combined review call on 2026-07-22, but only the my_work_columns findings were recorded on TASK-138's comment #2, leaving this AC unchecked. Recording properly now (TASK-144 follow-up), no re-run needed since the code is unchanged:

Confirmed SECURITY INVOKER via pg_proc.prosecdef = f (never redeclared DEFINER). is_personal is read from projects, which is member-visible under the existing 'members can view their projects' SELECT policy, so no privilege issue reading it under INVOKER — the RLS-based caller gating on the story's FOR UPDATE is preserved exactly as before. The two skipped gates (estimation check, in-progress auto-iteration-assign) are correctly gated behind not coalesce(v_is_personal, false), defaulting CLOSED (i.e. non-personal/full-gate behavior) if the project lookup somehow returns no row — a fail-safe default, not fail-open. No HIGH/MEDIUM/LOW findings.
---
<!-- COMMENTS:END -->
