---
id: TASK-70
title: >-
  Align board write-permission model: move_story_board vs transition_story vs
  stories UPDATE RLS
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-17 13:14'
labels:
  - web
  - db
  - security
milestone: m-2
dependencies: []
priority: high
ordinal: 1100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review 2026-07-17 (verified in-session): the stories UPDATE RLS policy (20260627000005) restricts a member to stories they created or are assigned, and transition_story enforces the same rule (runs under RLS, fail-closed). But move_story_board is SECURITY DEFINER and only checks require_project_role(owner|member), and applies caller-supplied p_deltas (including state) without further checks — so any member can change any story's state/status/lane via a direct RPC call (PostgREST), bypassing both the RLS rule and evaluateDrop. Two write paths now enforce different permission rules for the same conceptual operation. Owner decision needed first: EITHER (a) Pivotal-style — any member may operate any story on the board; then relax transition_story/stories-UPDATE to match and document in spec/rls.md; OR (b) keep the strict rule; then move_story_board must apply the same author/assignee check (and the board UI must disable drags on others' stories). Then align all three surfaces + tests.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Owner decision recorded (a or b) in spec/rls.md
- [ ] #2 move_story_board, transition_story, and the stories UPDATE policy enforce the same rule; integration test proves a non-author non-assignee member is treated identically on all three paths
- [ ] #3 rls-security-reviewer pass on the resulting migration
<!-- AC:END -->
