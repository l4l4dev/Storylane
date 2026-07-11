---
id: TASK-43
title: 'Bug: iteration break notes linger after the real iteration line exists'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:19'
updated_date: '2026-07-11 15:53'
labels:
  - web
  - bug
dependencies: []
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: after adding an iteration (break), the real iteration divider line renders but the 'iteration break' note rows also remain, duplicated across groups ('全てに表示されていてとても邪魔'). Investigate how iteration-break notes are stored and rendered in board-list-view.tsx and the backlog grouping logic (TASK-9 virtual iteration groups): expected behavior is that once a break has produced/aligned with a real iteration boundary, the break marker is consumed or rendered exactly once at its boundary — not repeated in every group. Reproduce first, then fix per spec/screens.md 'Backlog groups' (update the spec if it is silent on break lifecycle).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Reproduction documented in the task (steps + observed vs expected)
- [x] #2 After an iteration boundary exists, no duplicate/lingering break notes render
- [x] #3 Regression test covers the break lifecycle
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46). End with a fable-advisor design review before manual verification.

Reproduction (2026-07-11, this session):
1. Opened project e252ad85-0af7-4c64-964d-97ee8627950d's List view.
2. Hovered the gap between two Backlog stories and clicked "+ Iteration break".
3. Result: an "Iteration break" divider row (with an X delete button) renders immediately, directly followed by the auto-generated numbered group header ("Iteration #4 · 2026-08-09 - 2026-08-22 · Goal · 0 pts") for the group that now starts there.
4. Queried backlog_dividers directly (`supabase db query`): this project already had 3 separate iteration_break rows (positions 1, 4, 6) before my new click made a 4th. Each is a distinct DB row/id — buildBacklogRows renders each exactly once, at its own position; there is no rendering-duplication bug (one divider is not shown twice).

Root cause: this is the intended, spec-documented behavior from the 2026-07-07 "Backlog groups" decision — "the break row itself stays draggable and deletable (X)", i.e. permanent until manually removed. The complaint is that the raw "Iteration break" row is redundant immediately after insertion, since the auto-generated numbered header that follows it already conveys the same boundary (dates, goal, points) — a generic unlabeled row and an informative header both announcing the same split. Because nothing ever auto-consumes a break, every one ever placed keeps contributing its own redundant row forever; with several in place (as this project already had), the Backlog view shows this redundant pairing repeatedly ("全てに表示されていてとても邪魔"). Not a logic bug — a UX/design mismatch versus what the 2026-07-11 review now expects.

No fix implemented yet — the resolution shape (auto-consume the divider vs. fold its delete affordance into the header vs. something else) is a product decision, not something to guess at silently. Asking the owner before proceeding (see task comment).

Fix implemented: a manual iteration_break divider no longer renders its own row (board-list-view.tsx). buildBacklogRows (lib/utils/iterations.ts) now stamps the following group's iteration-header row with manualBreakDividerId when that boundary was forced by a break (the divider row itself is kept only as an insertion anchor for nextRealRowId, never rendered). IterationHeaderRow shows a small removable "manual ×" badge when set; clicking it calls deleteBacklogDivider and lets automatic capacity-based splitting reclaim that spot.

Behavior change: a manual break is no longer independently draggable to a new position (previously it was, per the superseded 2026-07-07 design). Delete-and-reinsert (via the header badge + the existing hover insert-between affordance) replaces drag-to-reposition. Flag this explicitly when handing off manual verification — it's an intentional trade-off (owner-approved fix direction), not a regression.

fable-advisor review: 修正付き承認. Applied both blocking corrections: (1) handleRemoveManualBreak was fire-and-forget (void, no error handling) — violated the TASK-22 established pattern (await + error display); now awaits, shows an inline error on failure, and disables the × button while the removal is in flight. (2) the × button's hit target was a bare 12px icon with no padding — switched to Button variant="ghost" size="icon-xs" (same component DividerRow's own delete button already uses) for an honest hit target (spec/ux-principles.md principle 7). Also applied the recommended refactor: manualBreakDividerId is now stamped inside buildBacklogRows itself (pure, already-tested function) instead of board-list-view.tsx peeking at rows[index-1] — iterations.test.ts's existing manual-break test cases (including consecutive breaks and a trailing break) now assert the stamped id directly, closing the one gap the advisor flagged in test coverage. Tooltip's em dash replaced with a comma.

Verified in the browser (dev login, local Supabase, iteration確認 project which already had 3 pre-existing break dividers from earlier manual testing): every "Iteration #N" group that a break forced shows the "manual ×" badge with no separate "Iteration break" row above it; clicking × removes the divider and the group recomputes without it. Confirmed again after the buildBacklogRows refactor (same project, same result).

Tests: iterations.test.ts (25 tests, including new manualBreakDividerId assertions), board-list-view.test.tsx (new file, 4 tests covering badge presence/absence, correct-id deletion, and the failure-keeps-badge-and-shows-error path). Full pnpm vitest (366 passed), tsc --noEmit, eslint on touched files all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause: manual iteration-break dividers were permanent, always-visible rows by original 2026-07-07 design (spec/screens.md said 'stays draggable and deletable') — every break ever placed kept its own redundant 'Iteration break' row forever, right above the auto-numbered header that already conveyed the same boundary, cluttering the Backlog as more breaks accumulated. Not a rendering-duplication bug (confirmed via direct DB query: each break is a distinct row, rendered exactly once at its own spot). Fix (owner-chosen direction): the break's row is now folded entirely into the header it creates — buildBacklogRows stamps manualBreakDividerId onto that iteration-header row, and IterationHeaderRow shows a small removable 'manual ×' badge instead of a separate divider row. A break can no longer be dragged to a new position directly (delete via the badge + reinsert at the new spot instead) — an intentional, owner-approved trade-off, not a regression. fable-advisor review (approve with corrections) found the removal handler was fire-and-forget with no error feedback and the × button's hit target too small; both fixed, plus the id-stamping was moved into the already-tested pure buildBacklogRows function per its recommendation. Verified in the browser against a project with 3 pre-existing break dividers from earlier manual testing. Full pnpm vitest (366 passed), tsc --noEmit, eslint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
