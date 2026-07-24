---
id: TASK-188
title: 'Icebox accordion: allow reordering container (epic) rows'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 13:48'
labels: []
milestone: m-6
dependencies:
  - TASK-184
documentation:
  - doc-18
ordinal: 1720
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split from TASK-186 per fable-advisor review (2026-07-24): container ("epic") rows currently render in their own block above the Icebox's flat list (board/page.tsx, containerAccordionRows), read-only, ordered by position — there is no write path to reorder them. No shared code with TASK-186/187 (different dnd-kit wiring, different backend concern); also not a reported owner pain point, just a natural completeness gap.

Position-invariant risk (advisor-flagged, must not be skipped): doc-18 §2 says containers share the single stories.position space with every other top-level story (no dedicated container-ordering scope, unlike the old dropped epics.position). But spec/data-model.md's position-ordering invariant rule 2 says rewrites/compaction only ever dense-rank WITHIN A SCOPE. Containers are currently read via an independent (project_id, is_container=true) filter — reordering them must use a brand-new splice scope scoped to exactly that filter, structurally isolated from the existing Icebox splice scope (_splice_backlog's iteration_id IS NULL AND state_id IS NULL scope, which covers flat Icebox items only). Mixing the two dense-rank spaces would corrupt whichever set isn't the one actively being reordered. Model this the way project_states already has its own self-contained UNIQUE(project_id, position) scope — do not piggyback on the Icebox splice logic.

Concurrency: reuse the existing pg_advisory_xact_lock(project_id) key (same granularity as move_story_board / the Icebox splice) — no new lock granularity needed, project-level serialization is sufficient.

Architecture-sensitive (new RPC, new position-scope design, concurrency) — per CLAUDE.md's Backlog Assignee & Model Policy, this is an @claude-opus-4-8 task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A container's own row in the Icebox block can be dragged to reorder among other containers
- [ ] #2 Reordering uses a new splice scope isolated to (project_id, is_container=true) — verified not to disturb flat Icebox item positions or vice versa (integration test covering both directions)
- [ ] #3 Reuses the existing pg_advisory_xact_lock(project_id) concurrency pattern; no new lock introduced
- [ ] #4 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->
