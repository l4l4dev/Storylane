---
id: TASK-212
title: createDraftStory leaves partial rows on mid-flow failure
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
updated_date: '2026-07-29 04:33'
labels: []
milestone: m-2
dependencies: []
references:
  - 'apps/web/app/projects/[id]/board/actions.ts'
priority: high
type: bug
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
createDraftStory (board/actions.ts) creates a story, positions it, and applies its remaining fields as separate, non-transactional steps (deliberate trade-off per its own comment, reusing insert_board_item/move_story_board/updateStory rather than a new RPC). If a later step fails, a title-only story is left behind, and the position-move error path is currently ignored. A retry then creates a duplicate instead of completing the original row. Found via Codex external review, 2026-07-27.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A failure in the position or field-update step for a new draft story does not leave an orphaned title-only row — either the whole creation rolls back or the caller can resume/complete the same row
- [ ] #2 The position-move error is surfaced to the caller instead of being silently ignored
- [ ] #3 All three creation paths (backlog, unstarted, icebox) keep working
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New migration: create_draft_story(p_project_id, p_target, p_title, p_description, p_story_type, p_points, p_assignee_id, p_label_ids, p_anchor) — SECURITY DEFINER, one transaction. insert_board_item is NOT touched: it is a shared primitive that the divider path ("+ Add note") also calls, and adding story-only fields to its payload would make which keys are meaningful depend on the caller.
2. Entry: require_project_role(owner, member), hoisted role list.
3. unstarted target only: take iteration_finalize:<project> THEN positions:<project>, and resolve the current iteration and lowest unstarted state AFTER the locks, not from parameters. This closes a hole the advisor found that the task description does not mention: the action currently resolves the current iteration with no iteration_finalize lock at all, so a concurrent finalize_iteration can leave the new story in an iteration that has just been finalized. Verified: the action takes no lock, while move_story_board takes iteration_finalize + positions for exactly this reason.
4. backlog/icebox take positions:<project> only.
5. Errors stay descriptive: "No active iteration" and the no-unstarted-state message are business-rule P0001s, matching what insert_board_item already raises, and the action forwards error.message as the backlog branch already does. The action's pre-resolution block goes away entirely.
6. Writes in order: stories insert -> story_labels insert (no pre-validation; story_labels' WITH CHECK already rejects a foreign-project label, and one transaction now rolls the story back — that IS the orphan fix) -> assert_points_on_scale when points is set (call the existing helper; do not inline the scale literals, which would be an 8th copy TASK-219 is already trying to reduce) -> _splice_backlog for position.
7. Exit guard after the last write, per spec/rls.md.
8. actions.ts: createDraftStory becomes one RPC call per target; delete the pre-resolution block and the best-effort reposition block, which is what AC #2 asks for since the reposition error now propagates.
9. Tests: rewrite the 11 existing unit cases that assert the old internal shape, plus integration coverage for the orphan (force update failure, assert no row survives), the reposition error propagating, and the unstarted target refusing to land in an iteration finalized during the wait — reusing role-recheck-after-lock's lock-holding harness.
10. rls-security-reviewer on the migration, then /code-review high.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced the orphan before designing anything. Mirrored createDraftStory's icebox path — plain insert, then update_story with a label belonging to a different project — and the update failed with 42501 (story_labels' WITH CHECK) while the title-only story survived. A retry would create a second one. That is AC #1's failure exactly.

Baseline facts gathered for the design:
- Three targets take two different paths. `backlog` uses insert_board_item (insert+anchor in one call, SECURITY DEFINER, holds positions:<project>). `unstarted` and `icebox` do a plain .from("stories").insert() then optionally move_story_board with empty p_deltas.
- The `unstarted` target resolves the current iteration and the lowest unstarted state IN THE SERVER ACTION, before inserting, and returns "No active iteration" / "no unstarted state" as user-facing messages. Moving that into an RPC trades those messages for a raise.
- create_story_tracker already does story+labels in one transaction (used by MCP) but has no assignee_id and no positioning.
- The reposition error is discarded deliberately per the code's own comment, which is AC #2.

Test surface to expect: actions.test.ts has ELEVEN createDraftStory cases, and most assert the internal shape — that insert_board_item is called for backlog and not a plain insert, that move_story_board is called with a particular view, that update_story applies the field set. Collapsing three steps into one RPC invalidates most of those assertions, so this task is as much a test rewrite as an implementation change. Worth knowing before estimating it.

create_draft_story written and the orphan is closed: a foreign-project label now returns 42501 and leaves the row count unchanged (3 -> 3), where the three-step version left a title-only story behind. All three targets work, "No active iteration" still surfaces for unstarted before a rollover, and a valid label attaches.

Getting the security mode right took two wrong turns, and both are worth recording because the advisor and I shared the same wrong assumption.

I wrote it SECURITY DEFINER first. Tested: the foreign label was ACCEPTED and the story survived. The reason is that the cross-project label guard is an RLS WITH CHECK on story_labels, and DEFINER bypasses RLS entirely — so the plan's premise ("story_labels' WITH CHECK already rejects it, so no pre-validation is needed") silently stopped holding the moment the function became DEFINER. The advisor's ruling on labels was right for create_story_tracker, which is INVOKER, and I carried it to a DEFINER function without noticing the dependency.

Switching to INVOKER then failed every call with "permission denied for function require_project_role" — that helper is revoked from authenticated, because it exists for DEFINER callers. That is precisely why insert_board_item is DEFINER. Checked how the INVOKER sibling handles it: create_story_tracker calls no role helper at all and delegates authorization to RLS. Matched that, so the function is INVOKER with no explicit guard.

One consequence for the TASK-211 convention: an INVOKER function needs no exit guard, because RLS re-evaluates on every statement as the caller, including after a wait. The exit-guard rule exists because DEFINER suppresses that. Recorded in the migration header so the absence does not read as an oversight.

Also per the advisor: points validation calls the shared assert_points_on_scale rather than inlining the scale values, which would have been an eighth copy of a literal TASK-219 is trying to reduce.

Still to do: rewrite the server action to a single call and delete its pre-resolution and best-effort-reposition blocks (AC #2), rewrite the eleven unit tests that assert the old three-step shape, add integration coverage (orphan, reposition error propagating, and unstarted refusing an iteration finalized during the wait), then rls-security-reviewer and /code-review high.
<!-- SECTION:NOTES:END -->
