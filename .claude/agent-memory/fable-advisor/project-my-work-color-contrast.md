---
name: project-my-work-color-contrast
description: TASK-108 My Work rework review outcome + a project-accent palette text-contrast defect that will resurface when the palette is reused elsewhere
metadata:
  type: project
---

2026-07-21 review of TASK-108 (My Work sections rework, doc-12 Thread A):
verdict was 修正付き承認 (approve-with-fixes). Section model/order
(Todo→Today→Doing→Done render, Done>Today>Doing>Todo classification), the
7-day Done window, and rollover-for-all-member-projects were all sound and
matched spec/screens.md "My Work" + spec/velocity.md line 192 (lazy rollover
open to any member including viewers).

The one real defect: `apps/web/components/features/my-work/my-work-row.tsx`
sets the project-name badge's **text** color to the raw
`--project-accent` value (`text-[color:var(--project-accent)]`), not just
its border. Measured contrast (WCAG relative-luminance formula) against the
light-mode card background (white): slot 3 `#e87ba4` = 2.69:1, slot 4
`#eda100` = 2.17:1, slot 5 `#1baf7a` = 2.82:1, slot 6 `#eb6834` = 3.2:1 — all
fail the 4.5:1 AA text threshold (badge text is `text-xs font-medium`, not
bold/large enough for the 3:1 large-text exception). Dark mode is close to
passing (worst case ~3.6:1) but still marginal for slot 2. Border-only usage
(the left border, and the badge border) is fine — only the label text needs
the raw hue removed and replaced with a normal foreground color.

**Why this matters beyond TASK-108:** `apps/web/lib/utils/project-color.ts`'s
docstring says this same id→hue mapping is meant to be reused by the sidebar
project switcher and dashboard project cards in a later task (TASK-109+).
If those are built by reusing `my-work-row.tsx`'s pattern (accent as text
color) instead of accent-as-border/background-tint, the same contrast
failure will repeat there.

**How to apply:** when reviewing any future screen that consumes
`projectAccentClass`/`--project-accent`, check whether it's used as text
color vs. border/background. Recompute contrast for all 8 slots (light AND
dark) before approving if it's used as text; the fix pattern is "drop the
text color override, keep border-only accent, let the label use the
default `text-foreground`/`text-muted-foreground`" — same fix recommended
for `my-work-row.tsx:104`.
