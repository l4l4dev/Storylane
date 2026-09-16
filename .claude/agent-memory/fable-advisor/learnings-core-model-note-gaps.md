---
name: learnings-core-model-note-gaps
description: Facts the git-ignored Tracker corpus settles that docs/reference/tracker-notes/core-model.md (2026-09-16) got wrong or omitted — default point scale, accepted is reversible, release/chore state sets; grep the corpus before trusting a note's "unknown" or a plan's "assumption"
metadata:
  type: project
---

Step-1 gate (2026-09-16) found the derived note and the plan contradicted the corpus in
three places. `docs/reference/tracker/` is git-ignored but present locally — grep it.

- Default `point_scale` is **Linear `0,1,2,3`** (`articles/estimating_stories.md:13`), not
  Fibonacci as the plan's `DEFAULT_POINT_SCALE` had it.
- **Accepted is not terminal**: "active or accepted stories can be moved back to the
  unstarted state at any time" (`articles/analytics_cycle_time.md:59`); `accepted_at` can be
  backdated (`analytics_burndown.md:42`). Any "accepted is terminal" rule is an accidental
  divergence.
- Release states are exactly unscheduled / unstarted / planned / finished (+ accepted):
  "milestones only, they don't need more states" (`articles/story_states.md:45`,
  `csv_import_export.md:166`). Chore states: unscheduled / unstarted / planned / started /
  accepted — no finished, delivered or rejected.

**Why:** the note's §9 "unknowns" and a plan's "Assumptions" invite guessing; several were
answerable by grep.

**How to apply:** when a plan resolves a "(corpus)" item or an Assumption, grep the corpus
for the keyword before accepting it. Cite file:line in the verdict so the implementer can
fold it into the note.
