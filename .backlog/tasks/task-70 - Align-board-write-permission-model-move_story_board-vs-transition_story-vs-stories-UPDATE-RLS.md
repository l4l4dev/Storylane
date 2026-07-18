---
id: TASK-70
title: >-
  Align board write-permission model: move_story_board vs transition_story vs
  stories UPDATE RLS
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-17 13:14'
updated_date: '2026-07-18 17:29'
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
- [x] #1 Owner decision recorded (a or b) in spec/rls.md
- [x] #2 move_story_board, transition_story, and the stories UPDATE policy enforce the same rule; integration test proves a non-author non-assignee member is treated identically on all three paths
- [x] #3 rls-security-reviewer pass on the resulting migration
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
fable-advisor reviewed 2026-07-19: approve-with-corrections, incorporated below.

1. New migration (supabase/migrations/): drop policy "owners or authors can update stories" on stories; create policy "members can update stories" for update to authenticated using (project_role(project_id) in ('owner','member')) with check (same) -- single unconditional policy, not split by role (matches the existing tasks/story_labels pattern). Header notes: TASK-70 owner decision (a); transition_story's compiled-in denial message ("you are not its owner, author, or assignee") is now stale but left as-is since TASK-91's set_story_state replaces the whole function -- it only surfaces for a viewer or a mid-request role-revocation race now. Do not touch old migration files (20260627000005, 20260708000003, 20260710000001, 20260717000004) -- frozen history.

2. spec/rls.md: reword the top-line "member role: SELECT/INSERT/UPDATE (own stories or assigned stories)" bullet so it no longer contradicts the stories-specific carve-out; upgrade the TASK-70 note from "prerequisite, not yet landed" to "implemented" with the final policy shape; note stories DELETE and promote_story_to_epic stay owner-only (unchanged, out of scope -- decision (a) is about board operations, not deletion).

3. spec/mcp.md "Row-count verification everywhere": rewrite to describe the new model (any member may write any story; a 0-row result is now only a residual defensive check for races -- story deleted mid-request, or role revoked mid-request, matching transition_story's own re-check).

4. apps/mcp/src/handlers.ts: rename/repurpose notAuthorOrAssignee() to a generic "story not found or you're no longer able to write it" fallback; DELETE the 42501 special-case branch in updateStory (handlers.ts:421-426) entirely -- it becomes unreachable once USING=WITH CHECK, fold into the generic "Could not update story" error. Leave createStory's 42501 handler untouched (INSERT WITH CHECK, still reachable for viewers).

5. Flip the two MCP integration tests (handlers.integration.test.ts) that assert denial for a non-author/non-assignee member to assert SUCCESS instead, reusing the ownerStoryId fixture.

6. New apps/web/lib/utils/stories-write-model.integration.test.ts: prove AC#2's "identical treatment" claim in one place -- a non-author, non-assignee project MEMBER succeeds via (a) direct stories UPDATE, (b) transition_story(), (c) move_story_board(), all on the same/equivalent story. ALSO add the viewer-denial coverage that would otherwise disappear (advisor caught: no existing web test covers viewer denial on transition_story/move_story_board at all) -- same three paths, viewer role, all still denied.

7. Note in this task's implementation notes (not a code change): the board's per-story "estimate" action (apps/web/app/projects/[id]/board/actions.ts ~line 548, a direct stories UPDATE) was silently broken for non-author/non-assignee members under the old policy and is fixed as a side effect of step 1 -- worth flagging as a hidden bug this task incidentally resolves.

8. rls-security-reviewer pass on the migration (AC#3). Full pnpm test + SUPABASE_INTEGRATION=1 vitest verification against a real local Supabase before considering done, per the TASK-84 lesson (sandbox/stale-state verification gaps).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fable-advisor reviewed the implementation plan before coding (approve-with-corrections): confirmed a 4th write surface (board/actions.ts's estimate action, direct stories UPDATE) was silently broken for non-author/non-assignee members under the old policy and is fixed as a side effect; confirmed tasks/story_labels already matched the target model (no sweep needed); caught that the updateStory 42501 special-case branch becomes unreachable and should be deleted, not reworded; caught that removing the two MCP denial tests would leave zero viewer-denial coverage on transition_story/move_story_board, so the new web test adds it.

Implemented: new migration supabase/migrations/20260719000002_relax_stories_write_rls.sql (drops "owners or authors can update stories", replaces with a single "members can update stories" policy: project_role(project_id) in ('owner','member') for USING and WITH CHECK -- matches move_story_board's existing SECURITY DEFINER check, so all four write surfaces (direct UPDATE, update_story, transition_story, move_story_board) now agree). spec/rls.md and spec/mcp.md updated to document the landed model. apps/mcp/src/handlers.ts: renamed notAuthorOrAssignee() to storyNoLongerWritable() (now a residual race-condition fallback, not the primary gate), deleted the now-unreachable 42501 special case in updateStory. Flipped the two MCP integration tests that asserted denial to assert success for a non-author/non-assignee member. New apps/web/lib/utils/stories-write-model.integration.test.ts proves AC#2's "identical treatment" claim directly: a plain member succeeds via direct UPDATE + transition_story + move_story_board on the same story shape, and a viewer is denied on all three (coverage that would otherwise have disappeared).

rls-security-reviewer pass (AC#3): independently ran supabase db reset, queried pg_policies/pg_constraint/pg_proc directly, and exercised owner/member/viewer against real UPDATE/DELETE/RPC calls. Verdict: correct, matches owner decision (a) precisely, DELETE and promote_story_to_epic confirmed untouched, no other table needed sweeping, project_role() NULL-for-non-member behavior confirmed excluded correctly. Two trivial nitpicks (a migration comment's wrong file reference, one other stale comment) fixed.

/code-review (high effort, 8 finder angles + verify pass) on the scoped diff: 2 findings confirmed and fixed (spec/mcp.md still justified an create_story position restriction via a now-false RLS claim; the new test's independent user-setup calls were sequential instead of parallel). One finding refuted (a pre-existing web unit test asserting the RPC's literal denial message is a passthrough-mechanism test, not a policy-correctness test -- not stale). Six comment-history-narration findings judged against actual repo convention (grepped: 65 of 109 sampled files reference TASK-NN in comments, already accepted through multiple rls-security-reviewer/fable-advisor passes this session) -- refuted as consistent with established house style, not fresh violations.

Verified against a REAL local Supabase (not sandboxed): supabase db reset applies all migrations cleanly; SUPABASE_INTEGRATION=1 vitest = 506/506 web integration tests pass, 13/13 MCP integration tests pass (had to add the missing SUPABASE_SERVICE_ROLE_KEY to apps/mcp/.env.local, gitignored, local-dev-only value); pnpm -r run test = 415/415 unit tests pass; tsc --noEmit clean; ESLint clean.

Not deployed to remote -- migration is local-only, ready for the owner's review before commit/deploy, consistent with this repo's deploy workflow (git push -> CI pipeline applies migrations before Vercel, per TASK-96).
<!-- SECTION:NOTES:END -->

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

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Relaxed the stories write-permission model to Pivotal-style (owner decision (a)): any project member may operate any story, not just its author/assignee. New migration collapses the stories UPDATE RLS policy into one owner-or-member rule, which cascades correctly through update_story and transition_story (both RLS-gated) and now agrees with move_story_board (already permissive). MCP server's error handling and tests updated to match; a new integration test proves all three write paths (direct UPDATE, transition_story, move_story_board) treat a non-author/non-assignee member identically, and that viewer stays denied on all three. Verified with a real local Supabase reset: 506 web + 13 MCP integration tests, 415 unit tests, tsc, ESLint all pass. rls-security-reviewer and a high-effort /code-review pass both completed with fixes applied. Not deployed to remote yet.
<!-- SECTION:FINAL_SUMMARY:END -->
