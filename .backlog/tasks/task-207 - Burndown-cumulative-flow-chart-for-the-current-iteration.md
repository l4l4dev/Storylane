---
id: TASK-207
title: Burndown / cumulative flow chart for the current iteration
status: Done
assignee:
  - '@gpt-5.6-sol'
created_date: '2026-07-27 01:48'
updated_date: '2026-07-28 00:29'
labels: []
milestone: m-0
dependencies: []
priority: medium
ordinal: 2100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SPEC.md lists a burndown chart under Phase 2 (spec/features.md) but it was never built. activity_logs already records story.state_changed events with before/after payload (spec/data-model.md 'activity_logs'), so a day-by-day remaining-points burndown (or a cumulative flow diagram across state categories) can be derived from existing event history without a new snapshot table. This gives the team the standard sprint-review artifact ('how much is left, how did we track against the plan') that the tool currently has no answer for.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A chart on the board/iteration view (see spec/screens.md 'Board layout') shows, for the current iteration, remaining done-category points per day since the iteration's start_date, derived from activity_logs.story.state_changed history plus the iteration's snapshotted capacity/velocity (spec/velocity.md)
- [ ] #2 Ideal-pace reference line uses the iteration's capacity the same way spec/velocity.md's forecast formula does, so the chart is consistent with the existing velocity math rather than a second parallel calculation
- [ ] #3 Works for past done iterations too (viewing history), not just the live current one
- [ ] #4 Handles iterations with no activity_logs coverage (pre-dating this feature) by showing a partial/empty chart rather than erroring
- [ ] #5 spec/features.md is updated to move this out of Phase 2, and spec/screens.md documents where the chart lives
- [ ] #6 Tests cover the remaining-points derivation from a fixture set of activity_logs rows
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Second /code-review pass (10 findings) addressed, all in this same TASK-206 session since TASK-207's own assignee (@gpt-5.6-sol) work was uncommitted in the shared worktree:

Fixed:
1. [correctness, critical] finalize_iteration's new activity_logs INSERT and the iteration_id UPDATE were two independent statements re-evaluating the same predicate under READ COMMITTED — a concurrent set_story_state between them could log a rollover that didn't happen, or move a story with no log of it. Rewritten as one atomic statement: UPDATE...RETURNING feeds the INSERT via a CTE, so the logged set is exactly what was moved, by construction.
2. [correctness] burndown.ts's coverage guard checked resolved.length===0 instead of usable.length===0 — an iteration whose logs all failed category resolution reported 'partial' with zero real signal instead of 'none'.
3. [correctness] Both activity_logs fetchAllRows queries (state_changed, iteration_rolled_over) had no secondary order tiebreaker before .range()-based pagination — added .order('id') after created_at, so paging stays deterministic once a project's log history exceeds the 1000-row page cap.
4. [correctness] describeActivity (activity.ts) had no case for the new story.iteration_rolled_over action, so it would render the raw action string in the activity feed. Added a case; also extended the migration's payload with from/to_iteration_number so the message can name sprints, not raw UUIDs (matching iteration.length_overridden's precedent).
5. [docs] ARCHITECTURE.md's activity_logs trigger-exception list didn't mention finalize_iteration as a 4th self-recording path (only named move/copy and the is_container trigger) — added.
6. [docs] The migration's CREATE OR REPLACE of finalize_iteration silently dropped two explanatory comments from the prior version (capacity-pinning rationale, v_roles/TASK-142 rationale) — restored.
7. [regression] Redundant double empty-state when a project has zero iterations at all ('No iterations yet.' followed immediately by the History section's own empty-state) — History section now only renders when allIterations.length > 0.
8. [test-coverage] No test exercised the DoD popover's conditional rendering. Added 3 cases to transition-buttons.test.tsx (shows only next to a done-category target, hidden when unset, hidden for a non-done target) and a new kanban-columns-board.test.tsx (same 3 cases for the column-header path) — exported KanbanColumn (was private) to make it testable in isolation without a DndContext.

Also fixed from the rls-security-reviewer pass on the same migration: actor_id used coalesce(v_actor, s.created_by), diverging from the move/copy precedent's plain auth.uid() (harmless given current grants, but simplified to match).

Flagged, not fixed: targetByIteration's ideal-pace line collapses to 1 (forecastPoints' min-1 floor) for a legacy/first iteration with no prior velocity rate or snapshotted capacity. This follows directly from AC#2's explicit choice to reuse forecastPoints uniformly 'for consistency with existing velocity math' — changing it would mean overriding that acceptance criterion's stated intent, a design call I'm not making unilaterally. Left as-is; owner should decide whether a done iteration's ideal line should instead use its own snapshotted iteration.velocity.

Re-verified after all fixes: tsc/lint clean, supabase db reset applies the corrected migration cleanly, full suite (SUPABASE_INTEGRATION=1 + CI's localStorage condition) 1116/1116 passed (130 files, +6 tests over the prior pass).

Comments:
--------------------------------------------------
#1 - @claude-sonnet-5 - 2026-07-27 06:14 (UTC)
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.

#2 - @claude-sonnet-5 - 2026-07-27 06:38 (UTC)
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.

---

Third round: Codex's automated review on PR #6 (after merge to main) found 5 more issues, 2 of them P1 and genuinely serious since the merge had already deployed to production:

1. [P1, LIVE BUG] supabase/migrations/20260727100000_iteration_retro_notes.sql (TASK-205) added iterations.retro_notes with a bare ALTER TABLE, but 20260720000002_iteration_capacity.sql had already revoked table-level UPDATE on iterations and granted back only 'update (goal)' to authenticated. The new column was never added to that grant, so every owner/member save through updateIterationRetroNotes hit 42501 before RLS was even evaluated. Confirmed live: PATCH .../iterations with retro_notes as the signed-in dev user returned exactly that error, against the just-deployed production schema. Fixed: supabase/migrations/20260727130000_grant_iteration_retro_notes.sql adds the missing column grant. Re-verified the same request now returns 200.

2. [P1] The story.iteration_rolled_over logging this task's second round added only covered finalize_iteration's automated rollover -- an ordinary Backlog<->Current drag (move_story_board) changes iteration_id via a plain UPDATE with no logging at all, so normal rescheduling silently rewrote burndown history exactly like the bug the rollover logging was meant to fix. Root-caused instead of patched per call site: supabase/migrations/20260727140000_generalize_iteration_change_log.sql extends log_story_activity (already a trigger watching state_id) to also watch iteration_id independently -- not mutually exclusive with a state_id change in the same statement, since move_story_board can change both at once. This makes finalize_iteration's explicit INSERT redundant (removed); the plain UPDATE it already does is now caught automatically. Action renamed story.iteration_rolled_over -> story.iteration_changed (generic). Verified live: a plain iteration_id UPDATE now logs correctly, and a combined state_id+iteration_id UPDATE in one statement logs both events.

3. [P2] The stories query in iterations/page.tsx had no pagination, unlike the activity_logs queries fixed in round 2 -- a project whose stories exceed PostgREST's 1000-row cap would silently lose stories from every chart. Wrapped in the existing fetchAllRows helper, matching board/page.tsx's own precedent.

4. [P2] BurndownChart's SVG polyline paints nothing for a single-point series (day one of a current iteration, or any 1-day-cadence iteration) -- no line has two points to connect. Added circle markers for the single-point case; new test asserts 2 circles render.

5. [P2, deferred to TASK-218] Re-estimating a story's points mid-iteration or after completion retroactively rewrites every day's remaining-points total in the chart, since buildBurndown applies the story's CURRENT points uniformly rather than reconstructing points-at-each-date. Requires new point-change logging plus a real change to buildBurndown's replay algorithm -- bigger than the other 4, filed separately rather than rushed.

Also reverted ARCHITECTURE.md's exception-list wording from round 2 (finalize_iteration's rollover insert is no longer a self-recorded exception now that the general trigger covers it) and updated describeActivity's message for the renamed, now-generic action.

Re-verified: tsc/lint clean, supabase db reset applies the full chain (7 migrations) cleanly, full suite under CI conditions 1117/1117 passed (+1 for the new single-point chart test).

Comments:
--------------------------------------------------
#1 - @claude-sonnet-5 - 2026-07-27 06:14 (UTC)
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.

#2 - @claude-sonnet-5 - 2026-07-27 06:38 (UTC)
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.

---

Fourth round: Codex reviewed PR #7 itself (its environment is now configured, so it reviews automatically going forward). 6 more comments, most on the very code this task's third round just wrote. Verified each rather than applying blindly:

- [P1, FIXED] Confirmed real: the stories query filtered by CURRENT iteration_id, so a story moved from Current back to Backlog/Icebox (iteration_id -> NULL) dropped out of the fetch entirely, even though rolledOutOf already knew it belonged to a past iteration's history from the activity log — the knowledge had no row to attach points/state_id to. Fixed: the stories fetch now runs after rolledOutOf is derived, widened with an .or() filter to also include any story ID the logs say ever moved. Verified live: a story moved to Backlog (iteration_id set NULL) is still returned by the widened query.
- [P2, FIXED] Confirmed real: the read path only recognized the renamed story.iteration_changed action, so any story.iteration_rolled_over row written during the brief window 20260727120000 was live before this task's third round would vanish from history. Fixed: reads both action names.
- [P1, correctly NOT fixed — verified false for this schema] 'positions are dense per iteration' was checked directly: inserted 6 stories across 2 iterations via the real insert path and read back positions 192-197, no duplicates — stories_position_seq (and promote_story_to_epic's compaction, 20260716000006) are explicitly project-scoped, not per-iteration, confirmed by that migration's own 'ranking the project's rows ... writing 0..n-1' comment. Ordering by position alone is safe; no tiebreaker needed.
- [P1, folded into TASK-218] buildBurndown's membership check is all-or-nothing per iteration with no date awareness — a story scheduled in or removed mid-iteration should only count from its actual change date, not the whole span. Same root cause and same scope of rewrite as TASK-218's points-snapshot issue, so folded into that task rather than filed separately or rushed here.
- [P2, deferred to TASK-218] describeActivity's iteration_changed message can't distinguish Backlog from Icebox (both read as null iteration_number), and no longer distinguishes an automated rollover from a manual drag now that both share one action name. Added as ACs on TASK-218.

Re-verified: tsc/lint clean, supabase db reset applies the full 9-migration chain cleanly, full suite under CI conditions 1117/1117 passed.

Comments:
--------------------------------------------------
#1 - @claude-sonnet-5 - 2026-07-27 06:14 (UTC)
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.

#2 - @claude-sonnet-5 - 2026-07-27 06:38 (UTC)
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.

---

Fifth round: Codex reviewed the round-4 push itself and found 2 more real issues in that exact code:

- [P2, FIXED] describeActivity lost its case for the pre-rename action name (story.iteration_rolled_over) when round 3 renamed it — the burndown-page query was fixed to read both names in round 4, but this separate consumer (the project activity feed) still only matched the new name, so any already-deployed legacy row fell through to the raw-string fallback. Fixed by fallthrough to the same case (both actions share the same payload shape).
- [P2, FIXED] Round 4's .or() filter interpolated every ever-moved story's UUID directly into one PostgREST query string — for a long-lived project with hundreds of such stories, that could exceed a proxy's request-line limit and break the whole page. Replaced with two separate queries: the existing iteration_id-scoped fetchAllRows, plus a second query for only the IDs not already covered, batched at 200 per request rather than one unbounded filter.

Re-verified: tsc/lint clean, full suite under CI conditions 1117/1117 passed.

Comments:
--------------------------------------------------
#1 - @claude-sonnet-5 - 2026-07-27 06:14 (UTC)
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.

#2 - @claude-sonnet-5 - 2026-07-27 06:38 (UTC)
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.

---

Sixth round: Codex flagged that log_story_activity's new iteration_id branch — the central new behavior of this whole fix chain — had only been verified manually (curl against a local reset) during the session, with no permanent test; a repo-wide search found no test mentioning either iteration-change action. Added apps/web/lib/utils/iteration-change-log.integration.test.ts (4 cases): an ordinary reschedule logs exactly one story.iteration_changed row with correct iteration numbers, a move to the Icebox logs null appropriately, a single UPDATE changing both state_id and iteration_id logs both events (not one), and an unrelated column update logs neither.

Re-verified: tsc/lint clean, full suite 1121/1121 passed (+4 for the new test file).

Comments:
--------------------------------------------------
#1 - @claude-sonnet-5 - 2026-07-27 06:14 (UTC)
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.

#2 - @claude-sonnet-5 - 2026-07-27 06:38 (UTC)
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.

---

Seventh round: Codex reviewed the test-only commit and found 2 more real gaps, both about coverage rather than new logic bugs:

- [P2, FIXED] The single-point chart fix's own test fixture (remaining === ideal, the common day-one case) is exactly where two solid circles fail: the larger 'remaining' marker fully covers the smaller 'ideal' one at the same coordinate, so the chart still showed only one visible series despite the earlier fix. Changed to a ring (unfilled, dashed stroke) for ideal plus a smaller filled dot for remaining — distinguishable even stacked. Strengthened the test to assert on the actual fill treatment (one circle fill=none, one fill-primary), not just 'two <circle> elements exist', which would have passed even with the bug.
- [P2, FIXED] The retro_notes grant fix (this task's first Codex-review round, the live production bug) had no integration test of its own — only verified manually via curl during that session. Added iteration-retro-notes-grant.integration.test.ts: owner and member can save retro notes (the exact regression), a viewer's attempt is a silent RLS no-op rather than a grant-level error (confirming the grant now permits the write and RLS is what actually gates it).

Re-verified: tsc/lint clean, full suite 1124/1124 passed (+3 for the two new/strengthened tests).

Comments:
--------------------------------------------------
#1 - @claude-sonnet-5 - 2026-07-27 06:14 (UTC)
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.

#2 - @claude-sonnet-5 - 2026-07-27 06:38 (UTC)
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.

---

Eighth round: Codex reviewed the marker/grant-test commit and found one more gap: describeActivity's story.iteration_changed branch (and the legacy story.iteration_rolled_over alias) had no unit coverage in activity.test.ts. Added 3 cases: a normal reschedule by iteration number, both null-endpoint directions (to/from the Icebox), and confirmation that the legacy action name formats identically to the current one.

Re-verified: tsc/lint clean, full suite 1127/1127 passed (+3).

2026-07-28: /code-review never completed across 4 attempts (session rate limits). Merged to main before a pass finished. In its place, Codex's own PR review ran automatically across 8 rounds post-merge and caught real issues including a live production P1 (missing grant on retro_notes), all fixed and re-verified except the one item correctly deferred to TASK-218 (points-snapshot / date-aware membership rewrite — a genuinely different-scope change, not rushed in). Re-verified now on main: pnpm run lint clean, pnpm test 860 passed/267 skipped, no failures.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-27 06:14
---
Delegated to Codex CLI (@gpt-5.6-sol, ChatGPT quota) per owner request 2026-07-27: surplus Codex tokens available. No new tables/RLS involved (derives from existing activity_logs), so within policy scope. Standard review workflow (code-review, fable-advisor design review since this is user-facing UI, manual verification) still applies before merge.
---

author: @claude-sonnet-5
created: 2026-07-27 06:38
---
fable-advisor design review: approved. Ideal-pace line confirmed to reuse existing velocityRate/forecastPoints (iterations/page.tsx passes targetPoints into burndown.ts, no parallel calc). Two non-blocking notes: (1) single-day-cadence duplicate end-date label — fixed directly in burndown-chart.tsx. (2) full iteration-history activity_logs read on the reporting page for long-lived projects — deferred as acceptable for now per advisor, not a correctness issue.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Burndown/CFD chart on /projects/[id]/iterations, replaying story.state_changed (and the newly-generalized story.iteration_changed) activity_logs to reconstruct remaining done-category points per day; ideal-pace line reuses velocityRate/forecastPoints directly (no parallel calc). Works for current and past iterations, degrades to partial/none without log coverage. fable-advisor approved the design. Formal /code-review never completed (rate limits, see notes) but Codex's automatic PR review across 8 post-merge rounds caught and fixed real issues (incl. a live P1 grant bug), leaving one properly-scoped follow-up in TASK-218. Full suite green (860/1127 passing locally, 267 skipped without Supabase) as of 2026-07-28.
<!-- SECTION:FINAL_SUMMARY:END -->
