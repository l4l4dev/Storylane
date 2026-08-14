---
name: learnings-token-aliasing-kills-state-layer
description: Palette swaps that alias --accent/--muted/--secondary to the same value as --card/--popover silently delete every hover, keyboard-focus and selected state; check the state layer, not just text contrast
metadata:
  type: feedback
---

When reviewing a design-token/palette change, check the **state layer** before the text
contrast: compute the delta between `--accent`/`--muted`/`--secondary` and the surface they
render on (`--card`, `--popover`, `--sidebar`). A hand-written design guide usually gives only
two surfaces (page + card), so an implementer maps all five tokens onto those two — and every
`hover:bg-muted`, `focus:bg-accent`, `data-active:bg-sidebar-accent` becomes a 1.00:1 no-op.

**Why:** 2026-08-13 doc-27 warm-dark pass did exactly this (`--card`/`--popover`/`--secondary`/
`--muted`/`--accent` all `#1c1a16`). Text contrast was fine (15:1 / 5.6:1) so a text-only audit
would have passed it, while `DropdownMenuItem`'s `focus:bg-accent` — the only keyboard focus
indicator in the menu — went invisible (WCAG 2.4.7), ghost/outline button hover died, secondary
badges and `bg-muted` avatar placeholders vanished into the card.

**Multi-palette follow-up (TASK-235, a second dark palette added):** four extra checks once a
theme is a *family* of hue rotations. (a) The state-layer delta is a **parity bar**, not just
"non-zero" — the newest palette must match the already-approved one (Slate's `--accent`/`--card`
came out 1.17:1 vs Ember's approved 1.22:1, because equal HSL lightness ≠ equal luminance: WCAG
weights blue 0.0722 vs green 0.7152, so a "pure hue rotation" silently loses contrast in blue and
gains it in green). (b) Lightening a state layer drags `muted-foreground` down with it — the two
hexes move together or AA breaks. (c) `next-themes` (0.4.6) only sets inline `style.colorScheme`
for theme names literally `"light"`/`"dark"`; any other name assigns `null` (CSSOM clears it), so
extra dark palettes need `color-scheme: dark` in their own CSS block or native chrome renders
light. (d) Palette classes are **siblings**, not nested: any token the new class doesn't override
falls through to `:root`'s *light* value, so diff the token list of each block against `.dark`.

**How to apply:** for any `.dark`/`:root` token diff, (1) list the collapsed pairs
(`grep -rn "bg-accent\|bg-muted\|bg-secondary\|sidebar-accent" components/`), (2) compare the new
delta against the delta the *old* palette had — restoring the old ratio is the fix bar, not "3:1"
which is unreachable between two near-black neutrals, and (3) separately require ≥3:1 for
`--input` and for any boundary that was carrying a removed `shadow-*` (WCAG 1.4.11 — the field
border is the only thing identifying the field).
