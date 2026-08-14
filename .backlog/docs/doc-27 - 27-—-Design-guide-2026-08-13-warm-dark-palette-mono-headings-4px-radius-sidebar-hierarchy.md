---
id: doc-27
title: >-
  27 — Design guide 2026-08-13: warm dark palette, mono headings, 4px radius,
  sidebar hierarchy
type: specification
created_date: '2026-08-13 09:16'
updated_date: '2026-08-13 13:40'
---
# Design Guide 2026-08-13 — warm dark palette, mono headings, 4px radius, sidebar hierarchy

Full design guide as given by the owner on 2026-08-13, kept verbatim as source material.
The tokens that shipped in this pass (dark-mode neutral palette, mono headings, 4px radius,
no-shadow/hairline-border rule, compact card padding) are the enforceable spec in
[spec/ux-principles.md](../../spec/ux-principles.md) "Design language" — that section is the
one to read when implementing new UI. This document is the rationale and the parts not yet
implemented (status colors, sidebar hierarchy) — see "Implementation status" below.

## Concept

A self-hosted agile tool for developers, in the lineage of Pivotal Tracker. The tie-break test:

> Would a developer who loved Pivotal Tracker trust this and use it for hours at a stretch?

Not a generic "AI-flavored SaaS dashboard" — an honest, near-terminal texture.

## Design tokens

### Color

| Token | Value | Use |
|---|---|---|
| `--bg-page` | `#14120f` | Page background (warm-leaning black) |
| `--bg-card` | `#1c1a16` | Card background |
| `--border` | `#2a251d` | Hairline rules |
| `--text-primary` | `#ede9e0` | Body text, headings |
| `--text-secondary` | `#9c9789` (shipped; guide's `#928d80` failed AA on the state layer, see below) | Secondary text |
| `--text-muted` | `#6b665a` | Captions, disabled state |

### Status colors (semantic)

| Token | Value | Meaning |
|---|---|---|
| `--state-backlog` | `#57544c` | Not started |
| `--state-started` | `#e8a33d` | In progress (accent color) |
| `--state-finished` | `#3d8f8a` | Finished |
| `--state-delivered` | `#4d7bc7` | Delivered |
| `--state-accepted` | `#6b9c5c` | Accepted |
| `--state-rejected` | `#c24f4f` | Rejected |

### Typography

- Headings, IDs, point values: JetBrains Mono (monospace)
- Body: Inter (sans, unchanged)

### Layout

- Radius: 4px base (0px reads too sharp; 10px+ dilutes the identity — rejected)
- Density: compact (light padding, so the backlog scans easily as a list)
- Shadows: none. Boundaries are hairline borders (0.5–1px), not elevation.

## Sidebar structure

### Approach

Items are not laid out as peers — hierarchy follows use frequency.

```
Storylane
─────────
My Work                    ← project-independent, always bold

─────────
[MyProject ▾]
Board                       ← most frequent, bold
Epics                       ← weekly, normal weight
Iterations                  ← weekly, normal weight

─────────
Activity                    ← low frequency, small/dim
Settings                    ← low frequency, small/dim
```

### Icebox

No standalone sidebar entry — stays a tab (List / Kanban / Icebox) inside the Board screen,
as it is today. Reason: Icebox is a different view (filter) over the same story set as the
Backlog, not a separate destination. A standalone entry would misread Board and Icebox as
separate workflows.

## Ongoing use

When adding a new screen or component, implement against this guide's tokens and the sidebar
hierarchy. When something ambiguous comes up, append to this document.

## Implementation status (2026-08-13 pass)

Scope of the pass: `apps/web` shared UI primitives only (`components/ui/*`,
`components/features/shell/app-sidebar.tsx`) — no page-specific styling touched.

**Shipped** (see `spec/ux-principles.md` "Design language" for the enforceable version).
First pass reviewed by fable-advisor 2026-08-13 (Opus fallback, Fable out of usage
credits) — **verdict: sent back**, one blocker: collapsing `--secondary`/`--muted`/
`--accent` onto the same fill as `--card`/`--popover` made every hover/focus/selected
surface a 1.00:1 no-op (WCAG 2.4.7/1.4.11) — keyboard focus in menus, button hover,
secondary badges, skeletons, and the sidebar's current-page highlight all went
invisible. Corrections below are incorporated; this reflects the corrected state:

- Neutral palette applied to **dark mode only** — owner decision 2026-08-13. The app
  still offers a light/dark toggle (`next-themes`); the guide gives no light-mode
  values, and light mode's tokens are untouched.
- Three fill tiers, not two: `--background` (page) → `--card`/`--popover`/`--sidebar`
  (surface) → `--secondary`/`--muted`/`--accent`/`--sidebar-accent` `#2f2a22` (state
  layer — a step above the surface tier, added on the advisor's correction; the guide
  didn't specify it and the first pass wrongly reused `--bg-card` for it).
  `--text-muted` (`#6b665a`) **is used** — as `--input`, the boundary color for
  anything whose only affordance is now its border (input fields, scrim-less
  popovers/dropdowns/toasts) after the shadow removal below; ≥3:1 against `--card`.
- Headings render in JetBrains Mono (`--font-heading`, `apps/web/app/globals.css`), swapped in
  for Geist Mono at the `next/font/google` load in `apps/web/app/layout.tsx` (same font
  pipeline, no new dependency).
- 4px base radius enforced on `Card`, `Badge`, `Dialog`, and `NativeSelect` — badge
  was a pill via `rounded-4xl` (now a rectangular chip); badge and native-select both
  first landed on `rounded-md` (3.2px), corrected to `rounded-lg` (4px, matching
  Card/Dialog/Button/Input) on the advisor's finding.
- Shadows removed from `DropdownMenuContent`, `PopoverContent`, `Toast`, and
  `NativeSelect`. Each now carries a ≥3:1 `ring-input`/`border-input` boundary instead
  of the weaker `ring-foreground/10`/`border-border` it launched with — those are
  fine on `Dialog`, which keeps a scrim behind it, but not on surfaces with nothing
  behind them.
- `Card`'s padding token (`--card-spacing`) tightened from `spacing(4)` (16px) to `spacing(3)`
  (12px). Card's only consumer is `components/features/projects/project-card.tsx`;
  its hit targets (the `Link` text, `ProjectCardMenu`'s own `h-8` button) don't shrink.
- `apps/web/components/features/shell/app-sidebar.tsx` needed **no code change** — it
  already reads sidebar tokens rather than hardcoding colors — but it wasn't
  unaffected: the current-page highlight (`bg-sidebar-accent`) rides the same state
  layer fixed above, and was one of the surfaces the first pass broke.

Second fable-advisor pass (Opus, same day) confirmed the blocker and both minor
findings resolved, but the state-layer fix above created a new regression: raising
`--muted` to `#2f2a22` dropped `--muted-foreground` (`#928d80`) to 4.30:1 against it —
under AA's 4.5:1 for the 10–12px chip text that uses that pair (story list rows, My
Work rows, state manager chips). Fixed by brightening `--muted-foreground` to
`#9c9789` (one step, same hue family, ≥4.5:1 against both `--muted` and `--card`).
Also dropped `dark:disabled:bg-input/80` from `Input`/`Textarea` — with `--input` now
opaque (`#6b665a`, up from `oklch(1 0 0 / 15%)`), that class made a *disabled* field
render lighter than an *enabled* one; `disabled:opacity-50` alone still carries the
disabled cue. **Verdict after this round: approved.**

Not addressed (advisor noted, out of scope): light mode has the same
`--muted`/`--muted-foreground` pairing at 4.34:1, already under AA before this pass —
pre-existing, not introduced here, and out of scope since doc-27 is dark-only.

## Follow-up: selectable theme set (2026-08-13, TASK-235) — shipped

Owner asked for multiple switchable dark themes, not just one.

- **Scope**: real, user-facing feature (not a prototyping toggle).
- **Palette set**: Ember (this doc's shipped palette, unchanged) + two new
  hue-rotated siblings — **Slate** (cool graphite, hue ~220°) and **Moss**
  (desaturated green, hue ~145°, nods to Pivotal Tracker's own accent lineage) —
  plus the existing Light theme. Three palettes were proposed and compared visually
  in an artifact before the owner picked this set:
  https://claude.ai/code/artifact/c096a14c-8706-41c8-abd7-76df5a706cc0 — its hex
  values were a starting point only; final values below were re-verified against
  the same WCAG contrast math as Ember, not trusted as-is (see "Contrast" below).
- **Persistence**: browser-only (`next-themes` default storage) — no `profiles`
  column, no migration. `next-themes`' explicit `themes` list is
  `["light", "dark", "slate", "moss"]` (`apps/web/app/layout.tsx`); `enableSystem`
  makes next-themes append `"system"` to that list itself. The picker
  (`components/features/shell/mode-toggle.tsx`) exposes all five as menu items —
  System resolves to Light or Ember by OS preference (next-themes hardcodes
  system-following to exactly those two names; Slate/Moss are only reachable by
  explicit choice).
- **CSS structure**: each theme is exactly one class on `<html>` — next-themes'
  `classList.add()` takes one token, not a space-separated multi-class string, so
  a theme can't be layered as a diff on top of `.dark`. Semantic tokens shared by
  all three dark palettes (`--primary`, `--destructive`, `--success`, `--ring`,
  `--chart-*`, `--sidebar-primary`, `--sidebar-ring`) live in one combined
  `.dark, .slate, .moss {}` rule so they can't drift out of sync; each theme's own
  class then only overrides its neutral-palette tokens. The `dark:` Tailwind variant
  (`@custom-variant dark`) now matches any of the three classes, so the handful of
  `dark:`-gated utilities (translucent input tint, invalid-state ring) apply under
  Slate/Moss too without per-component edits. The `.dark .project-accent-N` rules
  (per-project identity color, dark-adjusted) got the same three-way treatment —
  otherwise Slate/Moss would have silently fallen back to light-mode's project
  accent colors.
- **Contrast**: Slate's naive hue-rotated `--input` only cleared 2.81:1 against
  `--card` (WCAG weights blue far below green, so equal HSL lightness across hues
  ≠ equal contrast) — rebrightened from `#5a606b` to `#626873` (3.17:1). Moss's
  naive rotation cleared every target unchanged (`--input` 3.06:1 vs `--card`,
  `--muted-foreground` 4.81–5.96:1). Final values:

  | Token | Ember | Slate | Moss |
  |---|---|---|---|
  | `--background` | `#14120f` | `#0f1114` | `#0f1411` |
  | `--card`/`--popover`/`--sidebar` | `#1c1a16` | `#16181c` | `#161c18` |
  | `--secondary`/`--muted`/`--accent`/`--sidebar-accent` | `#2f2a22` | `#252a35` | `#222f27` |
  | `--border`/`--sidebar-border` | `#2a251d` | `#1d212a` | `#1d2a22` |
  | `--input` | `#6b665a` | `#626873` | `#5a6b61` |
  | `--foreground`/`--card-foreground`/`--popover-foreground`/`--secondary-foreground`/`--accent-foreground`/`--sidebar-foreground`/`--sidebar-accent-foreground` | `#ede9e0` | `#e0e4ed` | `#e0ede5` |
  | `--muted-foreground` | `#9c9789` | `#8f96a3` | `#899c91` |

- Second fable-advisor pass (Opus) independently recomputed every contrast ratio and
  confirmed the token structure — **approve-with-corrections**, three findings, all
  applied:
  - `color-scheme` was missing on Slate/Moss: `next-themes@0.4.6` only sets the
    browser's inline `color-scheme` for theme names literally `"light"`/`"dark"`,
    so Slate/Moss silently lost it — native chrome (date-input calendar icon/panel,
    `<select>` popups, scrollbars) rendered light inside a dark app. Fixed with one
    `color-scheme: dark;` line in the shared `.dark, .slate, .moss {}` block.
  - The picker's `DropdownMenuItem`s had no accessible selected-state — added
    `role="menuitemradio"` + `aria-checked`.
  - `lib/utils/project-color.ts`'s comment still referenced the old
    `.dark .project-accent-N` selector — updated to `:is(.dark, .slate, .moss)`.
  - Flagged for owner triage: dropping "System" from the menu (still functioned as
    an invisible first-visit default) loses the OS-auto-follow capability without a
    replacement — a real regression, though not a "dead control" principle
    violation. **Owner decision: restore it as a 5th menu item** (Light/Ember/Slate/
    Moss/System). Checkmark comparison switched from `resolvedTheme` back to
    `theme` (`resolvedTheme` can never equal the literal string `"system"`, so
    System could never show its own checkmark under that comparison).
  - Independent contrast recheck (WCAG relative luminance, both palettes' oklch/hex
    converted through the same formula) confirmed every reported ratio and surfaced
    the **tightest margin for future headroom decisions: Slate's muted-fg vs state
    layer, 4.67:1** (AA floor 4.5:1) — the first ratio that would break if the state
    layer is ever brightened further.

Third fable-advisor pass (final confirmatory check after all corrections above) —
**approve-with-corrections**, two required fixes, both applied:
  - Slate's state layer (`--secondary`/`--muted`/`--accent`/`--sidebar-accent`) was
    still 1.17:1 vs `--card` — below Ember (1.22) and Moss (1.24), and
    `dropdown-menu.tsx`'s `focus:bg-accent` is a menu item's *only* keyboard-focus
    cue (the exact doc-27-round-1 defect). The "same L/S per tier, only hue
    differs" framing doesn't survive contact with WCAG's luminance weights (blue
    weighted far below green) — rebrightened `#22262f` → `#252a35` (1.237:1,
    matching Ember/Moss), which in turn required `--muted-foreground` `#898f9c` →
    `#8f96a3` (state-layer contrast would otherwise drop to 4.43:1, below AA).
  - No regression test existed for `mode-toggle.tsx`, whose `theme`/`resolvedTheme`
    choice broke twice today. Added `mode-toggle.test.tsx`: renders all 5 items in
    order, checks only the active selection's `aria-checked`, and confirms
    selecting System moves the checkmark to System itself (not to its resolved
    palette) — the literal regression this task hit.
  - Also caught and fixed two pre-existing spec/ux-principles.md inaccuracies this
    pass's edits exposed: "body text stays Inter" (actual: Geist, `--font-sans`)
    and an unqualified "Shadows: none" (true only within this pass's scope,
    `components/ui/*` — several page components still carry `shadow-*`; spec now
    says so explicitly).
- Tracked as **TASK-235**, milestone **UI & Design** (new milestone, created for this
  work since no existing one fit).

`/code-review` (owner-run, medium effort) surfaced one real gap all three advisor
rounds missed: every advisor pass was scoped to dark mode (per the owner's own
dark-only decision for doc-27), so nobody checked what the shadow-removal /
boundary-strengthening changes did to **Light mode**. They broke it:
`--input` in `:root` was still equal to `--border` (`oklch(0.922 0 0)`, ~1.26:1
against `--card`) — the same value `ring-input`/`border-input` now lean on as the
*sole* boundary cue on `DropdownMenuContent`, `PopoverContent`, `Toast`, and
`NativeSelect` post-shadow-removal. Fixed: `:root`'s `--input` → `oklch(0.62 0 0)`
(~3.64:1 against white `--card`), which fixes all four call sites through the token
alone — no component edits needed beyond `Card` (see below). Also applied from the
same review:
- `Card`'s `ring-foreground/10` (~1.27–1.30:1 vs `--card` in every dark palette, and
  now also under-strength relative to Light's fixed `--input`) → `ring-input`,
  matching the boundary rule the diff itself had already applied to
  dropdown/popover/toast. `Dialog` was deliberately left on `ring-foreground/10` —
  it sits behind a scrim, which the second advisor round already judged sufficient.
- Deduped `mode-toggle.tsx`'s `subscribeNever` against the identical
  `NOOP_SUBSCRIBE` already in `my-work-sections.tsx` — moved to `lib/utils.ts` as
  the shared export both now use.
- Deduped the two TS copies of the theme list (`layout.tsx`'s `themes` prop,
  `mode-toggle.tsx`'s `THEMES`) into one `lib/theme-config.ts` `PALETTES` export.
  The three CSS spots (`@custom-variant dark`, the shared token selector, the
  `project-accent` overrides) stay hand-maintained — Tailwind v4 has no
  include/variable mechanism for a selector list — with a `ponytail:`-style
  comment on the first CSS spot naming the risk (adding a 4th palette and missing
  one of the three CSS locations fails silently, no build/lint error).
- Fixed a CLAUDE.md Code Comment Policy violation in `mode-toggle.test.tsx` (history
  narration — "the exact bug this task introduced ... today").
- Added a one-line comment to `Input`/`Textarea` explaining the already-applied
  `dark:disabled:bg-input/80` removal (previously undocumented).
- (Reviewed, not applied) `mode-toggle.tsx`'s hand-rolled `role="menuitemradio"` +
  `Check` icon duplicates the ARIA-radio semantics Radix's
  `DropdownMenuRadioGroup`/`RadioItem` provide natively — not yet wrapped in this
  repo's `components/ui/dropdown-menu.tsx`. Left as-is (tested, correct); revisit if
  a second radio-style menu shows up and the primitive is worth adding.

**Not shipped this pass — needs its own task:**

- Status colors (`--state-*`): no shared token today. Board/epic state colors are computed ad
  hoc in `lib/utils/{burndown,kanban,stories,epics-list}.ts` and
  `components/features/{board/kanban-columns-board,epics/epic-progress-bar}.tsx` — all
  page/feature-specific, out of this pass's scope.
- Sidebar hierarchy (bold Board, small/dim Activity/Settings): `apps/web/components/features/shell/app-sidebar.tsx`
  currently renders every `NAV_ITEMS` entry with the same weight — see
  `spec/screens.md` "Navigation (Web)" for the current, as-built description. Applying the
  hierarchy is a structural change (font-weight tiers, possibly a divider), not a token
  update, so it stayed out of this color/typography/radius/spacing-scoped pass.
