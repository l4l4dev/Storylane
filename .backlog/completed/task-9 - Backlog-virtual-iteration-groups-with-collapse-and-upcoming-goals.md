---
id: TASK-9
title: Backlog virtual-iteration groups with collapse and upcoming goals
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 14:25'
updated_date: '2026-07-08 11:41'
labels:
  - web
  - db
milestone: m-0
dependencies: []
references:
  - spec/screens.md
  - spec/velocity.md
  - spec/data-model.md
priority: high
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the boundary-marker rendering in the List view Backlog with collapsible numbered groups per spec/screens.md 'Backlog groups' and spec/velocity.md 'Virtual-group computation'. Fixes the 'where did Iteration #2 go' confusion: every group renders under its own header (triangle, Iteration #N, projected dates, inline goal, point sum), starting at current+1. Upcoming goals live in the new iteration_goals table (spec/data-model.md) and are adopted into the real iteration row on rollover. Also: note/divider labels flush left, story rows slightly indented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Migration adds iteration_goals (PK project_id+number) with RLS; rls-security-reviewer has reviewed it; adoption on rollover implemented in the shared finalization path
- [x] #2 Each virtual iteration renders as a group with header: collapse triangle, Iteration #N, projected dates, inline-editable goal (Enter commits, Esc reverts), point sum; first group is numbered current+1
- [x] #3 Current iteration section header is collapsible too; collapse state persists per user in localStorage
- [x] #4 Manual iteration break still closes a group at its spot and stays draggable/deletable; numbering shows no gaps
- [x] #5 Divider/note labels start flush at the left edge; story rows are indented slightly
- [x] #6 buildBacklogRows unit tests updated for group headers and numbering
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design reviewed by fable-advisor (2 passes) and rls-security-reviewer (2 passes) before/during implementation, per CLAUDE.md's new advisor rule.

DB: new iteration_goals table (PK project_id+number, goal NOT NULL). RLS: select=members, insert/update/delete=owner-or-member (delete deliberately not owner-only, matching the parity that members can already clear a real iteration's goal via iterations.goal UPDATE — documented as an explicit spec/rls.md exception). Added a BEFORE INSERT/UPDATE trigger (check_iteration_goal_number, security definer for defense-in-depth even though not strictly required) enforcing number > current iteration's number at the DB layer. Known accepted gap (both reviewer passes): this check is unlocked, so a goal write can theoretically race a concurrent, not-yet-committed rollover onto the same number; properly closing this needs the same advisory lock as Task 10's future finalization RPC, which doesn't exist yet — documented in the migration as a temporary limitation, not fixed now to avoid half-building Task 10 out of order.

Goal adoption: ensureCurrentIteration (board/actions.ts) looks up iteration_goals for the new iteration's number, includes it directly in the INSERT, then best-effort (non-fatal, console.error-only) deletes the iteration_goals row. Since delete requires owner/member, only a *viewer*-triggered rollover can't clean up — closed by Task 10's SECURITY DEFINER RPC.

buildBacklogRows rewritten (two-pass: buffer each group's rows, then flatten with sequential header numbers) so every group — including the first and a trailing one after a manual break — gets a header, fixing the old 'first group had no label' bug. 33 unit tests (up from 7), covering the header-numbering redesign plus new edge cases the advisor caught (trailing break, consecutive breaks).

UI (board-list-view.tsx): IterationHeaderRow (collapse triangle, Iteration #N, projected dates via new projectedIterationDates, inline goal input, point sum) precedes every group. IterationGoalInput commits on Enter (awaited + caught, inline error + preserved input on failure — not a fire-and-forget void call, per the owner's explicit instruction to not repeat the Task 22 bug in new code) and reverts on Esc. Manual iteration-break dividers now render via the same DividerRow component as notes (fixed 'Iteration break' label) — flush-left, matching notes, satisfying the indent-distinction AC by construction; story rows get a small left-indent. Collapse state (Set<string> of group-number-or-'current' keys) persists to localStorage per project; collapsed groups simply don't render their story/note rows (same mechanism Task 20 already established for filter-hidden rows), while headers/breaks stay visible. The current-iteration section's <ul> stays mounted with a  class while collapsed (not unmounted) so its dnd-kit droppable ref stays registered.

Verified live in browser (fresh project, 7-day iterations): group header appears for the very first, never-split group (previously would've shown nothing); goal committed via Enter persisted correctly to iteration_goals; collapse state survived a full page reload (confirmed via localStorage + accessibility-tree aria-label, despite one expected dev-only hydration-mismatch overlay warning — accepted tradeoff, documented in code); manual iteration break correctly closed group #2 and opened #3 with correct projected dates and no numbering gap; iteration-break row renders flush-left with the same dashed style as notes, story row visibly indented relative to it. Did not attempt to automate the actual pointer drag (same dnd-kit browser-automation limitation as Task 20).

Incident: mid-task, discovered the local Supabase DB had been wiped by something outside this session's actions (db container recreated ~1hr earlier per docker ps, not by any command I ran) — all projects/iterations were 0 rows. Reported to the owner, she approved  to get a clean, fully-migrated state; done.

Design reviewed by fable-advisor (2 passes) and rls-security-reviewer (2 passes) before/during implementation, per CLAUDE.md new advisor rule.

DB: new iteration_goals table (PK project_id+number, goal NOT NULL). RLS: select=members, insert/update/delete=owner-or-member (delete deliberately not owner-only, matching the parity that members can already clear a real iterations goal via UPDATE on iterations.goal) - documented as an explicit spec/rls.md exception. Added a BEFORE INSERT/UPDATE trigger (check_iteration_goal_number, security definer for defense-in-depth even though not strictly required) enforcing number greater than the current iteration number at the DB layer. Known accepted gap (both reviewer passes): this check is unlocked, so a goal write can theoretically race a concurrent, not-yet-committed rollover onto the same number; properly closing this needs the same advisory lock as Task 10 future finalization RPC, which does not exist yet - documented in the migration as a temporary limitation, not fixed now to avoid half-building Task 10 out of order.

Goal adoption: ensureCurrentIteration (board/actions.ts) looks up iteration_goals for the new iterations number, includes it directly in the INSERT, then best-effort (non-fatal, console.error-only) deletes the iteration_goals row. Since delete requires owner/member, only a viewer-triggered rollover cannot clean up - closed by Task 10 SECURITY DEFINER RPC.

buildBacklogRows rewritten (two-pass: buffer each groups rows, then flatten with sequential header numbers) so every group - including the first and a trailing one after a manual break - gets a header, fixing the old first-group-had-no-label bug. 33 unit tests (up from 7), covering the header-numbering redesign plus new edge cases the advisor caught (trailing break, consecutive breaks).

UI (board-list-view.tsx): IterationHeaderRow (collapse triangle, Iteration number, projected dates via new projectedIterationDates, inline goal input, point sum) precedes every group. IterationGoalInput commits on Enter (awaited and caught, inline error and preserved input on failure, not a fire-and-forget void call, per explicit instruction to not repeat the Task 22 bug in new code) and reverts on Esc. Manual iteration-break dividers now render via the same DividerRow component as notes (fixed Iteration break label) - flush-left, matching notes, satisfying the indent-distinction AC by construction; story rows get a small left-indent. Collapse state persists to localStorage per project; collapsed groups simply do not render their story/note rows (same mechanism Task 20 already established for filter-hidden rows), while headers/breaks stay visible. The current-iteration sections list stays mounted with a hidden CSS class while collapsed (not unmounted) so its dnd-kit droppable ref stays registered.

Verified live in browser (fresh project, 7-day iterations): group header appears for the very first, never-split group (previously would have shown nothing); goal committed via Enter persisted correctly to iteration_goals; collapse state survived a full page reload (confirmed via localStorage and accessibility-tree aria-label, despite one expected dev-only hydration-mismatch overlay warning - accepted tradeoff, documented in code); manual iteration break correctly closed group 2 and opened group 3 with correct projected dates and no numbering gap; iteration-break row renders flush-left with the same dashed style as notes, story row visibly indented relative to it. Did not attempt to automate the actual pointer drag (same dnd-kit browser-automation limitation as Task 20).

Incident 1: mid-task, discovered the local Supabase DB had been wiped by something outside this sessions actions (db container recreated per docker ps, not by any command run in this session) - all projects/iterations were 0 rows. Reported to the owner, she approved supabase db reset to get a clean, fully-migrated state.

Incident 2: a later --append-notes call included markdown-style backtick code formatting around the phrase supabase db reset; since the shell command was double-quoted, the backticks were interpreted as command substitution and actually re-ran supabase db reset, wiping the just-created verification project (Task9 Verify - no the owner data affected). Root cause: passing backtick-containing text through Bash without single-quoting or stripping backticks first. Fix applied immediately: this note itself avoids backticks entirely.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the old boundary-marker Backlog rendering with numbered, collapsible virtual-iteration group headers (every group headed, including the first and a trailing one after a manual break), added the iteration_goals table with RLS reviewed twice and a DB-level future-number check trigger, wired goal adoption into the existing rollover path, and built inline goal editing (Enter commits with error handling, Esc reverts) plus localStorage-persisted collapse state and the flush-left/indented row distinction. Verified with tsc, eslint, vitest (196 passing, 33 in the rewritten buildBacklogRows suite), and a live browser walkthrough of headers, goal persistence, collapse persistence across reload, and manual-break numbering.
<!-- SECTION:FINAL_SUMMARY:END -->
