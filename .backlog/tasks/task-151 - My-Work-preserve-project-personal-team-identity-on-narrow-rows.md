---
id: TASK-151
title: 'My Work: preserve project & personal/team identity on narrow rows'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:33'
updated_date: '2026-07-22 16:16'
labels: []
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: medium
type: bug
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 High-impact findings #2, #3. Below the sm breakpoint a cross-project row collapses to an unlabeled color stripe -- the project chip and points are hidden entirely, losing identity, not just density (6 experts). Separately, the personal-vs-team category -- which governs whether a drag can complete the card in Done -- has no visible signifier on the card at any width; the two behavior classes look identical.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A compact project identifier (initials/code or accessible name) remains visible at all widths, not just chip/points
- [x] #2 Personal-project rows carry a persistent, labeled signifier distinguishing them from team-story rows
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC#1: added a compact circular initials marker (role=img, aria-label+title=full project name) shown only below sm — carries project identity where the full-name badge used to hide entirely. AC#2: added a persistent User-icon signifier for personal-project rows (icon always visible at every width; the 'Personal' text label joins it at sm+ to avoid crowding the title on narrow rows) -- threaded isPersonal through MyWorkRowData/toRowData (page.tsx), previously computed then dropped. fable-advisor (opus fallback) design review: approved with 4 fixes, all applied -- added role=img so the initials marker's aria-label is actually exposed to AT (the task's own a11y promise wasn't complete without it), moved the marker's border from the project accent color to a neutral border token (avoiding a third redundant identity encoding alongside the left border + initials), unified the marker's text size to 10px to match the Personal tag instead of introducing a fourth bespoke size, and made the Personal tag's text sm+-only while keeping its icon always visible. Tests: +3 new my-work-row.test.tsx cases (Personal signifier shown/not-shown, initials marker present); 663 unit tests full suite pass; tsc/eslint clean. No DB/migration changes. Manual browser check (light/dark, 360/768/1024px, personal/team/cross-project/Done rows) deferred to the owner per usual workflow.
<!-- SECTION:FINAL_SUMMARY:END -->
