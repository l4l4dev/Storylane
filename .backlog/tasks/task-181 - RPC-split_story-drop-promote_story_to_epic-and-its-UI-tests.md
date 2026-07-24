---
id: TASK-181
title: 'RPC: split_story + drop promote_story_to_epic and its UI/tests'
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
updated_date: '2026-07-24 09:43'
labels: []
milestone: m-6
dependencies:
  - TASK-179
documentation:
  - doc-18
type: feature
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decision 5 (doc-18 §6): promote_story_to_epic is removed; a new split_story RPC does the Split Studio bulk commit. The trivial single-child case needs no RPC (plain parent_id UPDATE + the TASK-179 trigger).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 split_story (SECURITY DEFINER, require_project_role owner/member) inserts N child stories under a parent, opens position gaps from the sequence per the invariant, reassigns selected tasks, and relies on the TASK-179 trigger for points-clear/is_container; explicit EXECUTE grant (grant-lockdown test updated)
- [x] #2 promote_story_to_epic is DROPped (migration); the story-peek-menu Promote item + PromoteToEpicDialog, promoteStoryToEpic action, promoted-epic-banner + board banner render/query params, and activity.ts story.promoted_to_epic case are removed
- [x] #3 promote.integration.test.ts, the grant-lockdown allowlist entry, and the personal-project-seal-seams promote block are removed/replaced; new tests cover split_story
- [x] #4 matches spec/rls.md (already updated) and spec/features.md Split section
- [x] #5 split_story captures the source state_id/iteration_id BEFORE clearing and applies to children (done iteration => backlog; non-unstarted state => first unstarted state; Icebox stays Icebox; assignee not inherited) — doc-18 §6-§7
- [x] #6 move_story_to_project and copy_story_to_project reject is_container=true stories (RPC guard) so a container Move cannot orphan its children; child move still drops parent_id (doc-18 §8)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on feat/epic-story-unification (advisor-reviewed, Opus fallback).

DB (migration 20260724071826): split_story(p_story_id, p_children jsonb)->{parent_id,child_ids}, SECURITY DEFINER, owner+member via membership-filtered FOR UPDATE. Guards: reject is_container source + parent_id-not-null source + empty children. advisory locks positions:->story_number: (order kept for deadlock-safety even though children only append). §7 landing captured BEFORE first child insert (the §4 trigger NULLs source state/iter on containerization): Icebox->Icebox, unstarted->carry, non-unstarted->first unstarted state, done iteration->backlog, else keep iteration; assignee never inherited; epic_color inherited. Children INSERT with default nextval position only — NO compaction/gap (advisor: old promote's upward shift would violate position invariant rule 2, which names split_story; a container is off-board so 'source position' is meaningless). story.split logged on source. move/copy_story_to_project gain is_container reject guard (§8); child move drops parent_id via the fresh target insert. promote_story_to_epic DROPped (grant goes with it).

Web: promoteStoryToEpic action -> splitStory action; peek-menu Promote item+PromoteToEpicDialog -> Split menu item navigating to /stories/[id]/split (hidden on a child); promoted-epic-banner + board banner + query params removed; activity.ts promoted_to_epic case -> story.split + story.containerized cases; grant-lockdown allowlist promote->split_story; promote.integration.test deleted; seal-seams promote block removed (split is non-destructive, allowed in personal projects). Unit tests swapped (activity.test, story-peek-menu.test).

Verified: supabase db reset clean; types regenerated; split.integration 11/11 (landing 4-branch, k>=2 containerized=1 log, task reassign, container/child reject, rule-1 append regression, move/copy container reject, child move drops parent); grant-lockdown 3/3; seal-seams + nesting pass (23/23 integration total); apps/web pnpm test 695 pass/217 skip; eslint + tsc clean. spec/rls.md + features.md + glossary already consistent. Advisor corrections all applied (drop compaction, add source guards, keep both advisory locks). Migration rls-security-reviewer deferred to TASK-182 per doc-19. Pending owner /code-review (high).

Official /code-review (high): 5 findings, all UI-scope.
- #1/#2/#3 (my over-reach): I prematurely added a Split menu item (-> /stories/[id]/split, a 404 until TASK-183) + a splitStory web action (dead until its TASK-183 consumer). Per the task split (Split entry = TASK-184 AC#3, Split Studio = TASK-183), REVERTED both from TASK-181 — it now only removes the Promote item and keeps the RPC + removals + move/copy guards, exactly its ACs. story-peek-menu.test Split cases removed.
- #4 (Move/Copy shown on containers): RPC guards protect data; UI hiding is doc-18 §8 and needs is_container on StoryDetail -> added as a TASK-184 AC.
- #5 (personal-project split UX): splitting a personal task containerizes it (drops from My Work) and its children start unassigned (also not in My Work) -> the task appears to vanish. Surfaced to owner as an open design question for the Split entry (TASK-183/184).
Re-verified after revert: tsc + eslint clean, apps/web 693 unit pass. Integration unchanged (RPC/migration untouched by the revert).

Follow-up (migration 20260724081029, from TASK-182 /code-review #1): split_story now clamps each child's tentative points to NULL when off the project's point_scale, matching update_story/move/copy — the RPC is a trust boundary and previously stored client points verbatim (velocity/roll-up corruption risk). create-or-replace, grants preserved. TDD: off-scale (999) -> NULL, valid (2) -> kept. Findings #2-#5 deferred to TASK-183/184 (notes added there).

Also hardened in the same migration (TASK-182 /code-review 2nd pass #3): the child points cast is now guarded by jsonb_typeof(...)='number', so a non-numeric value in p_children clamps to NULL instead of aborting the whole split with a raw 22P02 cast error. Test added.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
split_story RPC replaces promote_story_to_epic: in-place split (source survives as container), §7 child landing, no position compaction (advisor: rule-2 append-only). move/copy reject containers (§8). All promote UI/action/tests/banner/grant removed. Verified via db reset, 23/23 integration, 695 unit, lint+tsc clean; advisor-approved-with-corrections (Opus).
<!-- SECTION:FINAL_SUMMARY:END -->
