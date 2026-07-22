---
id: TASK-141
title: 'My Work redesign: free-column management UI (add/rename/delete/reorder)'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 08:53'
updated_date: '2026-07-22 10:05'
labels: []
dependencies:
  - TASK-140
priority: medium
type: feature
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-15 (advisor-approved). My Work board renders required Todo/Today/Done plus the user's my_work_columns as additional draggable-target columns, in the user's chosen display order (the order covers the three fixed slots too - per-user ordered list, mechanism free). Column management UI on the My Work page: add (name), rename, delete (cards fall back to Todo via the composite FK's SET NULL), and reorder columns. Free-column drops write my_work_story_state.column_id only (local - never a project write). Reuses the existing dnd-kit patterns; ends with the fable-advisor ux-principles design review per CLAUDE.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Board renders fixed + free columns in the user's display order; order is editable and persists
- [x] #2 Add/rename/delete free columns from the My Work page; deleting a column returns its cards to Todo with no error
- [x] #3 Dragging any story into a free column is a local-only column_id write (unit-tested routing)
- [x] #4 fable-advisor design review against spec/ux-principles.md passes
- [x] #5 pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration: profiles.my_work_column_order text[] not null default '{}' (own-row UPDATE RLS already exists on profiles, no new policy needed). Regen types.
2. lib/utils/my-work.ts: pure resolveColumnOrder(stored, freeColumns) -> full slot-id order (todo/today/done + free column uuids), filtering stale ids and appending unlisted ones in default position (todo, today, free-by-position, done). Unit tests.
3. app/my-work/actions.ts: add createMyWorkColumn, renameMyWorkColumn, deleteMyWorkColumn (plain own-row writes on my_work_columns; delete relies on the existing composite-FK ON DELETE SET NULL to drop cards back to Todo, no extra app logic), and saveMyWorkColumnOrder(order) (upserts profiles.my_work_column_order). All revalidatePath.
4. page.tsx: fetch profiles.my_work_column_order, compute order once via resolveColumnOrder, pass to a new MyWorkColumnManager (add/rename/delete/reorder panel, StateManager-pattern: up/down arrows, inline rename via useInlineEdit, X-button delete, add form) and to MyWorkSections (order prop).
5. my-work-sections.tsx: render columns by iterating order instead of a fixed Todo/Today/free/Done sequence; Todo/Done keep their specialized grouped rendering, Today/free columns use FlatColumn. useDroppable hooks stay unconditional (only render order changes).
6. Tests: resolveColumnOrder unit tests, new actions tests, my-work-column-manager component test, my-work-sections test updated for the order prop. tsc + lint green.
7. fable-advisor ux-principles review (AC 4) before manual verification, per CLAUDE.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: migration 20260722000009 (profiles.my_work_column_order text[], no new RLS needed — reuses existing own-row UPDATE policy). resolveColumnOrder pure function (my-work.ts) merges stored order against live free columns read-side. New actions: createMyWorkColumn/renameMyWorkColumn/deleteMyWorkColumn/saveMyWorkColumnOrder. New MyWorkColumnManager component (StateManager-pattern: up/down arrows, inline rename, X-delete, add form), collapsed by default. my-work-sections.tsx renders columns by iterating the resolved order. Tests: resolveColumnOrder unit tests, actions tests (24 total in file), manager component tests (10), sections order-rendering tests. tsc+lint clean. Full suite: 812 pass, same 2 pre-existing unrelated failures as TASK-138/139/140. Awaiting rls-security-reviewer + fable-advisor (AC #4/#5).
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-sonnet-5
created: 2026-07-22 10:04
---
rls-security-reviewer: HIGH finding — profiles has a column-level GRANT lockdown (20260719000001 revoked table-wide UPDATE, allowlists columns); my_work_column_order was never granted, so every real write would 42501 before RLS even runs (caught empirically, mocked tests missed it). Fixed: grant update (my_work_column_order) on profiles to authenticated added to the migration, verified via docker exec psql against the reset DB. LOW (non-blocking, by-design): profiles SELECT is public-read same as other profile fields.
---

author: @claude-sonnet-5
created: 2026-07-22 10:04
---
fable-advisor design review: approve-with-changes. 5 design decisions (button-reorder vs drag, no-confirm delete, panel push-down, omitted controls on fixed slots, no auto-scroll after add) all confirmed consistent with ux-principles.md. Required fix: move() disabled only the clicked row's arrows, so a concurrent click on a different row during an in-flight save could compute from a stale order array and silently clobber the first move (lost update). Fixed: isReordering now disables every row's arrows while any reorder is saving; added a regression test.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added My Work column display order + management UI (doc-15 follow-up). Migration 20260722000009: profiles.my_work_column_order text[] + its required column-level GRANT (rls-security-reviewer HIGH finding, fixed and re-verified via docker exec psql against a reset DB — profiles has a column-allowlist GRANT lockdown from 20260719000001 that a plain ADD COLUMN doesn't satisfy). resolveColumnOrder (lib/utils/my-work.ts) merges the stored order against the live free-column set read-side, so add/delete never needs a migration. New actions: createMyWorkColumn/renameMyWorkColumn/deleteMyWorkColumn/saveMyWorkColumnOrder. New MyWorkColumnManager component (StateManager up/down-arrow pattern, collapsed by default, inline rename, X-delete, add form) manages both free columns and the full slot order including Todo/Today/Done. my-work-sections.tsx now renders columns by iterating the resolved order. fable-advisor found and I fixed a lost-update bug (only the clicked row's arrows disabled during a save, letting a concurrent click on another row clobber it with a stale order array) - now every row disables while any reorder is in flight, with a regression test. Verified: tsc clean, eslint clean (0 warnings), 813/815 relevant tests pass (2 pre-existing unrelated integration failures in finish-story-from-git/promote, documented in TASK-138). rls-security-reviewer and fable-advisor both signed off after fixes.
<!-- SECTION:FINAL_SUMMARY:END -->
