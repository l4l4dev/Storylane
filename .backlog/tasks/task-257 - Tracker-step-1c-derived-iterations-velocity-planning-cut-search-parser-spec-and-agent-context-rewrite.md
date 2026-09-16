---
id: TASK-257
title: >-
  Tracker step 1c: derived iterations, velocity, planning cut, search parser,
  spec and agent-context rewrite
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-09-16 11:55'
labels: []
milestone: m-10
dependencies:
  - TASK-256
references:
  - docs/plans/2026-09-16-tracker-step-1-core-model.md
  - docs/reference/tracker-notes/core-model.md
priority: high
type: feature
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Third slice of the Tracker core model: the pure algorithms in packages/core (derived iteration windows, Tracker's published velocity formula, the asymmetric Current/Backlog cut, the search query parser) with golden fixtures, the derived-iteration API, and the spec/agent-context rewrite so no session keeps assuming the deleted doc-8 model (spec/data-model.md, spec/velocity.md, ARCHITECTURE.md hook invariants, CLAUDE.md and REVIEW.md pointers, Backlog decision-3). Execute plan Tasks 17-22 of docs/plans/2026-09-16-tracker-step-1-core-model.md on branch rewrite/tracker. packages/core tests run with vitest (pnpm --filter @storylane/core test).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 iterations.ts, velocity.ts, planning.ts and search-query.ts exist in packages/core with golden fixtures under spec/fixtures and passing tests
- [ ] #2 GET iterations / velocity / planned cut are served from the derived model; no iteration rows or rollover mutation exist
- [ ] #3 spec/data-model.md and spec/velocity.md describe the new model; ARCHITECTURE.md hook section no longer mentions project_states.category or lazy rollover; decision-3 recorded
- [ ] #4 Full gates green: bun test + lint (server), core tests, web tests + lint; /code-review run before the commit proposal
<!-- AC:END -->
