---
name: project-tracker-parity-rewrite
description: 2026-09-16 pivot — Storylane becomes a faithful copy of Pivotal Tracker (2024 form); design doc path, advisor verdict (approve-with-corrections), decisions that supersede doc-8 and the velocity/rollover danger zones
metadata:
  type: project
---

On 2026-09-16 the owner decided Storylane must be a faithful re-creation of Pivotal
Tracker's final (2024) form — same panels, workflow, density, text sizes; only colours
may differ. Design doc: `docs/design/2026-09-16-tracker-parity-rewrite-design.md`
(supersedes Backlog doc-8 and every spec/ section derived from it; keeps the 2026-09-05
self-host foundation: Bun/Hono, SQLite, withProject/ProjectTx, auth, Docker). New branch
`rewrite/tracker` from `rewrite/phase-1`; TASK-244/254 on hold; `main` stays pre-rewrite.

**Why:** accidental divergence from Tracker was judged the failure mode of the doc-8 line;
the owner wants "UI や文字のつまり具合とかまで全部同じ形に".

**How to apply:**
- [[doc8-locked-decisions]] is HISTORICAL now — do not enforce Icebox=NULL, category
  states, capacity snapshot, ratio-of-sums, person-day velocity. Tracker's model wins.
- The rollover/finalize-once/advisory-lock items in [[review-sharp-edges]] belong to the
  doc-8 model. Advisor verdict 2026-09-16 asked the doc to commit to Tracker's *derived*
  iterations (accepted_at + project dates, `iteration_overrides` for length/team strength,
  no materialized/finalized iteration rows, planning computed on read). Re-check that the
  doc/spec actually records this before applying the old danger zone.
- Verdict 2026-09-16 (approve-with-corrections) required before step 0/1: crawl the REST API
  v5 reference too (settles most "(corpus)" items); fold the planning cut into the
  Current/Backlog step (the split IS planning); search engine + results panel before
  Epics/Labels/My Work; squash the five unshipped migrations into a fresh 0000; redesign
  activity payload to Tracker's `changes[]` shape in step 1; story ordering as
  before/after-id moves, not full-array `reorder`; public projects declared out of scope;
  revise ARCHITECTURE.md hook section / CLAUDE.md / decision-2 pt 5 in the step-1 commits.
- Reference notes gate each screen: `docs/reference/tracker-notes/<screen>.md` (committed);
  corpus `docs/reference/tracker/` is git-ignored (copyright, public repo).
