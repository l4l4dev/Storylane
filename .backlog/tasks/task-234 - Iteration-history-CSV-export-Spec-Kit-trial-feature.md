---
id: TASK-234
title: Iteration history CSV export (Spec Kit trial feature)
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-13 08:46'
labels: []
milestone: m-2
dependencies: []
references:
  - specs/001-iteration-csv-export/spec.md
priority: medium
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Export a project's finalized-iteration history as CSV from the iterations page. This is the Spec Kit trial feature (CLAUDE.md "Spec Kit (experimental)"): the design lives in specs/001-iteration-csv-export/spec.md (per the adoption rule, that directory IS the design doc -- no duplicate Backlog doc). Read-only: no new tables, no RLS changes, no mutations. Owner decisions 2026-08-13: viewers get the export too (no role gating); one completed_points column (velocity snapshot), not two.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The iterations page offers an export control that downloads one CSV row per finalized iteration (done incl. skipped), ordered by number ascending, excluding the current/future iterations
- [ ] #2 Columns per spec FR-003: number, goal, start/end dates (ISO), skipped flag, capacity (empty when never snapshotted), completed_points; headers stable snake_case
- [ ] #3 File opens in Excel with Japanese goals intact (UTF-8 BOM), survives commas/quotes/newlines in goals, and is formula-injection safe
- [ ] #4 Available to owner, member, and viewer; empty-history state handled per spec FR-007
- [ ] #5 Tests cover the CSV serialization rules (escaping, BOM, formula neutralization, ordering, exclusions); full suite passes from apps/web/ (pnpm test + pnpm run lint)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Spec Kit trial pipeline, running now: /speckit-specify done (spec.md + requirements checklist pass, owner clarifications resolved) 2. /speckit-clarify 3. /speckit-plan (then fable-advisor design review of the plan artifact per CLAUDE.md UI gate) 4. /speckit-tasks 5. /speckit-implement (switch model to Sonnet first per assignee) 6. /code-review + fable-advisor UX review + manual verification 7. record trial friction observations for the post-trial keep-or-delete decision
<!-- SECTION:PLAN:END -->
