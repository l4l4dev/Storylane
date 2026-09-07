---
name: project-self-host-rewrite
description: 2026-09 self-host rewrite (branch rewrite/phase-1, Hono+SQLite server, wouter SPA) — design doc path, phase-1 UI verdict 2026-09-07, divergences accepted as temporary
metadata:
  type: project
---

The product is being rewritten as a self-hosted single container (design doc
`docs/design/2026-09-05-self-host-rewrite-design.md`; server `apps/server` Hono +
SQLite, web `apps/web/src` Vite/wouter SPA, shared pure logic in `packages/core`,
state templates in `spec/fixtures/state-templates.json`). Work is on branch
`rewrite/phase-1`; implementer reports live under `.superpowers/sdd/<date>-self-host-phase-1/`.

**Why:** owner wants a "try it in 60 seconds" docker one-liner (README/INSTALL.md §1) and
outside contributors; Supabase/Next stack is being retired for the self-host path.

**How to apply:** `spec/` is still canonical for UX, but phase 1 has no List view, side
peek, labels/assignee UI. Advisor verdict 2026-09-07 (approve with fixes) accepted two
*temporary* divergences to record in TASK-253 notes: an Icebox column on the Kanban
(until List view exists) and an estimate control on the card (until side peek exists) —
but the estimate control must be point-scale buttons, never a free number input
(spec/features.md "Point estimation"), and must replace the advance button for an
unestimated feature (principle 1). Re-flag if a later phase keeps them past List view /
side peek. decision-1 still applies: business rules in the server service layer
(`assertPlaceable`, `computeStateGate` in packages/core), not in React.
