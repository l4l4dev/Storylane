---
id: TASK-108
title: >-
  My Work: Todo/Doing/Today/Done sections + per-project color +
  current-iteration filter
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 08:05'
labels:
  - web
dependencies: []
priority: medium
ordinal: 10500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-12 Thread A (+ advisor corrections). Replace My Work's Today/Assigned two-section model with four: Done (completed_at within last 7 days, date-grouped) / Today (unchanged: personal project's current iteration + pinned) / Doing (in_progress category, minus Today) / Todo (everything else, grouped by project). Render order is Todo->Doing->Today->Done (Done LAST, ux-principles.md principle 9 — this is display order only; classification precedence stays Done>Today>Doing>Todo, no story in two sections). A client-side 'only current iteration' filter narrows Todo+Doing. Per-project row color replaces the current personal/team binary accent — build it as a shared deterministic utility (project id -> color) since the owner wants the same colors to reach the sidebar switcher later (a separate task), not something My-Work-local. See .backlog/docs/doc-12.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 buildMyWorkSections (my-work.ts) becomes a 4-way split (todo/doing/today/done) with unit tests; a story is never in two sections; rejected-category stories fall to Todo
- [ ] #2 Render order on the page is Todo, Doing, Today, Done (Done last) — not Done-first
- [ ] #3 Done section: a new query for completed_at within the last 7 days (UTC), grouped by date descending; no new index added now (comment notes stories(assignee_id, completed_at) as a later option if needed)
- [ ] #4 Current-iteration id is resolved for ALL of the user's projects (not just personal), reusing dashboard/page.tsx's existing projectsNeedingRollover + rolloverIterationSafely pattern rather than a new one
- [ ] #5 A client-side 'only current iteration' toggle filters Todo+Doing to each story's own project's current iteration; no persistence
- [ ] #6 Per-project row color is a shared utility (e.g. apps/web/lib/utils/project-color.ts, deterministic hash from project id), not inline in my-work-row.tsx, so a later task can reuse it in the sidebar
- [ ] #7 spec/screens.md 'My Work' section rewritten to match; fable-advisor design review passes; pnpm test + lint green
<!-- AC:END -->
