---
id: TASK-18
title: Pre-deploy RLS hardening (security review 2026-07-08)
status: Done
assignee: []
created_date: '2026-07-08 00:50'
updated_date: '2026-07-09 03:35'
labels:
  - db
  - security
milestone: m-1
dependencies:
  - TASK-22
references:
  - spec/rls.md
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Findings from the 2026-07-08 pre-deploy security audit of supabase/migrations + git-webhook Edge Function. No High findings; the Edge Function (HMAC verification, empty-secret rejection, per-project scoping), integrations owner-only RLS, grants, and project_members escalation paths all verified clean. Three confirmed gaps to fix in one migration before production (TASK-3):

1. profiles SELECT policy is 'using (true)' for all authenticated users (20260627000001_profiles.sql) — any signed-up user can enumerate the entire user directory, which also defeats the capped invite-search RPC design (TASK-6). Scope SELECT to own profile + profiles sharing a project; make the capped RPC the only cross-tenant lookup.
2. comments UPDATE policy checks author_id only (20260627000006) — a removed/downgraded member can still edit their old comments by id. Add the parent-story membership clause like the INSERT policy.
3. stories.epic_id / iteration_id are plain FKs (20260627000005) — FK checks bypass RLS, so a user in two projects can point an A-story at a B-epic/iteration (dangling, invisible, low impact). Add UNIQUE(id, project_id) on epics/iterations and composite FKs, matching the custom_status_id hardening in 20260707000007.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 profiles SELECT is scoped to own profile + co-members; a user with no shared project cannot read another user's profile row (test proves it)
- [x] #2 Invite user-search still works via the capped RPC after the profiles policy change (coordinate with TASK-6 if it lands first)
- [x] #3 comments UPDATE requires current membership of the story's project in USING and WITH CHECK
- [x] #4 stories.epic_id and stories.iteration_id are composite FKs on (id, project_id); existing data migrates cleanly
- [x] #5 rls-security-reviewer has reviewed the migration; existing vitest + RLS tests pass
- [x] #6 App-layer: board server actions (dropStory/dropStoryInList/transitionStory/moveStory/deleteBacklogDivider/updateIterationGoal) filter the target row by project_id (only dropStoryFree does today) — a member of two projects cannot post a foreign story_id/divider id and have it written under the current project
- [x] #7 #7 comments DELETE requires current membership + owner/member role of the story's project in USING (advisor-added, same gap as UPDATE, closes a spec/rls.md viewer-only violation)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Advisor-reviewed 2026-07-09 (approved with 2 corrections). Single migration supabase/migrations/20260709000001_rls_hardening.sql, in order:
(a) shares_project_with(target uuid) helper - security definer stable set search_path=public, project_members self-join, same shape as is_project_member.
(b) profiles SELECT: drop using(true), replace with id = auth.uid() or shares_project_with(id).
(c) comments UPDATE and DELETE: add the same EXISTS(select 1 from stories s where s.id=story_id and project_role(s.project_id) in (owner,member)) clause the INSERT policy already has, to both USING and WITH CHECK/USING respectively.
(d) epics and iterations: add unique(id, project_id). Drop stories_epic_id_fkey / stories_iteration_id_fkey. Add composite FKs (epic_id, project_id) references epics(id, project_id) on delete set null (epic_id), and same for iteration_id - MUST use the column-list ON DELETE SET NULL syntax (PG17), not a bare "on delete set null", which would also null out project_id (NOT NULL column) and block every epic/iteration delete that has stories. Confirmed zero existing cross-project epic_id/iteration_id rows locally, no backfill needed.

App layer: apps/web/app/projects/[id]/board/actions.ts - add .eq("project_id", projectId) to moveStory (78,86,97), dropStory (288,325), dropStoryInList (383,420), transitionStory (584,616), deleteBacklogDivider (551), updateIterationGoal (776). dropStoryFree is the reference implementation already doing this.

Known side effect to verify: profiles SELECT scoping means a removed members author/actor/assignee embed (stories/[id]/actions.ts:68, activity/page.tsx:21, board/page.tsx:66) returns null - confirm/add an Unknown-user fallback in the UI, cover with a test.

Verify: rls-security-reviewer pass, full vitest, plus RLS-level tests for profiles SELECT scoping, comments UPDATE/DELETE after demotion, cross-project epic/iteration FK violation, and epic/iteration delete with stories attached only nulling the FK column (not erroring).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
rls-security-reviewer findings and resolutions (2026-07-09):

1. Missing DOWN/rollback block on the migration - fixed, added matching the repo convention (20260707000007, 20260708000002).

2. spec/data-model.md still documented plain FKs for stories.iteration_id/epic_id - fixed, added the same composite-FK documentation style already used for custom_status_id.

3. Residual gap in the same AC6 threat class: the position-reorder loops (reorderPositions over ordered_ids) in moveStory, dropStoryFree, dropStory, and the shared persistBacklogOrder helper (used by dropStoryInList and createBacklogDivider) updated stories.position/backlog_dividers.position by id only, without project_id - a two-project member could smuggle a foreign projects story/divider id into ordered_ids and have its position rewritten under the wrong project. Fixed: added .eq("project_id", projectId) to every one of these updates; persistBacklogOrder now takes projectId as a parameter.

4. Profiles SELECT scoping means a still-current member can no longer see the display_name of someone who has since left the project, even for that persons historical comments/activity/assignments within the same project (shares_project_with only checks current membership). All three read sites already fall back gracefully (Unknown / Someone / id prefix), so nothing breaks - this is a UX trade-off, not a bug. Asked the owner directly: keep current behavior (do not extend shares_project_with to cover past co-membership). Decision: keep as-is.

Static checks after all fixes: tsc --noEmit clean, eslint clean, full vitest run 214/214.

Manual RLS verification (local, using GoTrue-created throwaway auth.users + set_config(request.jwt.claims)/set local role authenticated to simulate auth.uid(), per the documented local RLS verification method): profiles SELECT - no-shared-project user sees 0 rows for anothers profile, co-member sees 1 row. comments UPDATE - demoted-to-viewer author gets 0 rows affected, active member gets 1 row affected (happy path). comments DELETE - demoted-to-viewer author gets 0 rows affected. Composite FK - cross-project epic_id assignment blocked, cross-project iteration_id assignment blocked. Epic/iteration delete with an attached story only nulls the FK column, project_id (NOT NULL) survives - confirmed via direct insert/delete/select. All test users/projects/rows cleaned up afterward (cascade delete via auth.users removal).

Live browser check: existing "tasks" project (own membership) - board, activity page (actor:profiles embed) both render correctly post-migration, no console errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Migration 20260709000001_rls_hardening.sql: profiles SELECT scoped to own profile + co-members (new shares_project_with SECURITY DEFINER helper) instead of readable-by-anyone; comments UPDATE and DELETE now require current owner/member role in the story project, closing a gap where a removed/downgraded author could still edit or delete their old comments; stories.epic_id/iteration_id are now composite FKs on (id, project_id) with column-list ON DELETE SET NULL, closing a cross-project-pointer gap plain FKs cant express under RLS. App layer: all 6 board server actions that were missing it (plus the shared position-reorder helper found in review) now filter the target row by project_id, so a two-project member cannot smuggle a foreign projects story/divider id into the current projects mutation. Advisor-reviewed before implementation, rls-security-reviewer-reviewed after; both rounds of findings applied. Full vitest 214/214, manual RLS-policy verification via local auth simulation, live browser regression check - all clean.
<!-- SECTION:FINAL_SUMMARY:END -->
