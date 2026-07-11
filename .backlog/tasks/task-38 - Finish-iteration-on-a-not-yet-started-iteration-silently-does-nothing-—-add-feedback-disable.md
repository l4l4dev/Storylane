---
id: TASK-38
title: >-
  Finish iteration on a not-yet-started iteration silently does nothing — add
  feedback/disable
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-11 05:18'
updated_date: '2026-07-11 06:37'
labels:
  - web
  - bug
  - ux
dependencies: []
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: after manually finishing iteration #1, iteration #2 is created starting TOMORROW (finalize_iteration RPC: v_next_start = end_date + 1). Pressing Finish iteration on #2 the same day hits the guard in supabase/migrations/20260709000002_finalize_iteration.sql line 80 (start_date <= today required for manual finish) and exits with no events — the button appears dead.

Fix on the UI side (kanban-board.tsx Finish dialog / board page): when the current iteration has not started yet, either disable Finish iteration with the reason shown ('Iteration #2 starts 2026-07-12 — nothing to finish yet'), or after an RPC call that returns zero events show that message instead of silence. Decide whether a not-yet-started iteration should be finishable at all (spec/velocity.md 'Manual finish') — if yes, that is an RPC change and needs /advisor review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Pressing Finish iteration never results in zero visible feedback
- [ ] #2 Tests cover the zero-event manual finish path
- [ ] #3 Manual Finish works on a not-yet-started current iteration (skip), with confirm dialog stating what will happen
- [ ] #4 Skipped iterations do not corrupt velocity (rule decided and documented in spec/velocity.md)
- [ ] #5 Double-click / concurrent manual finish remains safe (no runaway iteration creation)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECIDED (owner, 2026-07-11): option B — a not-yet-started iteration CAN be manually finished (skipped). This changes the finalize_iteration RPC (supabase/migrations/20260709000002_finalize_iteration.sql): the manual-finish branch currently requires start_date <= today; allow finishing a future-start current iteration too. Open design points for the implementer: (1) what dates the skipped iteration keeps (end_date < start_date must not happen — consider collapsing it to a zero-length/dated-today row), (2) velocity: a skipped iteration finalizes with velocity from its accepted stories (normally 0) and will drag the running average — decide whether skipped iterations are excluded from the velocity window (spec/velocity.md update required), (3) the double-click guard the start_date check was protecting must be preserved some other way (advisory lock already serializes; re-derive the guard condition). MANDATORY: /advisor (fable-advisor) review of the RPC change before implementation. Also keep the UI half: Finish must never end in silent no-change — surface returned events or an explanatory message.

Follow spec/ux-principles.md (landed with TASK-46), especially principle 2 (every action produces visible feedback) and 6 (irreversible actions out of the primary click path). End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
