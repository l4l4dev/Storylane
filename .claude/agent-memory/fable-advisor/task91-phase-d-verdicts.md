---
name: task91-phase-d-verdicts
description: 2026-07-19 Phase D design review — classic parity matches; create-at-category-end RPC landed, null action_label drag dead-end still open
metadata:
  type: project
---

TASK-91 Phase D review (2026-07-19): classic-template parity vs tag
`pre-concept-redesign` verified as **matches** (columns/icons/tints byte-identical,
gate outputs = golden fixture = seed_project_states; divergences covered by
[[approved-parity-divergences]]).

Two corrections requested, pending until fixed:

1. **RESOLVED (2026-07-20):** landed as the `create_project_state` RPC in
   `20260719000014_create_project_state.sql`, which inserts after the last row
   whose category sorts at or before the new one (handling the empty-category
   case) under `pg_advisory_xact_lock('project_states_positions:'||project_id)`.
   Original finding below for context.

   **New-state placement:** `createProjectState` (settings/actions.ts) appends at
   the END of the whole position sequence. Because `reorder_project_state`
   (20260719000013) is a same-category position-VALUE swap, the per-category slot
   set is invariant — a state created at global end can NEVER be moved adjacent to
   its category peers via the arrows. Required fix: `create_project_state` RPC
   inserting at end-of-own-category (shift later positions +1 under the same
   `pg_advisory_xact_lock('positions:'||project_id)`), replacing the racy
   read-max-then-insert.
2. **Null action_label drag dead-end:** states created without action_label get
   `computeStateGate` = none, and `evaluateDrop` reuses the gate, so stories in
   such a state have no button AND no drag exit. Recommended: decouple drag
   legality from actionLabel (null suppresses the button only; keep the
   never-into-rejected rule); needs owner triage since it touches the approved
   doc-8 §2 gate semantics + golden fixture.

**Why:** these determine whether Phase D can close; both were flagged to the owner
on 2026-07-19.
**How to apply:** if a later plan claims Phase D done, verify these two fixes landed
(grep for `create_project_state` RPC; check evaluateDrop's actionLabel handling).
