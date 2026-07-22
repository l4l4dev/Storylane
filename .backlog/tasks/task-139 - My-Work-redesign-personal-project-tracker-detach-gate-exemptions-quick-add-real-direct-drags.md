---
id: TASK-139
title: >-
  My Work redesign: personal-project tracker detach (gate exemptions, quick-add,
  real-direct drags)
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 08:52'
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
- [ ] #1 set_story_state redefined per doc-15: is_personal skips estimation gate + iteration auto-assign; function remains SECURITY INVOKER (assert in the rls review)
- [ ] #2 Adding a personal task from My Work works with zero iterations in the personal project (bug 1 fixed); created task lands in Todo assigned to the viewer
- [ ] #3 Personal-task drags to Done/Todo transition the real state (completed_at + story_completions on done; reopen on todo); Today/free-column drags stay local; team stories are never written from My Work
- [ ] #4 Real-done guard scoped to non-personal stories; personal real-done cards can be dragged back to Todo (reopen)
- [ ] #5 rls-security-reviewer pass on the migration
- [ ] #6 supabase db reset green; pnpm test + lint green (from apps/web/)
<!-- AC:END -->
