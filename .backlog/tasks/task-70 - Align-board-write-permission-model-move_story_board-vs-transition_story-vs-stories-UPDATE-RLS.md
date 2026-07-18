---
id: TASK-70
title: >-
  Align board write-permission model: move_story_board vs transition_story vs
  stories UPDATE RLS
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-17 13:14'
updated_date: '2026-07-18 03:22'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: @l4l4dev
created: 2026-07-17 13:31
---
Owner decision 2026-07-17: option (a) — Pivotal-style. Any member may operate any story on the board (move, reorder, transition); viewer stays read-only. Implementation direction: relax the stories UPDATE policy and transition_story's ownership check to project_role in (owner, member), keep move_story_board as-is, and document the rule in spec/rls.md. The strict author/assignee rule is dropped everywhere so all three surfaces agree.
---

created: 2026-07-18 02:59
---
Concept redesign impact (doc-8, 2026-07-18): free mode and the Focus view are being removed (§1, §9), so the lane/focus-bucket surface of move_story_board shrinks to List/Kanban state moves — re-check p_deltas scope against the post-removal board before aligning the three write paths. The new per-user today pin (§9) is a separate user-scoped table, NOT a story mutation, so it must not go through move_story_board. The owner decision in AC #1 (Pivotal-style vs strict) is unchanged and still required first.
---

created: 2026-07-18 03:20
---
Advisor 2nd pass (doc-8 §2): this tasks AC#1 owner decision (any-member vs author/assignee) is now a hard prerequisite for TASK-91 — set_story_state (which replaces transition_story) cannot be designed until the permission model is decided. Decision needed from the owner: (a) Pivotal-style, any member may operate any story; or (b) strict author/assignee rule on all three write paths.
---

created: 2026-07-18 03:22
---
OWNER DECISION 2026-07-18: (a) Pivotal-style — any project member may operate any story on the board. Implementation direction: relax the stories UPDATE RLS policy (and drop the author/assignee check from the transition path) to match move_story_board; document the model in spec/rls.md; test that a non-author non-assignee member is treated identically on all write paths. Note: transition_story itself is replaced by set_story_state in TASK-91 — this task delivers the RLS relaxation + spec documentation that TASK-91 builds on (SECURITY INVOKER set_story_state needs the relaxed policy to work for non-authors), so implement TASK-70 before or as the first step of TASK-91.
---
<!-- COMMENTS:END -->
