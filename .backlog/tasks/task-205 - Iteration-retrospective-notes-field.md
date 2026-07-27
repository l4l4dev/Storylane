---
id: TASK-205
title: Iteration retrospective notes field
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-27 01:48'
updated_date: '2026-07-27 02:14'
labels: []
milestone: m-0
dependencies: []
priority: low
ordinal: 1900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Iterations already carry a forward-looking iterations.goal (see spec/velocity.md), but nothing captures the backward-looking retrospective — what went well/what to improve after a sprint closes. Add a lightweight retro-notes field to iterations so the retrospective has a durable home next to the goal, instead of living only in ephemeral meeting notes or being bolted onto activity_logs. Update spec/data-model.md and spec/velocity.md (or spec/screens.md for the UI location) to document the new field and where it's edited.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 iterations table gains a retro_notes (or equivalent Keep/Problem/Try fields) column, nullable, editable only by owner/member (viewer read-only, per spec/rls.md role guidelines)
- [x] #2 Editable from the iteration bar/board UI next to the existing goal editor, autosaving like the goal field (no Save button, per spec/screens.md conventions)
- [x] #3 Editable on the current iteration and any past done iteration (so a retro can be written after the sprint closes), not on virtual future iterations
- [x] #4 spec/data-model.md and the relevant screens/velocity spec section are updated to document the field
- [x] #5 Tests cover the new column's RLS/role restrictions and the autosave path
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration: add nullable iterations.retro_notes text column. No new RLS policy needed — the existing 'members can update iterations' (owner/member) and 'members can view iterations' (any member) policies from 20260627000004_iterations.sql already cover it identically to goal.
2. supabase db push against local stack + regenerate apps/web/lib/database.types.ts.
3. actions.ts: add updateIterationRetroNotes(formData), mirroring updateIterationGoal (plain .update() relying on existing RLS), revalidating board + iterations history paths.
4. UI: add IterationRetroNotesBar in kanban-board.tsx (useInlineEdit + textarea, same click-to-edit contract as IterationGoalBar) exported for reuse. Render next to IterationGoalBar on the board for the current iteration, and per-iteration on the iterations history page (app/projects/[id]/iterations/page.tsx) for past done iterations. Not rendered for virtual future iterations (no DB row to attach it to).
5. Docs: spec/data-model.md (iterations table), spec/screens.md (Board layout + iteration history section) note the field and its editable window.
6. Tests: actions.test.ts unit test for updateIterationRetroNotes (mirrors the update-chain pattern already in that file); kanban-board.test.tsx tests for IterationRetroNotesBar mirroring IterationGoalBar's show/edit/commit/escape coverage. No new RLS integration test — reuses the already-existing iterations UPDATE/SELECT policies verified via AC#1's role split (owner/member write, viewer read-only), not a new policy surface.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: migration 20260727100000_iteration_retro_notes.sql adds nullable iterations.retro_notes (no new RLS — reuses the existing owner/member UPDATE + any-member SELECT policies from 20260627000004_iterations.sql, confirmed by reading that migration). Applied to the local shared Supabase stack via 'supabase migration up --local' and regenerated apps/web/lib/database.types.ts via 'supabase gen types typescript --local' (retro_notes: string | null confirmed present).

Added updateIterationRetroNotes server action (board/actions.ts, mirrors updateIterationGoal) and IterationRetroNotesBar client component (kanban-board.tsx, mirrors IterationGoalBar but textarea-based — Enter inserts a newline, only blur/Esc act). Wired into: the board's current-iteration info row (kanban-board.tsx, next to IterationGoalBar) and the iterations history page (app/projects/[id]/iterations/page.tsx) for each past done iteration, gated on a new project_members role lookup (canEditRetroNotes = owner/member; viewer sees plain read-only text, matching the existing iterations RLS split). Not rendered anywhere for virtual future iterations (board-list-view.tsx's virtual group headers untouched).

Docs: spec/data-model.md (iterations table) and spec/screens.md (Board layout info row + iterations route description) updated.

Verification: pnpm exec tsc --noEmit -p . clean; pnpm test — 91 files / 842 tests passed, 258 skipped (gated SUPABASE_INTEGRATION=1 integration tests, unaffected by this change); pnpm run lint clean. New tests: actions.test.ts 'updateIterationRetroNotes' (trim + null-on-empty), kanban-board.test.tsx 'IterationRetroNotesBar' (text/ghost display, click-to-edit, blur commit, Escape revert without saving, error-keeps-editor-open) plus the kanban-board-toolbar.test.tsx fixture updated for the new IterationMeta field.

Held at In Progress (not Done) pending the project's required /code-review pass before proposing a commit (CLAUDE.md Review Workflow) — owner needs to run it.

/code-review findings addressed:
1. IterationRetroNotesBar was unconditionally editable on the board (viewer could type into it; RLS would silently no-op the write) — gated behind the existing canFinishIteration (owner/member) prop, same as FinishIterationButton/IterationDates in the same file; viewer now sees read-only text (or nothing if empty), matching the iterations-history page's own gate.
2. updateIterationRetroNotes only checked .error, not row count, unlike assertRowAffected used elsewhere in the same actions.ts file for this exact silent-RLS-noop class of bug — added .select('id') + assertRowAffected. (Reviewer noted updateIterationGoal has the same pre-existing gap — out of scope for this task, not touched.)
3. iterations/page.tsx ran the new membership lookup and the iterations query sequentially despite being independent — parallelized via Promise.all (membership still runs after, since it depends on user.id from the parallelized getUser() call).

Added 2 regression tests (kanban-board-toolbar.test.tsx) proving the gate: viewer sees read-only text/no editor, owner/member sees the editable control. Re-ran full verification: tsc --noEmit clean, pnpm test 844/844 passing (258 skipped integration tests unaffected), pnpm run lint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added iterations.retro_notes (nullable, no new RLS — reuses the existing goal column's owner/member update / any-member read policy), a click-to-edit textarea UI (IterationRetroNotesBar) on the board's current iteration and on past done iterations (iterations history page), gated to owner/member (viewers see read-only text). Verified via tsc --noEmit, full vitest suite (844 passing), eslint, and targeted component/action tests including two regression tests for the /code-review-found viewer-visibility gap. Fixed 3 /code-review findings: missing role gate on the board control, missing assertRowAffected row-count check in the new action, and sequential (should-be-parallel) queries in iterations/page.tsx.
<!-- SECTION:FINAL_SUMMARY:END -->
