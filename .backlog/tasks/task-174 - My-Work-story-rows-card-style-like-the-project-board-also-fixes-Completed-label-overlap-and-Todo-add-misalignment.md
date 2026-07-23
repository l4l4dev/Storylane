---
id: TASK-174
title: >-
  My Work: story rows -> card-style like the project board (also fixes
  Completed-label overlap and Todo-add misalignment)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-23 06:42'
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
- [ ] #1 My Work story cards visually match the project board's kanban card format (spacing, hierarchy, badges) rather than a single dense line
- [ ] #2 The 'Completed' label in Done never visually overlaps the title, type icon, or other row content, at any supported width
- [ ] #3 A newly added Todo item renders with the same alignment (icon/title/badge baseline) as existing rows — no visual jump
- [ ] #4 All project-identity, personal-vs-team, and state signifiers from the current row survive the redesign (doc-17 consensus: identity must stay visible below sm, not just be reformatted away)
- [ ] #5 fable-advisor design review against spec/ux-principles.md is recorded before merge
<!-- AC:END -->
