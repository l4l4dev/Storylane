---
id: doc-8
title: >-
  Concept redesign 2026-07-18: single mode, flexible sprints, person-day
  velocity, My Work
type: specification
created_date: '2026-07-18 02:52'
updated_date: '2026-07-18 02:53'
---
# Concept Redesign 2026-07-18 — single mode, flexible sprints, person-day velocity, My Work

Decisions agreed with the owner in the 2026-07-18 concept session. This document is the
source of truth until `spec/` is updated; each numbered decision becomes one or more spec
edits and implementation tasks. Nothing here is implemented yet.

## 1. Single workflow mode

- **Free mode is removed** (code, tables, tests). No data migration — the product is
  pre-launch; existing free-mode test projects are deleted.
- Tracker mode becomes the only mode; the `workflow_mode` concept disappears.
- **Git tag before the removal commit** so the break point is easy to find in history.

## 2. Flexible states within tracker mode (to be designed)

- Teams must be able to adapt the fixed state machine — e.g. a non-development project may
  not use deliver/accept as-is. Full column freedom (old free mode) is gone; this is
  *configurable steps within one state machine*, not arbitrary columns.
- Open design question, needs its own section when writing the spec: velocity counts
  `accepted` stories, so a customized state set must still designate an
  "accepted-equivalent" terminal state. Do not implement before this is specced.

## 3. Iterations are fixed-cadence sprints

- Boundaries are pure date arithmetic (`start_date + length`). **Start dates never move
  automatically** — no calendar/holiday influence — so Scrum events stay on the same
  weekday.
- **Per-sprint manual override**: e.g. this sprint only 2w → 3w (long holiday). Overrides
  in whole weeks preserve the start weekday. Subsequent sprints continue from the new end.
- **Cadence is changeable at any time**, affecting future sprints only. History needs no
  new mechanism: past iteration rows (start/end dates) already record what the length was
  in any period; the settings change itself gets an `activity_logs` row ("changed from 2w
  to 1w effective YYYY-MM-DD").

## 4. Cadence is per-project; a "personal project" is just a 1-day project

- A project runs at one cadence (1 day, 1w, 2w, …). Cadences are never mixed inside a
  project. Fast-moving teams may legitimately run 1-day sprints.
- There is no special "personal mode" — a personal project is an ordinary project whose
  cadence is 1 day.
- **1-day cadence only**: iterations are created on working days only (Friday → next
  Monday). Work accepted on a non-working day counts into the preceding iteration; no
  retroactive iteration insertion.

## 5. User-configurable terminology

- Project setting for the display term ("Sprint", "Iteration", free text). Data layer
  stays `iterations`.
- 1-day projects display the date as the iteration title.

## 6. Working-day calendar (new)

- Project setting: default working weekdays (e.g. Mon–Fri).
- Date exceptions in two layers:
  - **Project-level**: public holidays, company closures (`kind`: holiday / extra workday).
  - **User-level**: personal time off, applies across all of that user's projects.
- The calendar affects **velocity and planning math only**, never sprint boundaries
  (single exception: the 1-day working-day rule in §4).

## 7. Velocity normalized per person-day

- Sprint capacity = Σ over members of their working days in that sprint (calendar-aware,
  minus personal time off).
- Velocity = accepted points ÷ capacity, averaged over recent sprints → "points per
  person-day". Forecast for a future sprint = that rate × the sprint's planned capacity.
- This keeps the metric comparable across cadence changes, manually extended sprints,
  holiday-heavy sprints, and member vacations. Personal time-off compensation is in scope
  from the start (Pivotal "team strength" equivalent).

## 8. AI members

- Agents stay ordinary members (spec/mcp.md agent-as-member), plus a new is-agent flag on
  the profile so UIs can tell them apart.
- Capacity math treats them like humans — their working days are configurable, since
  agents are not in practice worked 24/7. An "exclude AI from capacity" toggle is
  deferred; it can be added later without schema changes.

## 9. My Work replaces Focus view

- New cross-project personal view ("My Work"): all stories assigned to the signed-in user
  across projects.
  - Stories from a 1-day project's current iteration are today's plan by definition.
  - Stories from longer-cadence projects appear in "today" when the user personally pins
    them: the global `stories.focus` column is replaced by a **per-user pin**
    (user × story), since "today" differs per member.
  - Personal-project stories are visually distinguished (e.g. color accent). Screen
    details are deliberately not specced yet.
- The per-project **Focus view is removed**; board views reduce to List / Kanban.

## 10. Quick-add redesign (separate task, researched 2026-07-18)

- Tracker-parity finding: original Pivotal used a single "+ Add Story" icon per panel
  that opens an **inline draft story detail card** (all fields editable, title the only
  required one, Save / Cmd+S) — not an always-visible title-only composer. Storylane's
  current Trello-style composer is the accident to fix; see the dedicated Backlog task.
- A Linear-style global quick-add shortcut is deferred; decide when implementing My Work.

## Out of scope / later

- My Work screen spec (buckets, ordering, pin interactions) — at spec-writing time.
- Flexible-state design (§2) — own spec section before any implementation.
- Exclude-AI capacity toggle (§8).

## Next steps

1. Update `spec/` (glossary, data-model, velocity, screens, features) to match §1–§9.
2. Split implementation tasks in Backlog (free-mode removal, calendar tables, velocity
   rework, My Work, per-user pin migration, quick-add rebuild).
3. Tag the repo before free-mode removal (§1).
