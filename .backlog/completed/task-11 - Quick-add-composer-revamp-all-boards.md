---
id: TASK-11
title: Quick-add composer revamp (all boards)
status: Done
assignee: []
created_date: '2026-07-07 14:26'
updated_date: '2026-07-09 07:48'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-22
references:
  - spec/screens.md
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md 'Quick-add composer': the '+ Add story' trigger must never morph into an input. Clicking reveals a separate card-shaped composer beneath it (title input, 'Enter to add / Esc to close' hint); Enter creates and keeps it open for consecutive adds, Esc or outside click closes, empty Enter does nothing. Applies to List sections, the Kanban Unstarted column, and free-mode columns (quick-add-composer.tsx).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Trigger stays visible and unchanged; composer appears as a separate card below it in all three board contexts
- [x] #2 Enter adds and keeps the composer open; Esc and outside click close it; empty Enter is a no-op
- [x] #3 Component tests updated for the new open/add/close behavior
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rewrote quick-add-composer.tsx: the trigger button is now always rendered (never conditionally replaced by the input) and the composer form renders alongside it instead of in its place. compact contexts (List section headers, a single-line flex row) get an absolutely-positioned floating card below the trigger so it does not push the header row taller; non-compact contexts (Kanban Unstarted column, free-mode columns) stack the composer in normal block flow below the trigger, which already fit the vertical column layout.

Added a click-outside handler (mousedown listener scoped to a container ref, removed on unmount/close) since a plain onBlur would also fire for reasons that are not "clicked outside" (e.g. Tab). Esc and outside-click both discard whatever was typed and close; Enter creates and keeps the composer open with a cleared, refocused input for consecutive adds (unchanged from before); an empty Enter is a no-op (unchanged). Added the "Enter to add · Esc to close" hint text under the input per spec, shown whenever there is no error.

Tests: rewrote/extended quick-add-composer.test.tsx - trigger-stays-visible-and-focused-input assertion replaces the old morph-in-place one, added outside-click-closes-and-discards and click-inside-does-not-close cases. All other existing behavior (create+stay-open, error+keep-text, blank-title-no-op, free-mode target, Escape) unchanged and still covered.

Verified live in the browser across all three contexts named in the task (Kanban Unstarted column, a tracker-mode List section header, and a free-mode custom-status column): trigger stays visible in all three, composer appears as a separate card in the correct position for each layout, Enter creates and keeps it open, outside click discards and closes. No console errors.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The + Add story trigger no longer morphs into the input in place - it now stays visible and unchanged while a separate card-shaped composer appears alongside it (a floating card for compact/List-header contexts, stacked in normal flow for the Kanban/free-mode column contexts), matching spec/screens.md "Quick-add composer". Added an outside-click handler (Esc already existed) so both close and discard the draft; Enter still creates and keeps the composer open for consecutive adds. Verified in all three board contexts live plus updated/expanded component tests.
<!-- SECTION:FINAL_SUMMARY:END -->
