---
id: doc-8
title: >-
  Concept redesign 2026-07-18: single mode, flexible sprints, person-day
  velocity, My Work
type: specification
created_date: '2026-07-18 02:52'
updated_date: '2026-07-18 03:03'
---
# Concept Redesign 2026-07-18 — single mode, flexible sprints, person-day velocity, My Work

Decisions agreed with the owner in the 2026-07-18 concept session, then reviewed by
fable-advisor the same day (**verdict: approve-with-corrections** — all corrections are
incorporated below and marked "(advisor)"). This document is the source of truth until
`spec/` is updated; each numbered decision becomes one or more spec edits and
implementation tasks. Nothing here is implemented yet.

## 1. Single workflow mode

- **Free mode is removed** (code, tables, tests). No data migration — the product is
  pre-launch; existing free-mode test projects are deleted.
- Tracker mode becomes the only mode; the `workflow_mode` concept disappears.
- Git tag `pre-concept-redesign` marks the last commit before the change (done,
  2026-07-18, at main).

## 2. Flexible states within tracker mode

- Teams must be able to adapt the state machine — e.g. a non-development project may not
  use deliver. Full column freedom (old free mode) is gone.
- **(advisor) Scope decision: the state set itself stays the fixed enum.** Flexibility is
  per-project **display names** for states plus the ability to **hide the `delivered`
  step** (and optionally `rejected`) so accept follows finish directly. The `accepted`
  literal stays intact everywhere it is hardcoded (finalization RPC, `completed_at`
  trigger, `transition_story`, backlog zone predicate), so velocity and zone semantics
  survive untouched and this work is independent of §7. Owner confirmation pending on
  this narrowing.

## 3. Iterations are fixed-cadence sprints

- Boundaries are pure date arithmetic (`start_date + length`). **Start dates never move
  automatically** — no calendar/holiday influence — so Scrum events stay on the same
  weekday.
- **Per-sprint manual override**: e.g. this sprint only 2w → 3w (long holiday). Overrides
  in whole weeks preserve the start weekday. Subsequent sprints continue from the new
  end. **(advisor)** The override runs inside the existing finalization RPC pattern with
  the advisory lock (`spec/velocity.md` "Finalization concurrency"), and is rejected if
  the iteration is already `state = 'done'`.
- **Cadence is changeable at any time. (advisor corrected wording)**: the change applies
  *immediately, to the next iteration row that gets created* — there is no effective-date
  scheduling mechanism, and lazy catch-up (velocity.md Rollover step 4) uses the length
  at access time, which may retroactively fill gap periods at the new length. Accepted
  trade-off. The settings change gets an `activity_logs` row recording old/new length.

## 4. Cadence is per-project; a "personal project" is just a 1-day project

- A project runs at one cadence (1 day, 1w, 2w, …). Cadences are never mixed inside a
  project. Fast-moving teams may legitimately run 1-day sprints.
- There is no special "personal mode" — a personal project is an ordinary project whose
  cadence is 1 day.
- **1-day cadence (advisor-corrected definition)**: an iteration's `start_date` is a
  working day and its `end_date` is the day before the *next* working day — so Friday's
  iteration spans Fri–Sun and rollover fires on Monday. Work accepted on a non-working
  day therefore lands in the still-current iteration naturally; no writes into finalized
  (`done`) iterations, no re-finalization, and the "counts into the preceding iteration"
  special rule is unnecessary.
- **(advisor)** Working-day determination for 1-day boundaries uses the **project-level
  calendar only** (default weekdays + project exceptions) — never user-level time off,
  which would make iteration existence differ per user. Calendar edits never
  retroactively move or delete existing iteration rows.
- **(advisor)** Lazy catch-up on a neglected 1-day project creates one empty `done` row
  per missed working day. Allowed; the velocity window excludes capacity-0 iterations
  (§7) so they don't distort the rate.

## 5. User-configurable terminology

- Project setting for the display term ("Sprint", "Iteration", free text). Data layer
  stays `iterations`.
- 1-day projects display the date as the iteration title.

## 6. Working-day calendar (new)

- Project setting: default working weekdays (e.g. Mon–Fri).
- Date exceptions in two layers:
  - **Project-level**: public holidays, company closures (`kind`: holiday / extra workday).
  - **User-level**: personal time off, applies across all of that user's projects.
    **(advisor)** The table stores **dates and kind only — no reason/notes column** —
    because co-members must read it for capacity math: READ policy is `user_id =
    auth.uid() OR shares_project_with(user_id)` (existing helper), WRITE self-only.
    Trade-off (a shared project exposes all your time-off dates to its members, viewers
    included) is accepted and must be documented in `spec/rls.md`.
- The calendar affects **velocity and planning math only**, never sprint boundaries
  (single exception: 1-day cadence *start-date selection*, §4).

## 7. Velocity normalized per person-day

- Sprint capacity = Σ over members of their working days in that sprint (calendar-aware,
  minus personal time off).
- **(advisor)** `iterations` gains a **`capacity` column snapshotted by the finalization
  RPC** — capacity is frozen at finalize time, never recomputed, so later member removal
  or calendar edits cannot silently rewrite history. (If lazy finalization runs weeks
  late, capacity reflects membership/time-off at that moment — accepted, documented.)
- **(advisor) Rate formula**: rate = Σ accepted points ÷ Σ capacity over the last
  `velocity_window` non-skipped, capacity>0 `done` iterations (a ratio of sums, not an
  average of ratios — avoids zero-division and over-weighting tiny sprints). Forecast
  for a future sprint = rate × that sprint's planned capacity.
- **(advisor)** The backlog virtual-group computation (`max(velocity, 1)` points per
  group) becomes **rate × planned capacity per future sprint**. This is a per-client
  pure function (web + iOS), so the calendar/capacity math needs **shared golden
  fixtures** as part of the velocity rework.
- Personal time-off compensation is in scope from the start (Pivotal "team strength"
  equivalent).

## 8. AI members

- Agents stay ordinary members (spec/mcp.md agent-as-member), plus a new is-agent flag on
  the profile so UIs can tell them apart.
- Capacity math treats them like humans via the same calendar. **(advisor)** v1 has no
  per-user weekday patterns — only date exceptions — so "agent works weekends" is
  expressed via time-off dates or not at all; per-user weekday patterns are deferred
  (same shelf as the exclude-AI toggle).

## 9. My Work replaces Focus view

- New cross-project personal view ("My Work"): all stories assigned to the signed-in user
  across projects.
  - Stories from a 1-day project's current iteration are today's plan by definition.
  - Stories from longer-cadence projects appear in "today" when the user personally pins
    them. **(advisor) Pin table shape**: `story_pins(user_id, story_id)` PK; SELECT/DELETE
    `user_id = auth.uid()`; INSERT WITH CHECK `user_id = auth.uid() AND` story's project
    membership. No cross-user reads.
  - **(advisor) Pin lifecycle**: `move_story_to_project` recreates pins on the new story
    id for pinners who are members of the destination project (discards the rest) —
    cross-user write, so it lives inside the existing SECURITY DEFINER RPC.
    `remove_member` deletes the removed user's pins in that project (prevents ghost pins
    reviving on re-invite).
  - The global `stories.focus` column is **dropped without data migration** (pre-launch,
    consistent with §1).
  - Personal-project stories are visually distinguished (e.g. color accent). Screen
    details are deliberately not specced yet.
- The per-project **Focus view is removed**; board views reduce to List / Kanban.
  `spec/screens.md` "Focus view" section is deleted with it.

## 10. Quick-add redesign (separate task, researched 2026-07-18)

- Tracker-parity finding: original Pivotal used a single "+ Add Story" icon per panel
  that opens an **inline draft story detail card** (all fields editable, title the only
  required one, Save / Cmd+S) — not an always-visible title-only composer. Storylane's
  current Trello-style composer is the accident to fix; see TASK-82.
- **(advisor)** Ordering: start only after free-mode removal (§1), so the rebuilt
  composer isn't built twice against boards that are about to disappear.
- A Linear-style global quick-add shortcut is deferred; decide when implementing My Work.

## Out of scope / later

- My Work screen spec (buckets, ordering, pin interactions) — at spec-writing time.
- Per-user weekday patterns; exclude-AI capacity toggle (§8).
- Full state-set customization beyond display names + hidden delivered (§2).

## Review record

- 2026-07-18 fable-advisor: **approve-with-corrections** — corrections to §2, §3, §4,
  §6, §7, §8, §9 incorporated above, each marked "(advisor)". Key call: redefining 1-day
  iterations as working-day-start spans (§4) removed a direct conflict with the
  done-iteration write guard and finalize-once design in `spec/velocity.md`.

## Next steps

1. Update `spec/` (glossary, data-model, velocity, screens, features, rls) to match
   §1–§9 including all advisor corrections.
2. Implementation order: free-mode removal (§1) → calendar (§6) → velocity/capacity
   (§7) → cadence flexibility (§3–§5) → story_pins + My Work (§9) → quick-add
   (TASK-82). §2 spec text can proceed independently; §2 implementation after spec.
3. Backlog tasks: see TASK-83…TASK-90 (created 2026-07-18).
