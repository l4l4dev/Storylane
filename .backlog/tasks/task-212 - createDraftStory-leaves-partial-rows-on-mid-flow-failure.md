---
id: TASK-212
title: createDraftStory leaves partial rows on mid-flow failure
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:08'
updated_date: '2026-07-29 06:03'
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
Implementation complete; awaiting /code-review high.

FINDING that invalidated the previous session's verification: the committed
create_draft_story could never have run for a real user. It is SECURITY INVOKER
but called _splice_backlog and assert_points_on_scale, both revoked from
`authenticated` — every call died with "permission denied for function
_splice_backlog". The earlier "all three targets work" check had been run as
`postgres`, which has execute on everything. Same root cause as the DEFINER/label
mistake recorded above: verifying as the wrong role.

Rewrote the RPC as a wrapper rather than a reimplementation. It inserts the row
and then delegates to update_story (fields, labels, point-scale clamp) and
move_story_board (positioning) — the exact RPCs the server action used to call,
both already granted to `authenticated`. This removes the grant problem, avoids
forking three pieces of logic, and fixes a second regression the hand-written
version had introduced: it stored points on a chore, where update_story nulls
them for non-pointed types.

Lock order changed: both iteration_finalize and positions are now taken for every
target, in move_story_board's order. Taking only `positions` and letting the
nested move_story_board acquire iteration_finalize underneath would invert the
order against every other board RPC.

rls-security-reviewer pass: claims 1-4 confirmed (INVOKER is load-bearing for the
label guard; the stories INSERT policy does cover viewer/non-member; delegates
are reachable and reintroduce no bypass; lock order matches every sibling). It
rejected claim 5 — the "INVOKER needs no exit guard" argument — and was right.
Per-statement RLS closes the INSERT, because a WITH CHECK violation always
raises, but update_story's writes are an UPDATE and a DELETE, where a failed
USING clause matches zero rows and raises NOTHING. Reproduced: a caller demoted
owner->viewer mid-transaction got `error: undefined` and a surviving title-only
row with description and points silently discarded — this task's own bug, through
a different door. Added entry + exit guards on project_role.

Null-safety matters in those guards: project_role returns NULL for a non-member
and `NULL not in (...)` is NULL, which `if` treats as false, so the obvious
spelling never fires. Used move_story_board's `v_role is null or not (v_role =
any(v_roles))` shape. Both spellings are covered by tests.

Tests: 8 unit cases (down from 11 — the old ones asserted the three-step
internals) plus 10 new integration cases in
apps/web/lib/utils/create-draft-story.integration.test.ts. create_draft_story
added to grant-lockdown's AUTHENTICATED_ALLOWLIST (that existing test caught the
omission).

Every guard was verified by removing it and confirming a test fails:
- iteration resolved before the lock -> "Cannot assign a story to a finalized iteration"
- reposition made best-effort -> expected 42501, got undefined
- field-save failure swallowed -> no error raised, orphan survives
- naive `not in` role guard -> all three non-member cases fall through

/code-review high — three findings, all fixed:

1. MEDIUM, confirmed and reproduced: p_target = NULL passed validation. `NULL not
   in (...)` is NULL, which `if` reads as false, and every branch below then read
   false too, so the row was inserted with no state and no iteration — a silent
   Icebox create returning a uuid and no error. The same NULL-vs-false trap just
   fixed for project_role, missed one line above it. Fixed with an explicit
   `p_target is null or`; test added, and it fails against the naive spelling.

2. MEDIUM: no coverage of the backlog target's landing zone. Correct — the
   rewritten unit tests only assert argument forwarding, and `backlog` no longer
   touches insert_board_item (it routes through move_story_board's backlog
   splice), so insert-board-item's suite no longer covers it either. Added
   landing-zone cases for all three targets; the backlog one puts a divider
   between the two stories so the splice has to resequence across both tables.
   Verified by making backlog land in the Icebox — the test fails.

3. LOW: the RPC's SQL-worded raises reached the draft card verbatim, losing
   "This project has no unstarted state to create stories in". Restored via a
   small mapper in the action. Only that one message is rewritten: the rest are
   either already user-facing ("No active iteration") or unreachable from the
   card, which trims the title itself and cannot send an out-of-union target.

Reviewer note not acted on: doc-24 is a consumed handoff and its title now lies
("action not yet switched"). Left for the owner to archive at merge time, since
until then it is still this branch's recovery path.

Final: core tsc/test OK (77), web tsc/lint/build OK, full web suite 1193 passed
across 135 files on a database rebuilt from the migration chain.

Caveat: two earlier full-suite runs each reported a single failure whose name
could not be captured; five subsequent full runs, including two immediately after
a `supabase db reset`, were clean. Unidentified, not dismissed.
<!-- SECTION:NOTES:END -->
