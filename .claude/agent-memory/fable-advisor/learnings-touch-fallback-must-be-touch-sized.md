---
name: learnings-touch-fallback-must-be-touch-sized
description: A control justified as a touch/accessibility fallback must be sized for that modality, not inherit the mouse-density default (icon-xs)
metadata:
  type: feedback
---

When a change adds a control whose stated justification is a NON-mouse modality
(touch, "no hover", "no keyboard"), check its hit size against that modality —
not just against the repo's house density.

**Why:** TASK-150 (doc-17 #7) added left/right chevron move-buttons to My Work
column headers explicitly because "touch has no keyboard arrow keys and no
hover", yet rendered them at `size="icon-xs"` (size-6 = 24px, the mouse-density
default). 24px is below a comfortable touch target (~40-44px). The control's
justification and its size contradict each other — principle 7 ("hit targets
are honest").

**How to apply:** On any UI review, when the code/comment says a control exists
FOR touch/a11y, the hit target must earn that (bump to icon-sm/size-7+ or get
owner sign-off to keep house density). The repo embraces dense `icon-xs` for
mouse chrome, so density itself is fine (design-language) — the flag fires only
when the control's own stated purpose is a fat-finger modality. Relates to
[[review-checklists]] board/interaction pass.
