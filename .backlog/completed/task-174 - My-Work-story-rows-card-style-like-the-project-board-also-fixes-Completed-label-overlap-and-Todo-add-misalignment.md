---
id: TASK-174
title: >-
  My Work: story rows -> card-style like the project board (also fixes
  Completed-label overlap and Todo-add misalignment)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 06:42'
updated_date: '2026-07-23 14:03'
labels: []
milestone: m-2
dependencies: []
references:
  - apps/web/components/features/my-work/my-work-row.tsx
  - apps/web/components/features/my-work/my-work-sections.tsx
  - reviews/doc-17
documentation:
  - spec/ux-principles.md
priority: medium
type: enhancement
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The owner wants My Work's story rows (MyWorkRow, apps/web/components/features/my-work/my-work-row.tsx) to look like the project board's own kanban cards instead of a single-line row — the current row cramps type icon, number, personal tag, title, project chip, state badge and points into one line, degrading badly below sm (doc-17 findings #2, #18, #20, #23, #24 all point at this same file/behavior).

Two owner-reported visual bugs on the current row share this exact surface and should be resolved as part of the same pass rather than patched separately, since a card-format redesign is likely to change or remove the elements involved:
- The Done column's 'Completed' label (my-work-row.tsx:61-78, rendered only when completedAt is set) visually overlaps other text in the row.
- Adding a task that lands in Todo renders with text that looks misaligned/out of place compared to existing rows.

This changes an established, deliberately-chosen layout (doc-17's method note treats the row format as intentional) — per CLAUDE.md, get this reviewed by fable-advisor against spec/ux-principles.md before implementation, and again as the closing design review before merge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 My Work story cards visually match the project board's kanban card format (spacing, hierarchy, badges) rather than a single dense line
- [x] #2 The 'Completed' label in Done never visually overlaps the title, type icon, or other row content, at any supported width
- [x] #3 A newly added Todo item renders with the same alignment (icon/title/badge baseline) as existing rows — no visual jump
- [x] #4 All project-identity, personal-vs-team, and state signifiers from the current row survive the redesign (doc-17 consensus: identity must stay visible below sm, not just be reformatted away)
- [x] #5 fable-advisor design review against spec/ux-principles.md is recorded before merge
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Redesigned MyWorkRow from a single dense line into a two-tier card (title block, then a flex-wrap meta row of badges) matching the board's StoryCard shape. Meta row no longer hides anything below sm (doc-17 #2) — it wraps instead, which also let the project-initials circle marker be removed entirely (redundant once the full project-name badge is always visible) and let the project badge's accent-tinted border be dropped (doc-17 #18: color identity now lives only on the card's left border). Badge max-widths unified to max-w-32 (doc-17 #24). Fixed my-work-sections.tsx's per-group card-list gap (gap-1.5 -> gap-2, doc-17 #20) to match FlatColumn's existing gap-2.

The Completed marker moved out of the title area into the meta row (pushed to the end via ml-auto, same pattern as the board card's assignee slot) — this and the fixed two-tier skeleton (every row has the same title+meta shape regardless of badge count or completedAt) structurally resolve both owner-reported bugs: the label no longer shares crowded space with the title/icon (AC#2), and a newly-added Todo card renders with identical alignment to existing ones since there's no longer a variable-width single line to jump (AC#3, confirmed live).

Three fable-advisor passes: (1) pre-implementation plan review — approved the two-tier/wrap direction with corrections (drop the circle marker AND the badge border-tint, move Completed to the meta row not the title row, fix the doc-17 #20/#24 gaps found in the same file); (2) closing review — caught that my first pass only wrapped the TITLE in the click target, not the whole card (a hit-target regression vs. both the pre-redesign row and the board's own StoryCard, which wraps its whole cardContent in one button/Link); (3) final closing review after the click-target fix (whole card now one button/Link, mirroring story-card.tsx's cardContent pattern exactly) — approved, hit-target fix confirmed against story-card.tsx pattern, no blocking issues. Noted but non-blocking: the button/Link's accessible name is the concatenation of all card text (title+number+badges), same pre-existing pattern as the board's own StoryCard — not a regression, not in this task's AC scope.

Verified: my-work-row.test.tsx (replaced the removed-marker test with project-badge-always-visible + no-accent-border tests; replaced the Completed-marker-position test with a structural-separation test; added a regression test asserting #number/Personal/project-badge/state-badge all sit inside the button/Link subtree). Full suite 716 tests pass, tsc/eslint clean. Live Playwright: desktop 1440px, mobile 360px, dark theme, and after adding a new Todo item all screenshot-verified; confirmed clicking the meta-row/badge area (not just the title) opens the peek.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
My Work story rows are now two-tier cards matching the project board's StoryCard (title block + a wrapping meta row of badges), fixing both owner-reported bugs structurally: the Completed marker no longer overlaps the title (moved to its own end-of-row element), and newly-added cards align identically to existing ones (fixed skeleton, no more variable-width single line). Also resolved doc-17 findings #2 (identity hidden below sm), #18 (redundant accent encoding), #20 (gap inconsistency), and #24 (badge max-width inconsistency) on the same surface. Three fable-advisor reviews (pre-implementation plan, closing review that caught a hit-target regression, final confirmation after the fix) all recorded.
<!-- SECTION:FINAL_SUMMARY:END -->
