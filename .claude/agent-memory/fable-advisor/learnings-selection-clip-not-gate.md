---
name: learnings-selection-clip-not-gate
description: Text-selection capture must clip the range to the extractable region, never gate on anchor/focus containment — Cmd+A and triple-click put boundaries outside the node
metadata:
  type: feedback
---

For selection-driven extraction UI, clip the Range to the target node's contents
(compareBoundaryPoints + setStart/setEnd); never require anchorNode/focusNode to
be inside the node.

**Why:** Split Studio (split-studio.tsx, reviewed 2026-08-04) shipped a
containment gate first; triple-click (range end promoted past the `<p>`) and
Cmd+A (both ends outside) were dropped, so the whole paragraph read as
highlighted while the button stayed disabled or extracted a stale shorter
phrase — a principle 1 + 2 defect. Clipping is not "silent" when the result
lands in a visible, editable field the user sees before committing: that field
IS the preview, and a separate preview block would fight principle 3.

**How to apply:** When reviewing any selection-capture change, ask three
things: (1) does Cmd+A / triple-click still work (boundaries outside the
node)? (2) does an out-of-node selection keep the last value (clicking the
action button itself moves the selection out)? (3) is the collapsed-caret
inside-the-node case tested (clears vs keeps is the boundary that breaks
first)?
