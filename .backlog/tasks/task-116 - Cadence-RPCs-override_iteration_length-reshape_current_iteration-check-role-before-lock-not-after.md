---
id: TASK-116
title: >-
  Cadence RPCs (override_iteration_length / reshape_current_iteration) check
  role before lock, not after
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 10:59'
updated_date: '2026-07-22 08:27'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 11300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-13 finding #8. Both supabase/migrations/20260720000006_flexible_cadence.sql:146 and 20260721000005_reshape_current_iteration.sql:34 check the caller's project role before taking the advisory lock and never re-check after, unlike finalize_iteration/transition_story/set_story_state which re-derive authorization after locking to close a role-revoked-mid-flight race.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 override_iteration_length and reshape_current_iteration re-check the caller's project role immediately after acquiring the advisory lock, matching finalize_iteration's pattern
- [x] #2 A concurrency test proves a role revoked between the initial check and the lock is caught by the post-lock re-check
- [x] #3 Migration passes rls-security-reviewer; pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-22 08:27
---
IMPORTANT correction: doc-13 finding #8 and this task's AC state that finalize_iteration/transition_story/set_story_state 're-derive authorization after locking'. On reading the code (confirmed by fable-advisor + rls-security-reviewer): finalize_iteration does NOT re-check role after its lock — the claim is factually wrong for it. transition_story/set_story_state achieve it only because they are SECURITY INVOKER and RLS re-evaluates the stories UPDATE policy on their final UPDATE (row_count=0 -> 42501). The two cadence RPCs are SECURITY DEFINER, so RLS doesn't apply inside them; the fix is an explicit post-lock require_project_role() re-check (project_role reads a fresh per-statement snapshot under READ COMMITTED). Both reviews confirmed this is correct. FOLLOW-UP (out of scope, needs a separate task): finalize_iteration has the SAME missing post-lock re-check — proposing to the owner as a new Backlog task, not filing unilaterally.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
override_iteration_length and reshape_current_iteration now re-check the caller's project role immediately after acquiring the iteration_finalize advisory lock (migration 20260722000006), closing a TOCTOU window where a caller de-membered while blocked on the lock would still mutate. Both pre- and post-lock checks were converted to the require_project_role helper per spec/rls.md 'RPC role guards'. Added a deterministic concurrency test for BOTH RPCs (raw pg connection holds the lock, owner is revoked mid-wait, RPC then fails 42501) — required adding pg + @types/pg as devDependencies (the only way to hold an advisory lock across statements; supabase-js can't). fable-advisor + rls-security-reviewer both approved with no findings. NOTE: finalize_iteration has the same missing re-check (doc-13's claim it already re-checks was wrong) — flagged for a follow-up task.
<!-- SECTION:FINAL_SUMMARY:END -->
