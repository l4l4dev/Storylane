---
id: TASK-220
title: >-
  split_story takes the source row lock before positions, inverting the board
  RPC lock order
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-29 10:08'
labels: []
milestone: m-2
dependencies: []
priority: medium
type: bug
ordinal: 1235
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
split_story (supabase/migrations/20260728073000_recheck_role_after_lock.sql, function body around L505-L545) reads the source story with FOR UPDATE and only afterwards takes pg_advisory_xact_lock('positions:<project>'). Every other board RPC takes the reverse order: insert_board_item, move_story_board and create_draft_story take positions first and then row-lock stories (via _splice_backlog or the position range shift).

That is an AB-BA pair. Concrete deadlock: T1 quick-adds into the backlog anchored before story S — it holds positions and its splice UPDATE waits on S's row lock — while T2 splits S, holding S's row lock and waiting on positions. One of them dies with 40P01.

Found by /code-review high on TASK-212 (fix/create-draft-story-atomic). It is pre-existing, not introduced by that branch, so it was left out of scope there. It also fell outside TASK-212's audit of iteration_finalize acquisition order, because split_story never takes iteration_finalize.

The fix is to hoist the positions lock above the FOR UPDATE read, which needs care: the read doubles as the authorization check (its membership subquery is what collapses 'not yours' into 'Story not found'), and the project_id used to build the lock key currently comes from that same read. TASK-211's exit-guard shape and the existing require_project_role recheck after the lock are the precedent to follow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 split_story acquires positions:<project> before taking any row lock on stories, matching insert_board_item / move_story_board / create_draft_story
- [ ] #2 Hoisting the lock does not weaken the authorization or leak the existence of a story in a project the caller cannot see
- [ ] #3 An integration test drives the T1/T2 interleaving above and fails with 40P01 against the current function
- [ ] #4 The lock-order invariant stated in the create_draft_story migration header is extended to cover the positions/row-lock pair, or moved somewhere both functions point at
<!-- AC:END -->
