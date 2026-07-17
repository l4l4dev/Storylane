---
id: TASK-44
title: 'Free mode: add and edit columns directly on the board'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:20'
updated_date: '2026-07-14 15:18'
labels:
  - web
  - ux
  - feature
milestone: m-0
dependencies: []
priority: medium
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: free-mode Board statuses can only be created one by one in Settings. Bring column management onto the board itself (apps/web/components/features/board/free-board.tsx): an '+ Add column' affordance at the right end of the board (inline name input, default color, appended last), inline rename on the column header, and access to color/is_done/delete via a small column menu (can reuse the Settings form logic in a popover). Keep Settings as the full editor; the board affordances are shortcuts to the same server actions — no new write paths.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A column can be created from the board without visiting Settings
- [x] #2 A column can be renamed inline from its header
- [x] #3 Column menu exposes color, done-column flag, and delete (existing rules for is_done/deletion still enforced)
- [x] #4 Tests cover add and rename from the board
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend WipLimitMenu (free-board.tsx) into ColumnMenu: add color input + is_done
   checkbox (submits via updateCustomStatus with current name preserved), delete
   button gated on canDelete (deleteCustomStatus), keep existing WIP-limit form as-is.
2. Add inline click-to-edit for column name in ColumnHeaderContent (h2 -> input on
   click, commits via updateCustomStatus preserving current color/is_done, Escape
   cancels, matches ux-principles.md #5).
3. Add "+ Add column" affordance: inline name input, default color #6b7280, appended
   via createCustomStatus. Placed at the end of the single-band row and in the lanes
   header row.
4. Thread canEdit/canDelete props through FreeBoard -> FreeColumn/FreeBoardLanes/
   LaneColumnHeader/ColumnHeaderContent, gating edit/add/delete UI (edit/add hidden
   for viewers, delete owner-only) -- mirrors StatusManager's gating.
5. board/page.tsx FreeBoardPage: compute myRole/canEdit/canDelete same as settings
   page.tsx, pass into <FreeBoard>.
6. Extend free-board.test.tsx: add column from board, inline rename, menu color/done
   save, delete (owner vs member/viewer visibility).
7. Run pnpm exec vitest run on free-board.test.tsx, then fable-advisor design review
   against spec/ux-principles.md, then manual verification steps for the owner.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46), especially principles 4 (create destination visible) and 5 (saved values render as values). End with a fable-advisor design review before manual verification.

IMPLEMENTED: free-board.tsx gained ColumnNameEditor (click-to-edit name, commits
full name/color/is_done row via updateCustomStatus), AddColumnButton (+ Add column,
default color #6b7280, createCustomStatus), and ColumnMenu (renamed from
WipLimitMenu; added color swatch + is_done checkbox + owner-gated Delete column,
alongside the existing WIP-limit form). canEdit/canDelete threaded through
FreeBoard -> FreeColumn/FreeBoardLanes/LaneColumnHeader/ColumnHeaderContent.
board/page.tsx FreeBoardPage now computes myRole/canEdit/canDelete the same way
settings/page.tsx does (member+ edit, owner-only delete) and passes them to
<FreeBoard>. No new write paths -- reuses createCustomStatus/updateCustomStatus/
deleteCustomStatus/setStatusWipLimit from settings/actions.ts.

REVIEWS: web-conventions-reviewer -- no issues. fable-advisor (ux-principles.md) --
"修正付き承認": Delete column with no confirm dialog is acceptable as-is (kebab
placement + owner-only + DB FK guard on non-empty columns already satisfy
principle 6; matches existing status-manager.tsx precedent). Applied 3 required
fixes before shipping: (1) settings-form button renamed "Save color" -> "Save
column" since it also commits the is_done toggle, (2) AddColumnButton's Input
height 8->9 to match the trigger button (principle 3, no layout shift), (3)
ColumnNameEditor's display button given h-6 to match the edit input (principle 3).

Tests: 16/16 pass in free-board.test.tsx (423/423 across the whole web suite).
tsc --noEmit and eslint clean on all changed files.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added board-level column management to free-mode boards: + Add column (default color, createCustomStatus), click-to-edit column name (updateCustomStatus, preserves color/is_done), and a column menu with color + Done-flag + owner-only Delete alongside the existing WIP-limit form. Gated canEdit (member+)/canDelete (owner) the same way as Settings' status-manager.tsx, threaded from board/page.tsx's role lookup. No new write paths. Verified: 16 new/updated tests in free-board.test.tsx (423/423 web suite total), tsc + eslint clean, web-conventions-reviewer found no issues, fable-advisor approved with 3 minor UX fixes (button label, two height-consistency tweaks) which were applied. Committed as cf80494.
<!-- SECTION:FINAL_SUMMARY:END -->
