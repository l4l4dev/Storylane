---
name: approved-parity-divergences
description: Deliberate, already-reviewed divergences from the pre-concept-redesign board (tag pre-concept-redesign) — do not re-flag in parity reviews
metadata:
  type: project
---

Known deliberate divergences from the `pre-concept-redesign` tag baseline:

- **Estimate popover (TASK-80, commit bf20a77):** unestimated features show one
  "Estimate" trigger with the point scale in a Popover, replacing the old inline
  point-scale button row. Reason: worst-case 360px story rows overflowed. Passed
  fable design review at the time.
- **Board-level state management (doc-8 §2 option C hybrid):** for members/owners
  the column title is a click-to-rename button and a trailing "+ Add column"
  renders. Viewers see the old board unchanged.

**Why:** AC#3-style parity reviews compare against the tag; these post-tag diffs are
approved product decisions, not regressions.
**How to apply:** when verifying classic-template parity, list these as recorded
divergences instead of findings.
