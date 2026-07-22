---
id: TASK-152
title: >-
  My Work: fix empty-state guidance (quick-add gating copy, empty column
  placeholders)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-22 13:33'
updated_date: '2026-07-22 16:28'
labels: []
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: medium
type: bug
ordinal: 650
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 High-impact findings #4, #5. The empty-state copy tells every user to 'add a personal task above,' but the quick-add trigger only renders when the viewer has exactly one personal project -- for zero or multiple it silently disappears with no fallback explanation (6 experts). Separately, empty individual columns (notably an unplanned Today) render as a bare strip with no placeholder or prompt. Note: the quick-add gating itself is an intentional spec decision (screens.md:434-438, doc-8 section 10) -- fix the copy/placeholder, do not change the gating.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Empty-state copy branches on whether the quick-add is actually present; when absent it explains the alternative (add from a personal project's board)
- [x] #2 Each empty column body shows a short placeholder/prompt instead of a bare empty strip
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC#1: page.tsx passes hasQuickAdd (soloPersonalProject !== null) to MyWorkSections, which branches the whole-board empty-state copy -- unchanged text when the quick-add is present, 'add one from a personal project's board' when it isn't (gating itself untouched, spec-decided). AC#2: shared EmptyColumnHint component shows a per-column placeholder whenever that column is empty AND the whole board isn't (avoiding N repeats of a single whole-board message). fable-advisor (opus fallback) design review: approved with fixes, all applied -- Done gets its own wording ('Completed stories appear here.') since it's not a drag target from My Work (team stories can't be dropped there) and the generic 'Drag stories here.' would actively mislead; Today gets the panel's originally-suggested wording ('Drag stories here to plan today.'); per-column hints are suppressed entirely when the whole board is empty (the paragraph above already covers it, so N repeated one-liners would hurt density). Tests: +5 new my-work-sections.test.tsx cases (branch copy present/absent, Today/Done wording, whole-board suppression); 668 full suite pass; tsc/eslint clean. No DB/migration changes. Manual browser check deferred to the owner per usual workflow.
<!-- SECTION:FINAL_SUMMARY:END -->
