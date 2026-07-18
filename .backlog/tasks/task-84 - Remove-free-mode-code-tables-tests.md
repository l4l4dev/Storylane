---
id: TASK-84
title: 'Remove free mode (code, tables, tests)'
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:03'
updated_date: '2026-07-18 13:43'
labels:
  - web
  - db
dependencies:
  - TASK-83
priority: high
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §1: free mode is removed entirely, pre-launch, no data migration. Delete free-board UI (free-board.tsx and friends), free-mode server actions/RPCs, board column/swimlane/WIP tables and their RLS policies via a drop migration, the workflow_mode column/concept, free-mode seeds and tests. Delete existing free-mode test projects. The git tag pre-concept-redesign (at main 5930e1f) already marks the pre-removal state. Board toggle handling of the Focus view is NOT in scope here (TASK-89).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No free-mode code paths, tables, policies, types, or tests remain; database.types.ts regenerated
- [x] #2 Drop migration reviewed by rls-security-reviewer (policy removal is a security-relevant change)
- [x] #3 pnpm test passes; app boots and tracker boards work with workflow_mode gone
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by @gpt-5.6-sol (Codex), then reviewed/hardened by @claude-opus-4-8 in the same session (Claude quota was available again despite the earlier reassignment note).

Codex's implementation (file deletion, UI removal, initial migration) was verified against a REAL local Supabase (supabase db reset + SUPABASE_INTEGRATION=1 vitest) rather than Codex's sandbox, which surfaced 7 real defects the sandbox couldn't catch:
1. move_story_to_project / copy_story_to_project still read the dropped projects.workflow_mode / custom_statuses -- would crash at runtime on every cross-project move/copy. Fixed: redefined in the migration from the CURRENT (20260716000004) bodies, preserving archived_at guards + the position-sequence-default invariant (the original fix attempt was based on a stale pre-TASK-58 version and had to be corrected).
2. maintain_story_completed_at (fires on EVERY story insert/update) read workflow_mode unconditionally -- would have broken all story writes app-wide. Fixed: restored to the pre-free-mode tracker-only body.
3. finish_story_from_git (GitHub/Forgejo webhook RPC) read workflow_mode -- would break the git integration. Fixed: mode gate removed per TASK-83's already-updated spec/integrations.md.
4. log_story_activity's column_changed branch referenced the dropped custom_statuses table (unreachable today but a landmine). Fixed: restored to pre-TASK-40 body.
5. database.types.ts was regenerated against a STALE local DB (still listed the dropped swap_adjacent function) -- AC#1 says regenerated, it wasn't correctly. Fixed: regenerated against the corrected schema.
6. grant-lockdown.integration.test.ts's allowlist still listed swap_adjacent/create_project (dropped functions) -- would fail the moment SUPABASE_INTEGRATION tests actually ran. Fixed.
7. Two integration test files (move-copy.integration.test.ts, position-sequence.integration.test.ts) were deleted WHOLESALE even though most of their tests (~12 of 14, and 2 of 4 respectively) covered mode-agnostic / tracker-relevant behavior of move_story_to_project, copy_story_to_project, and the position-sequence invariant -- a real coverage regression, not just free-mode cleanup. Restored with only the genuinely free-mode-specific tests removed.

Also ran /code-review (high effort, 8 finder angles + verify pass) scoped to TASK-84's files only (there is unrelated concurrent work in the same shared worktree from other sessions -- TASK-80, TASK-90 -- explicitly excluded from this diff and untouched). Found + fixed: move_story_board still had a dead unreachable p_view='free' branch (fixed via another migration redefinition); an unused reorderable-list-manager.tsx left behind after its only two callers were deleted (deleted); two stale comments referencing deleted code (board/actions.ts "four board drop paths", dashboard/actions.ts "the RPC"/"projectId"); one now-always-true if(project) guard (simplified away); one orphaned comment in lib/types.ts. One candidate (a null-cast RPC param inherited from the original diff) was investigated and refuted as a provably-harmless, deliberately-TASK-91-deferred no-op.

rls-security-reviewer pass on the corrected migration: PASS (independently re-ran supabase db reset and queried the catalog directly -- pg_policies, pg_proc.proacl, pg_get_functiondef -- rather than trusting my claims). One finding (missing DOWN rollback block) applied.

Verification (all against a REAL local Supabase, not sandboxed): supabase db reset applies all 61 migrations cleanly; SUPABASE_INTEGRATION=1 pnpm exec vitest run = 482/482 integration tests pass; pnpm -r run test = 400/400 unit tests pass (82 skipped without SUPABASE_INTEGRATION, consistent); tsc --noEmit clean across the monorepo; ESLint clean; pnpm dev boots successfully and /auth/login renders 200 (AC#3's "app boots" -- Codex could not verify this due to sandbox networking restrictions (EPERM on port bind), I could and did).

NOT DEPLOYED to remote Supabase -- only applied locally via db reset for verification, per the task's hard constraint. The migration is supabase/migrations/20260718000001_remove_free_mode.sql, still uncommitted, ready for the owner's review before commit.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 03:20
---
Advisor 2nd pass: stay a pure drop migration. Do NOT rename or reuse custom_statuses as project_states (free-mode leftovers like is_done/wip_limit would pollute it and muddy the RLS review) — TASK-91 creates the new table fresh.
---

created: 2026-07-18 06:29
---
Reassigned to @gpt-5.6-sol (2026-07-18, Claude quota exhausted): implement per the task + spec (TASK-83 landed). CONDITION: the drop migration must NOT be deployed until rls-security-reviewer passes it after Claude quota returns — leave the migration committed locally and flag it in the final summary.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed free mode entirely (code, tables, tests) per doc-8 sec1. Initial implementation by Codex (GPT-5.6), then reviewed, corrected, and re-verified by @claude-opus-4-8 against a real local Supabase (sandbox verification wasn't reliable) -- 7 real defects found and fixed (workflow_mode/custom_statuses references left in move_story_to_project, copy_story_to_project, maintain_story_completed_at, finish_story_from_git; a stale database.types.ts; a stale grant-lockdown allowlist; two wholesale-deleted integration test files that had also covered mode-agnostic tracker behavior, restored minus the genuinely free-mode-specific tests). A further /code-review pass (high effort) found and fixed a dead move_story_board branch, an unused component, and two stale comments.

Verified: supabase db reset applies all 61 migrations cleanly; SUPABASE_INTEGRATION=1 vitest = 482/482 integration tests pass; pnpm -r run test = 400/400 unit tests pass; tsc --noEmit clean; ESLint clean; rls-security-reviewer pass (one DOWN-block finding fixed); pnpm dev boots and /auth/login renders 200.

Migration supabase/migrations/20260718000001_remove_free_mode.sql is NOT deployed to remote -- local-only per the task's hard constraint. Everything is staged for commit, not yet committed.
<!-- SECTION:FINAL_SUMMARY:END -->
