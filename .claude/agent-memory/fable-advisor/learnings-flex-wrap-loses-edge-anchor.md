---
name: learnings-flex-wrap-loses-edge-anchor
description: flex-wrap fixes overflow but strips edge placement — a destructive control pushed right by a sibling's flex-1 lands mid-line after wrapping, next to routine targets
metadata:
  type: feedback
---

When a row gains `flex-wrap` to fix narrow-viewport overflow, re-check every control whose
edge position was created by a sibling's `flex-1` absorbing the slack. After the wrap that
sibling is on a different line, so the control lands at the wrapped line's natural flow
position — often mid-line, adjacent to a routine click target.

**Why:** 2026-08-04 review of the 375px fixes — state-manager.tsx wrapped the action-label
field + Delete X into a `w-full` line; the X (edge-anchored on desktop only via the name's
`flex-1`) ended up directly beside the inline-edit target, violating ux-principles #6
(irreversible actions sit at an edge). Fix was one class: `justify-between` on the wrapper
(harmless at `sm:w-auto` where there is no slack).

**How to apply:** for any responsive-wrap diff, ask "what pushed this button to the edge
before?" If the answer is a flex-1 sibling now on another line, require `justify-between`
or `ml-auto` inside the wrapped group. Also note: a single item wrapped onto its own line
under `justify-between` renders at flex-start (left) — that part is fine, no explicit
narrow layout needed. Related: [[learnings-touch-fallback-must-be-touch-sized]].
