---
id: TASK-71
title: >-
  MCP write-path hardening: consume position sequence, make multi-write tools
  transactional
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-17 13:15'
updated_date: '2026-07-19 00:03'
labels:
  - mcp
  - db
milestone: m-3
dependencies:
  - TASK-48
priority: high
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review 2026-07-17, apps/mcp/src/handlers.ts. (1) set_story_tasks inserts tasks with explicit position: i, so tasks_position_seq is not consumed — a later plain task INSERT gets a default position that can collide with an MCP-written row and fail on the deferred UNIQUE (story_id, position) constraint (position invariant from TASK-58 says every positioned INSERT must consume the sequence). (2) set_story_tasks does DELETE-then-INSERT in two separate requests — an INSERT failure leaves the checklist wiped. (3) setLabels has the same non-transactional replace (also hit via update_story labels-only). (4) createStory commits the story then applies labels; a label failure returns an error while the story remains, so an agent retry duplicates it. Fix direction: move replace/create+label flows into small RPCs (or accept sequence-consuming inserts via DEFAULT and reorder) so each tool call is atomic; follow the position-invariant doc in spec/data-model.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All MCP task inserts consume tasks_position_seq (no explicit position values that bypass the sequence); regression test creates tasks via MCP then via plain INSERT without constraint failure
- [x] #2 set_story_tasks, setLabels (incl. update_story labels), and create_story+labels are each atomic — induced failure leaves prior state intact, verified by failure-path tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Salvaging the existing unmerged branch feat/mcp-atomic-writes (commit 79812c0, advisor-approved design, already passed one rls-security-reviewer round including a HIGH-severity fix) per Fable's task comment instructions, rather than reimplementing from scratch. Manually porting content (not git merge/rebase, since the branch predates the free-mode removal and touches overlapping files) since the RPC bodies themselves have no free-mode/workflow_mode dependency and already use the owner/member role check matching TASK-70's relaxed model.

1. New migration (fresh date, after current head): create_story_tracker / set_story_tasks / set_story_labels SECURITY INVOKER RPCs -- ported verbatim from the branch (ports clean, no free-mode/RLS-model references to update). Task inserts consume tasks_position_seq via DEFAULT (never explicit position). Each RPC gates on project_role in ('owner','member') explicitly so an empty-payload write against an unwritable story errors instead of silently no-op'ing.

2. New migration (fresh date): story_labels INSERT policy cross-project guard -- ported verbatim. This closes a HIGH-severity, CURRENTLY LIVE gap on main (confirmed: current story_labels INSERT policy in 20260627000005_stories_tasks.sql never checks label_id's project matches the story's project) -- exploitable via the Web app today too, not just MCP, since it's the base RLS policy every client's label-attach path shares.

3. apps/mcp/src/handlers.ts: port setLabels/createStory/setStoryTasks to call the new RPCs instead of separate PostgREST requests -- rename assertWritableTracker -> assertWritableProject to match the post-free-mode-removal name on current main (TASK-84 renamed it).

4. apps/mcp/src/handlers.integration.test.ts: port the 6 new test cases (sequence-consumption proof, 3 rollback-on-failure tests, cross-project label rejection, empty-payload-on-non-member-project error) -- insert before the "Permission paths" section (my TASK-70 renamed this section and flipped two tests; the new tests are unaffected by that, additive only).

5. spec/mcp.md: add the "Multi-write tools are atomic via one RPC" bullet -- clean addition.

6. apps/web/lib/utils/grant-lockdown.integration.test.ts: add set_story_tasks/set_story_labels/create_story_tracker to the CURRENT allowlist (already cleaned of swap_adjacent/create_project by TASK-84 -- do not re-add those, the branch's diff predates that cleanup).

7. Regenerate apps/web/lib/database.types.ts against the real post-migration local schema (do not manually port the branch's stale types diff).

8. rls-security-reviewer pass on both new migrations (task comment explicitly requires this since renumbering makes them "new" migrations even though content is largely unchanged).

9. Full verification against a real local Supabase reset: MCP + web integration suites, unit tests, tsc, ESLint.

10. Once ported and verified, delete the feat/mcp-atomic-writes branch (Fable's note says keep it only "until then" -- salvaged).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Salvaged the unmerged feat/mcp-atomic-writes branch (commit 79812c0) per Fable's task comment instructions, rather than reimplementing from scratch -- it was already advisor-approved and had already passed one rls-security-reviewer round (which found and fixed a HIGH-severity cross-project label attach gap on story_labels, confirmed still live on current main before this port landed). Manually ported (not git merge/rebase, since the branch predates TASK-84's free-mode removal and TASK-70's RLS relaxation and touches overlapping files):

- New migrations (renumbered to today's date): 20260719000003_mcp_atomic_writes.sql (create_story_tracker / set_story_tasks / set_story_labels, all SECURITY INVOKER, task inserts consume tasks_position_seq via DEFAULT instead of explicit indices) and 20260719000004_story_labels_cross_project_guard.sql (closes the HIGH-severity gap: the story_labels INSERT policy now also verifies label_id shares the story's project).
- apps/mcp/src/handlers.ts: setLabels/createStory/setStoryTasks now call the three RPCs instead of separate PostgREST DELETE-then-INSERT requests, so each tool call commits or rolls back as one unit. Renamed assertWritableTracker -> assertWritableProject to match TASK-84's post-free-mode naming (the only adjustment the port needed).
- apps/mcp/src/handlers.integration.test.ts: ported the 6 new tests (sequence-consumption proof, 3 rollback-on-induced-failure tests, cross-project label rejection, empty-payload-on-non-member-project error).
- spec/mcp.md + grant-lockdown allowlist updated.

Fresh rls-security-reviewer pass (required by Fable's comment since renumbering makes these "new" migrations): PASS, verified with LIVE exploitation, not just reading SQL -- real cross-project label attach attempt rejected, real induced mid-RPC failure confirmed rolled back, real non-member/viewer rejection confirmed, EXECUTE grants confirmed via pg_proc, position DEFAULT confirmed via information_schema.

/code-review (high effort, 8 finder angles + verify pass) on the ported diff found and fixed 2 real issues:
1. createStory resolves/creates labels BEFORE the RPC call (needed so a label failure can't leave an orphan story) -- but a viewer creating a story with a NOT-YET-EXISTING label name hit the labels table's own RLS before ever reaching the RPC's friendly "not allowed to create stories" message, leaking a raw RLS error instead. Fixed: resolveLabelIds now preserves the Postgres error code on the thrown Error, and createStory catches a 42501 from label resolution and surfaces the same friendly message. Verified empirically with a one-off scratch integration test (viewer + new label -> friendly message), then removed the scratch file.
2. Three new rollback tests only asserted "an error occurred," not that it was the EXPECTED mid-transaction failure -- for set_story_labels specifically (whose RPC/param shape isn't exercised successfully anywhere else in the suite), a typo'd RPC name or undeployed migration would have made the test pass without ever exercising real rollback. Tightened all three to assert the specific Postgres SQLSTATE. Caught my own mistake in the fix itself: assumed the label-rejection path was a foreign_key_violation (23503) and got it wrong on the first attempt -- the story_labels WITH CHECK (from migration 20260719000004) rejects a bogus/foreign label_id via RLS (42501) before any FK constraint is reached. Running the tests immediately caught this; corrected to 42501 for both label-related tests, kept 23502 (not_null_violation) for the tasks test.
One duplication finding (permission gate and label-insert logic copy-pasted across the two/three RPCs in the same migration) judged real but low-severity/pure-style -- left as-is rather than touching an already-twice-reviewed RPC design for a non-behavioral refactor.

Verified against a REAL local Supabase (not sandboxed): supabase db reset applies all migrations cleanly; SUPABASE_INTEGRATION=1 vitest = 19/19 MCP integration tests, 506/506 web integration tests; pnpm -r run test = 415/415 unit tests (one transient/flaky failure on an intermediate run, confirmed non-reproducible on immediate re-run); tsc --noEmit clean; ESLint clean.

feat/mcp-atomic-writes branch can now be deleted -- fully salvaged, nothing left to port.

Follow-up filed as TASK-97 (the stale branch's own TASK-81 numbering collided with tasks created on main since the branch diverged): 'Add UNIQUE(project_id, name) to labels; make resolveLabelIds ON CONFLICT-based' — advisor-noted during the original TASK-71 work on the salvaged branch, low priority, race-condition hardening, out of scope for this task.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-fable-5
created: 2026-07-18 16:32
---
Branch audit 2026-07-19: an unmerged implementation of this task exists on feat/mcp-atomic-writes (single commit 79812c0, 2026-07-18, branched from pre-free-mode main at 5930e1f). It cannot merge as-is: its migration 20260718000001_mcp_atomic_writes.sql collides with main's 20260718000001_remove_free_mode.sql (Supabase rejects duplicate versions), its second migration 20260718000002_story_labels_cross_project_guard.sql also predates main's numbering, and handlers/database.types were written before the free-mode removal refactor. Whoever picks this task up: renumber both migrations to a fresh date, rebase onto current main, re-run the full MCP integration suite, and get the rls-security-reviewer pass (two new migrations). The branch is kept for reference until then — do not delete without salvaging the migration/handler logic.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Salvaged the unmerged feat/mcp-atomic-writes branch (already advisor-approved and partially rls-security-reviewed) rather than reimplementing: renumbered its two migrations, ported the handlers.ts/test changes onto current main (post free-mode removal, post TASK-70 RLS relaxation). set_story_tasks/set_story_labels/create_story_tracker are now atomic SECURITY INVOKER RPCs; task inserts consume tasks_position_seq via DEFAULT. Also closes a HIGH-severity, currently-live cross-project label attach gap (story_labels INSERT policy now checks label_id shares the story's project). Fresh rls-security-reviewer pass did live exploitation testing and passed. A high-effort /code-review pass found and fixed a real bug (viewer + new label name leaked a raw RLS error instead of the friendly denial message) and tightened 3 loosely-asserted rollback tests (catching my own mistaken SQLSTATE assumption in the process, corrected after running the tests). Verified against a real local Supabase: 19/19 MCP + 506/506 web integration tests, 415/415 unit tests, tsc, ESLint all pass.
<!-- SECTION:FINAL_SUMMARY:END -->
