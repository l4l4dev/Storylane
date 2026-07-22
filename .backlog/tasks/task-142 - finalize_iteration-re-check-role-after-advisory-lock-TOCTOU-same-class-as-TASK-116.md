---
id: TASK-142
title: >-
  finalize_iteration: re-check role after advisory lock (TOCTOU, same class as
  TASK-116)
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 09:04'
updated_date: '2026-07-22 10:18'
labels: []
dependencies: []
priority: medium
type: bug
ordinal: 500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-116 (comment there, 2026-07-22): doc-13's claim that finalize_iteration 're-derives authorization after the lock' is wrong - it has the same TOCTOU hole the cadence RPCs had: role is checked before acquiring the advisory lock, so a caller de-membered while blocked on the lock still executes the finalization. Fix with the exact TASK-116 pattern: re-run require_project_role() immediately after lock acquisition (READ COMMITTED gives each statement a fresh snapshot), unifying pre/post guards on the require_project_role helper (spec/rls.md 'RPC role guards'). Full-function replacement migration; finalize_iteration is the shared lazy-rollover/manual-finish path, so behavior must stay otherwise identical. Add a deterministic concurrency test like TASK-116's (raw pg connection holds the lock -> revoke -> expect 42501); pg devDependency already available.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New migration redefines finalize_iteration with require_project_role re-checked after the advisory lock; body otherwise verbatim
- [x] #2 Deterministic concurrency test: caller de-membered while blocked on the lock gets 42501 and no finalization side effects
- [x] #3 rls-security-reviewer pass on the migration
- [x] #4 SUPABASE_INTEGRATION suite + pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260722000010: full replacement of finalize_iteration (base = 20260720000006_flexible_cadence.sql, the latest definition). Body verbatim except the guards.
2. Convert both pre-lock inline guards to require_project_role per spec/rls.md 'RPC role guards' (convert-on-touch policy). CRITICAL: preserve the role sets exactly - manual = owner/member, lazy rollover = owner/member/VIEWER (the current is_project_member allows viewers, and a viewer opening the board must still trigger rollover). Hoist the role list into a v_roles variable so pre and post checks can never drift apart.
3. Add the post-lock re-check (perform require_project_role with the same v_roles) right after pg_advisory_xact_lock - the TOCTOU fix.
4. Note the user-visible message change: the descriptive 'Only project owners or members can finish an iteration' / 'Not a member of this project' become 'not authorized' (42501), which is the documented helper behavior in spec/rls.md. Surface this to the owner.
5. Deterministic concurrency test (TASK-116 pattern): raw pg connection holds the advisory lock, revoke membership, expect 42501 and no finalization side effects.
6. rls-security-reviewer pass; SUPABASE_INTEGRATION suite + pnpm test + lint green.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: migration 20260722000010, full replacement of finalize_iteration. Post-lock require_project_role re-check added; both pre-lock inline guards converted to the helper per spec/rls.md convert-on-touch. Role sets preserved exactly and hoisted into v_roles so pre/post can never drift: manual = owner/member, lazy rollover = owner/member/VIEWER (the old is_project_member allowed any role). Diff-verified body-verbatim otherwise.

PROVEN, not assumed: temporarily loaded the OLD body via psql and re-ran the new test - the TOCTOU cases fail with error === undefined (the de-membered caller successfully finalized), and pass with 42501 once the fixed body is loaded.

ADJACENT FIX (surfaced to owner): TASK-116's two committed concurrency tests were VACUOUS - supabase-js's builder is a lazy thenable, so 'const p = supabase.rpc(...)' without awaiting dispatches nothing; the revoke landed before the RPC started, meaning they asserted the PRE-lock guard. Verified by stripping the post-lock re-checks from the cadence RPCs: all 15 tests still passed. Fixed both (Promise.resolve assimilation forces dispatch) and re-verified they now fail without the re-check and pass with it.

BEHAVIOR CHANGE to flag: the descriptive P0001 messages ('Only project owners or members can finish an iteration' / 'Not a member of this project') are now 'not authorized' (42501). Documented helper behavior; no production code branches on the old strings (only UI tests that mock arbitrary error text).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-opus-4-8
created: 2026-07-22 10:18
---
rls-security-reviewer: CLEAN, no HIGH/MEDIUM/LOW findings. Confirmed (a) role sets preserved exactly incl. the viewer-inclusive lazy path, (b) each PL/pgSQL perform gets its own READ COMMITTED snapshot so STABLE caching can't defeat the re-check, (c) body byte-identical to 20260720000006 outside the guards, (d) errcode change matches spec/rls.md and nothing branches on the old strings. Noted for the owner as a SEPARATE potential backlog item (explicitly out of scope here, pre-existing): a viewer can trigger lazy rollover, which writes (finalizes/inserts iterations, moves stories.iteration_id).
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed finalize_iteration's TOCTOU hole (migration 20260722000010): require_project_role is now re-asserted immediately after pg_advisory_xact_lock, so a caller de-membered while blocked on the lock can no longer finalize. Both pre-lock inline guards converted to the same helper per spec/rls.md, with the role sets hoisted into v_roles so pre/post can never drift - manual stays owner/member, lazy rollover stays owner/member/viewer (the old is_project_member allowed any role). Body otherwise diff-verified verbatim. Verified by loading the OLD body and re-running the new integration test: the TOCTOU cases fail with error === undefined (de-membered caller still finalized) and pass with 42501 once fixed. Also fixed TASK-116's two concurrency tests, which were vacuous - supabase-js's lazy thenable meant they never dispatched before the revoke, so they asserted the pre-lock guard; proven by stripping the cadence RPCs' post-lock re-checks and watching all 15 still pass. rls-security-reviewer: clean. tsc + eslint clean; full suite 817 pass with only the 2 known pre-existing unrelated failures.
<!-- SECTION:FINAL_SUMMARY:END -->
