---
name: learnings-additive-log-lists-need-markers
description: When one entity can render as a card in both a live/active column and a log/history column simultaneously, column position alone doesn't satisfy principle 9 — the card itself needs a dormant/historical marker
metadata:
  type: project
---

Found during TASK-132 (My Work Kanban) design review, re: doc-14's Done
column being an additive completion log (a story completed earlier and now
reopened+in_progress can show as a card in BOTH the Doing column and the
Done column at once — see `story_completions` design in doc-14/TASK-131).
`MyWorkRow` renders the same live `stateBadge` (current real state) in every
column, including Done, with no `completedAt`/"this is a log entry" marker
on the card itself — only the Done column's date-group header
(`groupDoneByDate`) distinguishes it, and that's a container-level label,
not a card-level one.

**Why:** spec/ux-principles.md principle 9 ("Lists distinguish live from
dormant... never interleaved") is normally checked at the list/grouping
level (dormant items grouped below/separately). But once a design allows
the *same* item to appear in a live column and a dormant/log column at the
same time, grouping alone stops being sufficient — a user scanning across
columns can't tell, card by card, which instance is "current" vs
"historical" if both look pixel-identical.

**How to apply:** When a design has an additive/log-style column (a card can
appear there independent of, and simultaneous with, its "live" position
elsewhere), check whether the card component itself carries a distinguishing
marker (a date chip, a checkmark, a muted treatment) for the log instance —
not just the column/section it sits in. If the card component takes no
context/variant prop distinguishing "rendered in the log column" from
"rendered in an active column," flag it as a required fix, not a nice-to-have.
