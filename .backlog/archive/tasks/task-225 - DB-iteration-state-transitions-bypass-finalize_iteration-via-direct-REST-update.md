---
id: TASK-225
title: >-
  DB: iteration state transitions bypass finalize_iteration via direct REST
  update
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-07-30 12:32'
updated_date: '2026-07-30 13:30'
labels: []
milestone: m-2
dependencies: []
priority: high
type: bug
ordinal: 1290
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Raised by fable-advisor and rls-security-reviewer during TASK-222, independently. Not a regression from that change — the gap predates it and TASK-222 only documented it.

`iterations` carries `members can update iterations` FOR UPDATE with USING and WITH CHECK scoped by `project_role(project_id)` alone — no column restriction. Any project member can PATCH /iterations?id=eq.X with {"state":"done"} straight through PostgREST: the advisory key `iteration_finalize:<project>` is skipped, and so are finalize_iteration's velocity/capacity computation and its reparenting of open stories. The only existing guard, iterations_reject_finalized_metric_edit, rejects velocity/capacity edits on an already-done iteration; it does not police the state column itself.

Every board RPC that reads iterations.state (split_story after 20260730040000, create_draft_story, set_story_state) now takes the key, so the RPC side is consistent. What is missing is the DB-level guarantee that the key is the only way state moves — spec/rls.md records this as a 'convention only RPCs follow' and names a trigger as what would close it.

Same class as TASK-208, which closed the equivalent hole on stories. Candidate mechanisms: a BEFORE UPDATE trigger rejecting a state change that did not come from the finalization path, or splitting the UPDATE policy so members can write goal/retro_notes only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A direct PATCH of iterations.state by a member is rejected at the database level, with a test that performs it through PostgREST rather than through an RPC
- [ ] #2 finalize_iteration and reshape_current_iteration still transition state normally, with the existing iteration tests unchanged
- [ ] #3 The web app's direct writes to goal and retro_notes (board/actions.ts) keep working
- [ ] #4 spec/rls.md's iterations.state paragraph is updated: the gap it currently describes as open is closed, or the remaining part of it is stated precisely
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Archived without work: the premise is false.

The task claimed a project member could PATCH /iterations?id=eq.X {"state":"done"} straight through PostgREST, bypassing finalize_iteration. Codex found on PR #14 that column privileges already refuse it, and the live catalog confirms:

  has_table_privilege('authenticated','public.iterations','update')            -> f
  has_column_privilege('authenticated','public.iterations','state','update')   -> f
  has_column_privilege('authenticated','public.iterations','goal','update')    -> t
  has_column_privilege('authenticated','public.iterations','retro_notes',...)  -> t

20260720000002_iteration_capacity.sql:37 revokes table UPDATE from authenticated and grants back only goal; 20260727130000_grant_iteration_retro_notes.sql:13 adds retro_notes. The column privilege is checked before the row-level policy, so the 'members can update iterations' policy having no column restriction does not matter — every writer of iterations.state is a SECURITY DEFINER RPC, and each of them takes iteration_finalize:<project>.

How the wrong premise survived three reviews: fable-advisor, rls-security-reviewer and /code-review high all read pg_policies and stopped there. None checked the column grants, and the task was created on their agreement. spec/rls.md's iterations.state paragraph carried the same error and was corrected in the same PR.
<!-- SECTION:NOTES:END -->
