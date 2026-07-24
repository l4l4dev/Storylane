---
name: learnings-oneshot-url-override-pins-control
description: A one-shot ?param view override seeded into useState with no release path silently pins the matching toggle into a dead control
metadata:
  type: feedback
---

When a screen seeds a one-shot navigation override from a query param
(`const [forced] = useState(() => searchParams.get("view") === "list" ? "list" : null)`)
and derives the live value as `forced ?? synced`, the override never releases:
`forced` stays non-null for the component's whole lifetime, so the user's own
toggle click updates `synced` but the derived value is still `forced`. The
toggle becomes a **dead control** (ux-principles §1) with **no visible feedback**
(§2).

**Why:** found in TASK-183 Split Studio (kanban-board.tsx ~L215-216). The
post-split redirect `?view=list&icebox=1` forced List correctly, but the
Kanban/List toggle then did nothing until a full navigation away. Contrast the
Icebox one-shot in the same file: it uses real `useState`+`setShowIcebox`, so
its toggle works — only the `forced ?? synced` view was broken.

**How to apply:** whenever you see a one-shot URL override feeding a control's
value, check there is a release path — clear the override (`setForced(null)`)
inside the control's own onClick, or seed the store instead of shadowing it.
Mirror the sibling one-shot that already uses plain settable state. Also test:
a bookmarked/shared `?view=...` URL should not permanently pin the toggle.
