---
id: TASK-130
title: >-
  My Work data model: my_work_story_state, project_my_work_mapping,
  story_completions + RLS fixes
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 12:34'
updated_date: '2026-07-22 16:45'
labels: []
milestone: m-5
dependencies: []
priority: high
type: feature
ordinal: 12700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-14 (My Work Kanban rework) foundation migration. Replaces story_pins with my_work_story_state (is_today + local_status, no cross-project pinning of unassigned stories); adds project_my_work_mapping (per-project Doing/Done -> project_states mapping, owner-configured); adds story_completions (append-only personal completion log, never updated/deleted, drives Done). Includes the 3 fable-advisor-mandated fixes: stories' SELECT RLS gets an OR clause for story_completions owners (a completer leaving the project must not lose read access to their own Done entry); maintain_story_completed_at is redeclared SECURITY DEFINER (required since story_completions has no client INSERT policy — without this every done-category transition project-wide breaks, not just My Work's) with a new.assignee_id is not null guard before inserting; project_my_work_mapping RLS follows the integrations table's owner-writes/members-read pattern. See .backlog/docs/doc-14 for the full design (already fable-advisor approved-with-changes, this task implements it as written).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 my_work_story_state table created (user_id, story_id, is_today, local_status, updated_at; PK (user_id, story_id); on delete cascade + story_id index), replacing story_pins (data migration or clean cutover -- story_pins' existing is_today-equivalent rows are dropped since cross-project pinning of unassigned stories is being removed, per doc-14 round 2 #5)
- [x] #2 project_my_work_mapping table created (project_id PK on delete cascade, doing_state_id/done_state_id nullable on delete set null, configured_by, updated_at) with RLS: select=is_project_member, insert/update/delete=project_role=owner (matches integrations table)
- [x] #3 story_completions table created (id, story_id, user_id, completed_at; index on (user_id, completed_at desc)), RLS: select where user_id=auth.uid(), no client insert/update/delete policy at all
- [x] #4 maintain_story_completed_at is redeclared SECURITY DEFINER (full function replacement, not a partial patch) and its entering-done branch inserts into story_completions (user_id = new.assignee_id) guarded by new.assignee_id is not null
- [x] #5 stories' SELECT RLS policy gets an OR clause: is_project_member(project_id) OR exists a story_completions row for (story.id, auth.uid()) -- a story's own row must stay readable to whoever completed it even after they leave the project
- [x] #6 rls-security-reviewer pass is clean; migration passes local supabase db reset; pnpm test + lint green
- [x] #7 spec/data-model.md and spec/rls.md updated for the new tables/policies
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Additive-only migration (story_pins drop deferred to TASK-131, owner-approved, to keep main green). Implements doc-14's data model with the advisor's 3 mandated fixes + one correctness fix I found:
1. my_work_story_state (user_id, story_id, is_today, local_status check todo/doing/done, updated_at; PK(user_id,story_id); story_id index). RLS: own-rows select/update/delete; insert = own + is_project_member(story's project) — matches story_pins (doc-14: assignee-scoping enforced by UI/classification, not RLS).
2. project_my_work_mapping (project_id PK on delete cascade, doing/done_state_id on delete set null, configured_by, updated_at). RLS: select=is_project_member, insert/update/delete=project_role=owner.
3. story_completions (id, story_id on delete cascade, user_id, completed_at; index (user_id, completed_at desc)). RLS: select own rows only; revoke insert/update/delete from authenticated (TASK-110 lockdown) — only the trigger writes it.
4. maintain_story_completed_at redeclared SECURITY DEFINER (full replacement), entering-done branch inserts story_completions(new.id, new.assignee_id). CORRECTNESS FIX beyond doc-14's literal guard: insert gated to tg_op='UPDATE' (a BEFORE INSERT trigger can't FK-reference the not-yet-inserted story; a story born done isn't a completion), plus the new.assignee_id is not null guard for unassigned UPDATE-into-done.
5. stories SELECT RLS gets the OR clause (is_project_member OR exists a story_completions row for this story+viewer).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in 20260722000002_my_work_data_model.sql (additive; story_pins drop deferred to TASK-131 per owner). Verified: supabase db reset applies; new integration test my-work-data-model.integration.test.ts (8 tests) proves the completion trigger (log-on-transition crediting assignee, the FK-timing fix = create-directly-into-done neither fails nor logs, reopen keeps the row + clears completed_at, re-complete adds a 2nd row, unassigned guard), the story_completions client-write lockdown, project_my_work_mapping member-read/owner-write RLS, and the stories SELECT OR-clause (a completer who left the project still reads the story + their completion). completed-at.integration + stories-write-model.integration still pass. Regenerated database.types.ts (additive). Full unit suite 573 pass, tsc + lint clean. spec/data-model.md + spec/rls.md updated. Two PRE-EXISTING integration failures observed and confirmed independent of this migration (reproduce with the migration removed): move-copy label-dedup (labels_unique_name constraint vs the test's two-same-name-labels setup) and finish-story-from-git (iterations INSERT lockdown 'permission denied') — out of scope for TASK-130, flag to owner. rls-security-reviewer pass pending.

rls-security-reviewer round 1 found 2 real findings (both empirically confirmed by the reviewer), FIXED: (HIGH) maintain_story_completed_at credited new.assignee_id with no membership check — since any member can set assignee_id to an arbitrary profile and move a story to done (relaxed stories write model), a forged story_completions row would grant an OUTSIDER permanent read access via stories' SELECT OR-clause. Fixed by gating the insert on the assignee being a current project_members row of new.project_id (checked at completion time, so a legitimate completer who later leaves still keeps access). Added a regression test (outsider assignee -> no completion -> no read access), which passes. (LOW/MED) my_work_story_state UPDATE policy didn't re-check membership for story_id (part of the updatable PK); fixed by mirroring the INSERT membership exists-check in the UPDATE WITH CHECK. Re-verified: db reset applies; my-work-data-model integration 9 pass; completed-at/stories-write-model/move-story-board still pass; unit 573, tsc, lint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
doc-14 My Work data-model foundation shipped as an additive migration (20260722000002): my_work_story_state (own-rows RLS + separate membership-checked UPDATE), project_my_work_mapping (member-read/owner-write, integrations pattern), story_completions (append-only Done log, client-write locked down, trigger-only writes), maintain_story_completed_at redeclared SECURITY DEFINER logging a completion on the UPDATE-into-done (FK-timing + assignee-membership gated), and the stories SELECT OR-clause keeping a completed story readable to its completer after they leave. story_pins drop deferred to TASK-131 (owner-approved) to keep main green. Advisor-approved design; rls-security-reviewer found + I fixed a HIGH forgery finding (unmembered-assignee completion) and a LOW/MED (UPDATE story_id repoint), both re-reviewed CONFIRMED-FIXED. Verified: db reset applies, 9 new integration tests (incl. the forgery-blocked regression), unit 573, tsc, lint all clean; specs updated.
<!-- SECTION:FINAL_SUMMARY:END -->
