---
id: TASK-160
title: >-
  My Work: small copy fixes (carry-over grammar, done-color token,
  unknown-project wording)
status: Done
assignee:
  - '@claude-haiku-4-5'
created_date: '2026-07-22 13:40'
updated_date: '2026-07-23 03:17'
labels: []
milestone: m-5
dependencies: []
references:
  - >-
    .backlog/docs/reviews/doc-17 -
    17-—-UX-panel-review-2026-07-22-—-My-Work-screen-10-expert-ux-review.md
priority: low
type: chore
ordinal: 860
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From doc-17 Low findings #35, #23 (numbered Medium in the doc but a mechanical one-line fix), and #40 -- three unrelated but trivially small copy/token fixes bundled together: (1) subject-verb disagreement in the carry-over prompt ('1 item were marked...'); (2) the Done completion marker uses a raw Tailwind green class instead of a semantic color token; (3) the 'Unknown project' fallback for a project the viewer has left reads as an error rather than an expected state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The carry-over prompt's grammar is correct for both singular and plural counts
- [x] #2 The Done completion marker's color comes from a semantic token, not a raw Tailwind color class
- [x] #3 The fallback label for a project the viewer no longer belongs to reads as an expected state, not an error
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC#1: fixed subject-verb agreement in the carry-over prompt (was always "were", even for "1 item") -- now "was"/"were" follows the same singular check already used for "item"/"items". AC#2: added a new semantic `--success` token to globals.css (theme block + light/dark values, routed through Tailwind's own --color-green-600/--color-green-400 so the actual rendered color is unchanged, just named) and swapped my-work-row.tsx's completion marker from raw text-green-600/dark:text-green-400 classes to text-success; verified the compiled CSS output (curled the dev server's chunk) resolves .text-success { color: var(--success) } correctly in both themes. AC#3: renamed the "Unknown project" fallback (shown when a project can't be resolved -- e.g. a Done/archive completion whose project the viewer has since left, kept visible via the stories SELECT OR-clause) to "Left project" in all three places it's used (page.tsx, archive/page.tsx, lib/utils/my-work.ts's classifyMyWork Todo-grouping fallback, the last one dead-in-practice since active stories are always pre-filtered to known projects, but kept consistent for defensive completeness). Also fixed a type-checking gap from TASK-158 noticed while re-running tsc: actions.test.ts's upsertMock/insertColumnMock mock types didn't allow an optional `code` field, which TASK-158's own new RLS-translation tests needed -- widened to a shared MockDbError type. No design review this pass (fable-advisor/opus quota rate-limited) -- skipped as reasonable given these are three independent one-line-scope copy/token fixes with no layout or interaction change. Tests: +5 (grammar singular/plural, Left-project wording via classifyMyWork); full suite 690 pass; tsc/eslint clean. No DB/migration changes.
<!-- SECTION:FINAL_SUMMARY:END -->
