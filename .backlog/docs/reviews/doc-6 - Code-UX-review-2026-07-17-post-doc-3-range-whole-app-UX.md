---
id: doc-6
title: Code & UX review 2026-07-17 (post doc-3 range + whole-app UX)
type: other
created_date: '2026-07-17 13:17'
updated_date: '2026-07-17 13:17'
---
# Code & UX review — 2026-07-17

Scope: (a) code review of b7fb2d1..HEAD (~30 commits since doc-3: TASK-56 slice 2, 51, 57, 58, 64–68, 34, 40, 48 MCP server + transition_story, 50, 69) by Codex (GPT-5) + rls-security-reviewer (live-verified against local Supabase); (b) whole-app UI/UX review by fable-advisor against spec/ux-principles.md. A third independent Claude reviewer died on session limits and was not replaced — Codex + the RLS pass covered its ground.

## Code findings (triaged)

1. [HIGH → TASK-48 AC#5] transition_story lost-update race — no FOR UPDATE on the story read, no state re-check on write; rls-security-reviewer REPRODUCED concurrent accept/reject both succeeding, last write silently winning (corrupts velocity + completed_at). Found independently by Codex. Fix: one-line 'for update' on the SELECT. Also AC#6: revoke line omits 'authenticated' (style-only, TASK-55 convention).
2. [HIGH → TASK-70] Permission-model split: stories UPDATE RLS + transition_story restrict a member to own/assigned stories, but move_story_board (SECURITY DEFINER) lets ANY member apply arbitrary deltas incl. state via direct RPC. Owner decision (Pivotal-style open vs strict) then align all three surfaces.
3. [HIGH → TASK-71] MCP write paths: set_story_tasks writes explicit positions that bypass tasks_position_seq (future deferred-UNIQUE collisions, violates the TASK-58 position invariant); set_story_tasks / setLabels / createStory+labels are non-transactional multi-request flows that can destroy or duplicate data on partial failure.
4. [LOW → TASK-76] swap_adjacent NULL p_table/p_direction slip through NOT IN validation (NULL → false branch) instead of raising.
5. Checked clean (Codex): insert_board_item guards/splice, move_story_board locking + stale-snapshot check, swap_adjacent serialization, sequence rebasing + unique constraints, create_project atomicity, guard helpers, composite FKs, MCP auth model (anon key, no service role), monorepo workspace/exports/transpilePackages, dead-code removal fallout, grant lockdown, e2e selector fix.

## UX findings (fable-advisor; verdict: approve-with-fixes, 1 deploy blocker)

- [BLOCKER → TASK-72] Epic Delete: always-visible, no confirmation, next to Edit; failures nuke the view via route error boundary. Also free-board column delete (no confirm, cards fall to first column).
- [should-fix → TASK-73] IME: Escape/Enter handlers lack isComposing guards outside story-detail-panel — Esc during Japanese conversion destroys typed text in quick-add, goal editors, note input, free-board editors.
- [should-fix → TASK-74] transition-buttons.tsx (+ task-checklist, comment-thread) are bare form actions: no pending state, double-submit possible, everyday races surface as the full-board error boundary.
- [should-fix → TASK-75] Date format drift: 4 spots still render raw YYYY-MM-DD next to formatDate's YYYY/M/D.
- [should-fix → TASK-60 AC#4/5] DividerRow note delete + InsertBetweenRows submitNote are fire-and-forget; submitNote clears the input before knowing the outcome.
- [polish → TASK-77] List-shaped skeleton, filter clear-all + filtered-totals cue, badge radius unification, StoryPeek focus, activity paging, view-selection persistence (owner decision).
- Already tracked: TASK-52/59/61 confirmed still valid; principles 1/4/7/8/9/10 verified held.
- Owner visual checklist (cannot be verified from code): label/epic colors in light+dark, IME behavior in the composers, backlog group header at ~1000px width, filtered totals, hover insert-line vs row hover, side peek vs Icebox overlap, 5px drag threshold, Focus done-group date label, empty-project first-run, free-mode swimlane scroll alignment. → gate for TASK-3.

## Session repairs (done in-session)

- e2e core-flow: stale pre-TASK-32 expectation (redirect back to /dashboard) fixed → suite green in 10.1s. TASK-69 closed.
- Local DB found empty (a review agent's supabase db reset skipped seed); restored via supabase db reset with seed.
- TASK_ARCHIVE.md → backlog doc-4; docs/superpowers plans/specs (gitignored) → specs archived to doc-5, plans deleted; TASK.md/CLAUDE.md pointers updated.

## Execution order (ordinals rewritten 2026-07-17)

72 → 73 → 74 → 75 → 59 → 60 → 61 → 52 → 62 → 70 → 48(close: race fix + owner bot setup) → 71 → 76 → [owner: visual checklist + TASK-3 deploy] → 49 dogfooding → 30 decision → 77 polish → 24 (iOS-phase start). Milestones: none archivable yet (every milestone retains open tasks); Done tasks moved to completed via backlog cleanup.
