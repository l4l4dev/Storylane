---
id: TASK-176
title: >-
  My Work: treat Done as a status category (exclusive column), not an
  append-only log
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-23 14:21'
updated_date: '2026-07-23 23:19'
labels: []
milestone: m-2
dependencies: []
references:
  - supabase/migrations/20260722000002_my_work_data_model.sql
  - apps/web/app/my-work/actions.ts
  - apps/web/lib/utils/my-work.ts
  - apps/web/components/features/my-work/my-work-sections.tsx
  - spec/data-model.md
  - spec/screens.md
priority: high
type: feature
ordinal: 2100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner decision (2026-07-24, supersedes this task's original framing and doc-14/doc-15's additive-log design): Done must be 'just one of the statuses' — a story whose state category is done belongs in Done and nowhere else, and dragging it out is only a status change. The reported bug (a card dragged from Done to Doing appears in BOTH) is a direct consequence of Done being backed by the separate append-only story_completions log; making Done exclusive removes it structurally rather than papering over it with a deletion path.

fable-advisor verdict (2026-07-24) validated this direction and corrected three things:
1. The unified single-position column previously approved is NOT possible: Today overlays a card's free column, so today_position (order in Today) and column_position (order to fall back to) must coexist on one row (spec/screens.md 'Today overlays a card's column ... drops it back where it was'). Keep both, ADD todo_position and done_position, each with the existing CHECK-constraint pattern.
2. classifyMyWork MUST route Done FIRST. A team story completed on its own board never goes through persistMark, so its local today_date/column_id are not cleared — checking Today/free first would wrongly show a done story there.
3. Removing the completed_at-is-null filter without a replacement lower bound would pile every completion the user ever made into Done forever (the 7-day window currently lives only on the story_completions query) and would make /my-work/archive dead code. The stories query needs 'not done OR (done AND completed_at >= doneSince)'.

Owner decisions: (a) a story completed by A then reassigned to B while still done now leaves A's Done and appears in B's Done — accepted ('Done = the done work I currently own'). (b) story_completions is NOT dropped in this task — merely left unread and unwritten — so no production data is lost when this merges (deploy.yml applies migrations to production unconditionally on merge to main). Dropping the table, its RLS policies, and the stories SELECT OR-clause that depends on it is deferred to TASK-98's baseline squash + production reset.

TASK-177 (Todo manual reorder) shares this task's migration and reorder-action shape; do this one first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A story whose state category is done renders ONLY in Done — never simultaneously in Done and an active column
- [x] #2 Dragging a card out of Done moves it (status changes, card leaves Done); dragging a personal story into Done completes it. No story_completions row is read or written by either path
- [x] #3 Cards within a Done date group can be manually drag-reordered and land where dropped (done_position), staying within their date group
- [x] #4 Done still honours the viewer's retention window — completions older than it fall out of Done and remain reachable via /my-work/archive, which no longer reads story_completions
- [x] #5 story_completions is left in place but unread and unwritten (trigger INSERT removed); no production data is destroyed by this task
- [x] #6 The migration gets an rls-security-reviewer pass, and spec/data-model.md, spec/screens.md, spec/rls.md, ARCHITECTURE.md are updated to the exclusive-Done model
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fable-advisor scope/design verdict + closing review, and rls-security-reviewer pass — all recorded. Owner decisions: Done treated as a status category (not append-only log); story_completions NOT dropped (left unread/unwritten, removal deferred to TASK-98) so no production data is lost on merge; a story reassigned while done leaves the old assignee's Done and appears in the new assignee's.

Implementation: Done routed FIRST and exclusively in classifyMyWork (isDone from the story's live done category), so a done story shows only in Done. page.tsx stories query returns done stories bounded to the retention window ('completed_at is null OR >= doneSince'); the separate story_completions fetch removed. maintain_story_completed_at no longer inserts story_completions (still maintains completed_at). done_position column added for manual order within a Done date group; reorderMyWorkDone action + persistReorder scoping to the dragged card's completion date. groupDoneByDate now preserves input order (classifyMyWork sorts by donePosition). archive page + dev/my-tasks page re-read from stories.

rls-security-reviewer: PASS, no findings — grant lockdown intact on the new reset-trigger function, new columns inherit my_work_story_state's own-rows RLS, SECURITY DEFINER/search_path unchanged on maintain_story_completed_at, leaving story_completions in place is safe (OR-clause still parses), todo_position CHECK+trigger verified live. It flagged (non-security) a stale-todo_position quirk on Todo↔Done round trips.

fable-advisor closing review: approved with one required fix (the same todo_position quirk): persistMark now unconditionally clears BOTH done_position and todo_position on every placement, since the reset trigger can't catch a Done↔Todo transition (both leave today_date/column_id null). Added a unit test (actions.test.ts) + a spec/data-model.md note. Q1 (Done drag-reorderable, no ux-principles violation), Q2 (carry-over excludes done stories — correct, category-based so it covers all completion paths), Q3 (no spec contradictions) all cleared.

Verified: full suite 719 pass, tsc/eslint clean. Live Playwright (DB reset + both migrations): move to Done shows 1 instance (no duplicate); drag out of Done empties Done and moves the card; Todo reorder persists across reload. Specs updated: spec/screens.md, spec/data-model.md, spec/rls.md, ARCHITECTURE.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
My Work's Done column is now a plain status category (a story with a done-category state shows in Done and nowhere else), replacing the append-only story_completions log. This structurally fixes the reported duplicate (a card dragged from Done no longer appears in both Done and the target) and makes dragging out of Done a plain status change that removes the card from Done. Done cards are drag-reorderable within their date group. story_completions is left orphaned (unread/unwritten) for TASK-98 to drop, so no production data is lost on merge. Verified live + full suite; rls-security-reviewer and two fable-advisor passes recorded.
<!-- SECTION:FINAL_SUMMARY:END -->
