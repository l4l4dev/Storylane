---
id: TASK-221
title: 'DB: pin stories.assignee_id to target-project membership with a composite FK'
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-30 02:54'
updated_date: '2026-07-30 08:06'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1250
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split out of TASK-219 on fable-advisor's verdict: the composite FK is the right long-term answer for 'the assignee must be a member of the story's project', but it exceeds TASK-219's ACs because it changes behaviour for every writer, not just the two cross-project RPCs.

Today assignee_id is written without any membership check. That is documented as deliberate (20260722000002_my_work_data_model.sql: 'any member can set assignee_id to an arbitrary profile ... the relaxed stories write model, 20260719000002'), and maintain_story_completed_at re-checks membership defensively to stop a forged completion for a non-member. Separately, remove_member does not unassign the removed user's stories — it only clears my_work_story_state — so a removed member stays assigned indefinitely.

Proposed mechanism: a composite FK stories(project_id, assignee_id) -> project_members(project_id, user_id) with ON DELETE SET NULL on assignee_id. project_members' PK is already (project_id, user_id), the shape matches the existing composite FKs on stories.state_id / iteration_id and activity_logs_story_project_fk, and PG17 supports column-specific ON DELETE SET NULL. The engine then takes the KEY SHARE lock itself at write time, so no explicit re-check is needed in any RPC, and remove_member's DELETE unassigns as a side effect.

Costs to design before implementing: a cleanup migration for existing dangling assignees (rows would otherwise fail the ALTER); the resulting hard failure on update_story / split_story / create_draft_story when a client sends a non-member assignee, which needs an error-display decision for the autosave path (spec/screens.md 'Conflict & failure rules'); and whether maintain_story_completed_at's defensive check becomes redundant. Note the FK's automatic KEY SHARE lock is the documented exception to spec/rls.md's three-tier lock order (recorded there by TASK-219).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Existing stories whose assignee_id is not a member of their project are cleaned up by a migration before the constraint is added
- [x] #2 The composite FK is in place and a non-member assignee is rejected for every write path (update_story, split_story, create_draft_story, move/copy)
- [x] #3 Removing a member unassigns their stories in that project, with a test
- [x] #4 The autosave path surfaces the rejection per spec/screens.md 'Conflict & failure rules' instead of failing silently
- [x] #5 Any now-redundant in-RPC membership check (including maintain_story_completed_at's) is either removed or its remaining purpose documented
- [x] #6 The two out-of-tier pins TASK-219 documents in spec/rls.md are revisited: this FK gives remove_member's DELETE a story row lock (via ON DELETE SET NULL), which is exactly the counterparty that would turn them into a cycle — and it also makes move/copy's explicit for share on the membership row redundant
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration 20260730030000_stories_assignee_project_member_fk.sql (one unit):
   a. create index stories_project_assignee_idx on stories (project_id, assignee_id) — advisor: without it ON DELETE SET NULL seq-scans stories while holding the project_members row exclusively, widening the deadlock window.
   b. Cleanup UPDATE: null out assignee_id where the assignee is not a member of the story's project (AC#1). log_story_activity does not record assignee changes, so no activity_logs noise.
   c. ALTER TABLE stories ADD CONSTRAINT stories_assignee_project_fkey FOREIGN KEY (project_id, assignee_id) REFERENCES project_members (project_id, user_id) ON DELETE SET NULL (assignee_id) — NOT DEFERRABLE, same shape as stories_iteration_project_fkey.
   d. Recreate move_story_to_project / copy_story_to_project with the membership probe's 'for share' removed (plain select). Branch logic (found -> keep, not found -> null) stays: the normal-case drop is behaviour, not a race.
2. remove_member: no change. The FK's ON DELETE SET NULL unassigns (AC#3) — verified by test, not by new code.
3. Web error surfacing (AC#4): extend lib/utils/write-error.ts writeErrorMessage with two central mappings — 23503 naming stories_assignee_project_fkey, and 40P01 (deadlock_detected) -> generic retry message. Route updateStory (stories/[id]/actions.ts), createDraftStory (board/actions.ts) and transferStoryToProject through it. StoryDetailPanel already renders result.message.
4. spec/rls.md 229-236: rewrite the 'One exception is left' paragraph — move/copy's explicit pin is gone, the ABBA cycle between remove_member's DELETE and the story-write paths is accepted as a PG-detected self-healing race, and record that the tier-0 shared advisory lock was considered and rejected (cannot cover direct REST PATCH).
5. AC#5: maintain_story_completed_at already has no membership re-check (removed with story_completions) — record the fact, no code change.
6. Tests: lib/utils/assignee-membership-fk.integration.test.ts (non-member assignee rejected on update_story + create_draft_story; remove_member unassigns; move/copy still drops silently) + unit cases for the two new writeErrorMessage mappings.

Advisor verdict (fable): approved with corrections — option A (accept the deadlock, document it) plus B's redundant-pin removal; option C (repo-wide tier-0 advisory lock) rejected.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (fable-advisor verdict: option A + B's redundant-pin removal; option C rejected).

Migration 20260730030000_stories_assignee_project_member_fk.sql:
- index stories_project_assignee_idx (project_id, assignee_id) BEFORE the constraint — without it the ON DELETE SET NULL cascade seq-scans stories while holding the membership row exclusively, widening the accepted deadlock window.
- cleanup UPDATE nulls dangling assignees (0 rows locally; log_story_activity does not record assignee changes so it produces no activity noise).
- FK stories (project_id, assignee_id) -> project_members (project_id, user_id) ON DELETE SET NULL (assignee_id), MATCH SIMPLE, NOT DEFERRABLE. stories_assignee_id_fkey -> profiles left in place (implied, dropping it buys nothing).
- move/copy recreated with the membership probe's 'for share' removed; the found/not-found branch stays, because dropping a non-member assignee is normal-case behaviour (spec/features.md), not a race.

remove_member unchanged — the cascade does the unassign.

Web: writeErrorMessage (lib/utils/write-error.ts) gained two central mappings, 23503-on-stories_assignee_project_fkey and 40P01. updateStory, transferStoryToProject and draftErrorMessage now route through it; StoryDetailPanel already renders result.message with a Retry button.

Spec: rls.md's 'One exception is left' paragraph rewritten (no out-of-tier pin remains; the ABBA cycle is accepted and why C was rejected). data-model.md's stories DDL notes the second FK.

Verification: supabase migration up --local applied cleanly; constraint verified via pg_constraint. New lib/utils/assignee-membership-fk.integration.test.ts (6 cases). Two TASK-219 cases in config-pin-for-share.integration.test.ts asserted the removed 'for share' via a FOR NO KEY UPDATE holder — rewritten to hold FOR UPDATE, which the FK's KEY SHARE does conflict with, so they now guard the FK instead of the deleted clause. Full suite with SUPABASE_INTEGRATION=1: 1230 passed / 140 files. pnpm run lint and tsc --noEmit clean. database.types.ts regenerated (additive: one Relationships entry).

AC evidence:
#1 cleanup UPDATE precedes the ALTER in 20260730030000; 'supabase migration up --local' applied the whole file cleanly (0 dangling rows locally, so the ALTER would have passed either way — the statement is the guard for production).
#2 assignee-membership-fk.integration.test.ts: update_story and create_draft_story both return 23503 naming stories_assignee_project_fkey, and create_draft_story leaves no row. split_story never inherits an assignee; move/copy DROP a non-member rather than rejecting (spec/features.md), which the same file asserts — so no write path can persist a non-member assignee.
#3 'unassigns the removed member's stories, and only in that project' — asserts the removed project's story goes null while the member's story in another project is untouched.
#4 write-error.test.ts proves the 23503/40P01 mappings; story-detail-panel.test.tsx already proves result.message renders with a Retry button; the integration test proves the RPC produces that error shape. The single wiring line in updateStory is not unit-tested — actions.test.ts's supabase mock has no rpc(), and extending it for one call was not worth the harness change.
#6 both move/copy pins removed; spec/rls.md's exception paragraph rewritten, and config-pin-for-share.integration.test.ts's two cases now hold the row FOR UPDATE so they guard the FK's KEY SHARE instead of the deleted clause.

rls-security-reviewer: no findings (information leak, cascade authorization, the 'for share' removal, the cleanup UPDATE and grants all reviewed; grants confirmed preserved live).

/code-review high — 4 findings, 3 fixed, 1 declined with measurement:

FIXED #1 (MEDIUM) settings/actions.ts removeMember returned error.message raw, so the half of the ABBA pair spec/rls.md names could surface 'deadlock detected'. Now routed through writeErrorMessage.
FIXED #2 (LOW/MED) the shared 23503 message ('pick a different assignee') is unactionable on Move/Copy, which has no assignee field and whose retry succeeds by itself. Added isNonMemberAssigneeError to write-error.ts and a path-specific message in transferStoryToProject, with a unit test for the predicate.
FIXED #4 (LOW) the backfill discarded data with no record. Wrapped in a DO block with GET DIAGNOSTICS + RAISE NOTICE of the cleared count, so the deploy log carries it (syntax verified in a rolled-back transaction; 0 rows locally).

DECLINED #3 (LOW) 'FK added validating takes ACCESS EXCLUSIVE and blocks all story reads during deploy'. Measured on the local PG 17 (begin; alter table ... add constraint ...; select mode from pg_locks; rollback): the lock taken on stories is ShareRowExclusiveLock, not AccessExclusive — reads are NOT blocked, only writes, for one scan of a small table. NOT VALID + VALIDATE CONSTRAINT would also have to be split across two files or lose its point, and CREATE INDEX CONCURRENTLY cannot run in a migration's transaction. Not worth it at this table size, and the whole chain is squashed at TASK-98 anyway.

Re-verified after the fixes: SUPABASE_INTEGRATION=1 pnpm test = 1231 passed / 140 files, lint and tsc clean.
<!-- SECTION:NOTES:END -->
