---
name: doc8-locked-decisions
description: doc-8 (2026-07-18 concept redesign) locked decisions and WHY — do not relitigate in future reviews
metadata:
  type: project
---

Written 2026-07-18 by the Fable-era advisor (who reviewed doc-8 twice, both
approve-with-corrections) for its successor. Source of truth:
`.backlog/docs/doc-8 - Concept-redesign-2026-07-18-single-mode-flexible-sprints-person-day-velocity-My-Work.md`
(section numbers below). These are settled; a plan matching them needs no re-debate,
a plan contradicting them is a finding unless the owner explicitly reopens.

**Why:** each was chosen to resolve a concrete conflict, not by taste:

- **Icebox = `stories.state_id IS NULL`** (§2), not an "unscheduled" category/state row.
  Why: the backlog-zone predicate stays NULL-safe (`iteration_id IS NULL AND state_id IS
  NOT NULL`) and deleting custom states can never break the Icebox.
- **Category immutable after creation** (§2). Why: recategorizing a state in place would
  silently rewrite velocity/zone semantics of every story in it; the safe path is create
  new state + move stories. Deletion is plain-FK blocked; a trigger under the per-project
  advisory lock keeps ≥1 unstarted and ≥1 done state.
- **DB allows any→any transitions; ordering discipline is UI-only** (§2) via
  `set_story_state` (SECURITY INVOKER, FOR UPDATE, estimation gate, done-iteration guard).
  This is a RECORDED deliberate divergence from old spec/features.md "arbitrary state
  jumps are not allowed". Board write model = TASK-70 owner decision (a): any member
  operates any story.
- **1-day iterations span start working day → day before next working day** (§4), e.g.
  Fri–Sun, rollover Monday. Why: weekend work lands in the still-current iteration, so
  no writes into finalized iterations and no re-finalization — this removed a direct
  conflict with velocity.md's done-guard/finalize-once design (1st-pass key call).
  Working-day selection uses the PROJECT calendar only, never user time-off (iteration
  existence must not differ per user).
- **Capacity snapshotted into `iterations.capacity` by the finalization RPC** (§7),
  never recomputed. Why: later member removal or calendar edits must not silently
  rewrite history. Late lazy finalization snapshots at that moment — accepted.
- **Rate = ratio of sums** (Σ done points ÷ Σ capacity over the window, capacity>0
  non-skipped done iterations), NOT average of per-sprint ratios (§7). Why: avoids
  zero-division and over-weighting tiny sprints. Forecast = rate × planned capacity;
  per-client pure function → needs shared golden fixtures.
- **`user_time_off` stores dates + kind ONLY, no reason/notes** (§6). Why: co-members
  (incl. viewers) must READ it for capacity math (`shares_project_with` policy), so any
  free-text column would leak private reasons. Date-visibility trade-off accepted,
  documented in spec/rls.md.
- **Pins recreated inside `move_story_to_project`** (§9). Why: move is insert+delete so
  the story id changes and pins would dangle; recreation is a cross-user write, hence it
  must live in the existing SECURITY DEFINER RPC (with per-pinner destination-membership
  check). `remove_member` deletes that user's pins (no ghost pins on re-invite).
- **Cadence change applies to the next-created iteration row immediately** (§3) — no
  effective-date mechanism; lazy catch-up uses length at access time. Accepted trade-off,
  logged in activity_logs. Per-sprint length override runs inside the finalization RPC
  pattern (advisory lock) and is rejected on `done` iterations.
- Free mode removed, `stories.focus` dropped — both WITHOUT data migration (pre-launch).
  Quick-add rebuild (TASK-82) only after free-mode removal.

Implementation order (§Next steps): spec TASK-83 → free-mode removal TASK-84 → state
model TASK-91 (TASK-70 RLS relaxation precedes it) → velocity TASK-86 → cadence TASK-87;
calendar TASK-85 / story_pins TASK-88 after spec; My Work TASK-89 + TASK-82 after state
model. Verify task states with `backlog` — this snapshot is 2026-07-18.

Related: [[review-sharp-edges]], [[owner-review-preferences]].
