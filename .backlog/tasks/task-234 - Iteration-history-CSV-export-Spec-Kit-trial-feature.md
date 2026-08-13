---
id: TASK-234
title: Iteration history CSV export (Spec Kit trial feature)
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-13 08:46'
updated_date: '2026-08-13 09:03'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
SESSION HANDOFF 2026-08-13 (design phases done on Fable; resume implementation on Sonnet 5 per assignee). Completed: /speckit-specify (spec.md + requirements checklist 16/16, commit 7e32725), /speckit-clarify (2 owner decisions in spec.md Clarifications: viewers get the export, empty history = disabled control with reason), /speckit-plan (plan/research/data-model/contracts/quickstart, commit 4dd867b). Both commits are on LOCAL main only -- origin/main ends at the PR #26 merge; push is owner-initiated. Machine-local .specify/feature.json already points at specs/001-iteration-csv-export (gitignored, fine). Design is settled -- do NOT re-litigate, rationale in specs/001-iteration-csv-export/research.md: client-side Blob from the iterations page's existing RLS-scoped query (no new route/query), UTF-8 BOM, RFC 4180 quoting + formula neutralization on goal, rows = done incl. skipped ordered by number, capacity NULL -> empty cell, completed_points = velocity snapshot, filename <project-slug>-iterations.csv, disabled button with reason when empty. Next steps: (1) /speckit-tasks -- tasks.md is a decomposition draft only, this task stays the record; known upstream quirk: it omits test tasks unless told, repo test rule still binds, add them. (2) /speckit-implement -- all CLAUDE.md gates apply inside the phase. (3) /code-review (owner types it) + fable-advisor UX design review + kakunin-tejun + commit proposal. (4) Keep appending trial friction observations here -- they feed the post-trial keep-or-delete decision for speckit-implement/converge/taskstoissues. Observations so far: [a] skill told us to guess industry defaults, CLAUDE.md never-guess rule successfully overrode it (viewer-role question went to the owner); [b] specify phase needed manual spec/velocity.md reading -- constitution Principle I did its job; [c] tasks-in-two-places tension (tasks.md vs Backlog) not yet observed in practice, watch during implement.
<!-- SECTION:NOTES:END -->
