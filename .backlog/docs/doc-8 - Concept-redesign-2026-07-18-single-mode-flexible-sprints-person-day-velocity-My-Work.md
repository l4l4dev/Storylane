---
id: doc-8
title: >-
  Concept redesign 2026-07-18: single mode, flexible sprints, person-day
  velocity, My Work
type: specification
created_date: '2026-07-18 02:52'
updated_date: '2026-07-18 03:19'
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

## 2. Fully custom states on fixed categories

**Owner decision 2026-07-18 (supersedes the earlier narrowed scope): usability first,
rework cost explicitly accepted.** Board columns become per-project custom states —
freely named, added, removed, reordered — the old free mode's column freedom rebuilt on
top of tracker machinery (iterations/velocity intact). System semantics attach to a
fixed **category** per state, which users rarely think about. Reviewed by fable-advisor
2026-07-18 (second pass, approve-with-corrections; all corrections below).

- **Categories**: `unstarted` (backlog-planning zone), `in_progress`, `done` (entry
  counts for velocity, sets `completed_at`), `rejected` (optional bounce category, 0..n
  states — red styling, Accept/Reject pair on the state before done, Restart back to the
  first in_progress state; zone/velocity semantics identical to in_progress; non-dev
  projects simply don't create one).
- **(advisor) Icebox = `stories.state_id IS NULL`.** No `unscheduled` category or state
  row exists; new stories default to NULL. The backlog zone predicate becomes
  `iteration_id IS NULL AND state_id IS NOT NULL` (NULL-safe, and deleting states can
  never break the Icebox).
- **Shape**: `project_states(id, project_id, name, action_label nullable, category,
  position)` with `UNIQUE(id, project_id)`; `stories.state_id` is a composite FK so
  cross-project references are impossible; RLS follows the custom_statuses precedent
  (members read/write, owner-only delete); positions per the existing position-ordering
  invariant.
- **(advisor) Integrity rules**: category is **immutable** after creation (recategorize =
  create a new state and move stories); deletion is plain-FK blocked while stories point
  at it; a trigger under a per-project advisory lock enforces ≥1 unstarted and ≥1 done
  state at all times.
- **(advisor) Transitions**: the DB allows any→any within the project — `transition_story`'s
  fixed one-step CASE is replaced by `set_story_state(p_story_id, p_state_id)` (SECURITY
  INVOKER, `FOR UPDATE`, unestimated-feature gate, done-iteration guard, auto-assign to
  current iteration on entering in_progress). Ordering discipline moves to the UI: one
  advance-to-next-state button per story using `action_label` verbs. spec/features.md
  "arbitrary state jumps are not allowed" becomes a deliberate divergence.
- **Estimation gate**: an unestimated feature can only sit in NULL (Icebox) or an
  unstarted-category state; RPC and board-move deltas reject the rest.
- **Story types stay orthogonal to states** — no type-specific state sets (matches
  current code); chore/release velocity exclusion survives via the existing type filter;
  releases render as milestone rows in any state.
- **`finish_story_from_git`**: the merge target becomes a configurable state on the
  integration settings (classic template default: Finished; unset = disabled), guarded
  to only move stories forward and never into done/rejected.
- **Default templates** at project creation: **classic** — Unstarted(unstarted) /
  Started, Finished, Delivered(in_progress) / Accepted(done) / Rejected(rejected) with
  Start/Finish/Deliver/Accept/Reject action labels, rendering identically to the current
  Kanban (the Pivotal-parity anchor); **minimal** — Todo(unstarted) / Doing(in_progress)
  / Done(done).
- The advance-button/pair/gate computation stays a per-client pure function
  (packages/core), now driven by project_states data — golden fixtures shared with iOS.
- **External blocker**: the TASK-70 owner decision (any-member vs author/assignee board
  write model) must land before implementation — `set_story_state`'s permission design
  depends on it.

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
- **(advisor) Rate formula**: rate = Σ points of stories entering the done category (§2)
  ÷ Σ capacity over the last
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
- Free-mode extras not carried over: swimlanes, WIP limits (add back only on demand).

## Review record

- 2026-07-18 fable-advisor (1st pass): **approve-with-corrections** — corrections to §3,
  §4, §6, §7, §8, §9 incorporated above, each marked "(advisor)". Key call: redefining
  1-day iterations as working-day-start spans (§4) removed a direct conflict with the
  done-iteration write guard and finalize-once design in `spec/velocity.md`.
- 2026-07-18 fable-advisor (2nd pass, §2 only): the owner overrode the 1st-pass
  narrowing (display names + hidden delivered) in favor of fully custom states;
  **approve-with-corrections** on the category design. Key calls: Icebox becomes
  `state_id IS NULL` instead of a category; category immutable after creation;
  any→any transitions in the DB with ordering discipline in the UI;
  `finish_story_from_git` needs a configurable target state; TASK-70's owner decision
  is a hard prerequisite for the implementation task.

## Next steps

1. Update `spec/` (glossary, data-model, velocity, screens, features, rls) to match
   §1–§9 including all advisor corrections.
2. Implementation order: spec (TASK-83) → free-mode removal (TASK-84) → **state model
   (TASK-91)** → velocity/capacity (TASK-86) → cadence flexibility (TASK-87); calendar
   (TASK-85) in parallel after spec; story_pins (TASK-88) after spec; My Work (TASK-89)
   and quick-add (TASK-82) after the state model lands.
3. Backlog tasks: see TASK-83…TASK-91 (created/reworked 2026-07-18). TASK-91 is blocked
   on the TASK-70 owner decision.
