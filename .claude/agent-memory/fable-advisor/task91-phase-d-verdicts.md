---
name: task91-phase-d-verdicts
description: 2026-07-19 Phase D design review — classic parity matches; both corrections closed (create RPC landed; null action_label "dead end" re-measured as not user-reachable)
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
2. **RESOLVED as not-a-bug (2026-07-20, re-measured):** the original note ("no
   button AND no drag exit") was overstated. Verified against current code:
   - Kanban view renders NO Backlog/Icebox columns (spec/screens.md "Board
     layout" L135; kanban-columns-board.tsx header comment), so the
     Backlog→state-column gesture the strict `evaluateDrop` branch would block
     does not exist in any UI. List view uses `evaluateListDrop`, whose
     Backlog→Current is unconditional (no gate/actionLabel check), and Kanban
     state→state is any→any — so a story in a null-actionLabel state always
     has a drag exit. Side peek is gate-button-only by design.
   - The strict backlog branch of `evaluateDrop` executes only server-side in
     `dropStory` re-validation when the story was concurrently unscheduled;
     rejecting there is the CORRECT conflict behavior (stale client must not
     silently reschedule+advance). Do not "fix" it by loosening.
   Residual UX seam (accepted, no change requested): a current-iteration story
   in a null-label state has no advance affordance in the default List view —
   the exit is the Kanban drag. Null actionLabel = deliberate button
   suppression stays as reviewed (story-state.ts doc + golden fixtures).

**Why:** these determined whether Phase D could close; both are now closed
(finding 1 fixed 2026-07-20, finding 2 re-measured as not user-reachable and
rejected as a code change on 2026-07-20).
**How to apply:** if a later plan proposes decoupling `evaluateDrop`'s backlog
branch from `computeStateGate`, or adding a Kanban Backlog column, re-run the
finding-2 analysis above first — reachability, not function-level truth, decided
this verdict.
