# UX Principles

Interaction and visual rules every UI change must satisfy. Each principle below is
checkable in a review and traceable to a real defect found in the 2026-07-11 user review —
these are not aspirations, they are regressions waiting to recur.

Read this file before designing or implementing anything user-facing (Web or iOS).
UI-affecting tasks end with a fable-advisor design review against this file (see
"Design review gate" below).

---

## Design language

The visual baseline is a square, dense, utilitarian tool in the spirit of original
Pivotal Tracker and Material Design 1–2 — not today's soft, rounded consumer look. Full
rationale and status-color/sidebar-hierarchy tokens not yet applied: Backlog doc-27.
The Shadows rule below is enforced only where doc-27/TASK-235's pass reached
(`components/ui/*`) — several page-specific components still carry `shadow-*`
(e.g. `story-card.tsx`, `story-list-row.tsx`, `board-list-view.tsx`,
`story-peek.tsx`); treat new code as shadow-free and clean up existing callers
opportunistically rather than in one sweep.

- **Corners:** 4px base radius (`--radius: 0.25rem` in `apps/web/app/globals.css`).
  All rounding derives from the `radius-*` tokens; never hardcode a larger radius.
  `rounded-full` is reserved for genuinely circular elements (avatars, dots) —
  chips/badges are rectangular, not pills.
- **Shadows:** none. Elevation reads as a hairline `border`/`ring-1` (0.5–1px), never
  `shadow-*` — and where that border is the *only* cue an element has once a shadow is
  removed (an interactive field's outline, a scrim-less popover's edge), it needs ≥3:1
  contrast against the surface behind it (WCAG 1.4.11), not just a hairline tint.
- **Density:** compact rows and cards; information a project member needs daily
  (state, points, epic, assignee) is visible without hovering or expanding.
- **Color (dark mode):** three selectable dark palettes (TASK-235) — **Ember**
  (`.dark`, the default dark palette — first-visit default is actually OS-driven
  "system", resolving to Light or Ember), **Slate** (`.slate`, cool graphite), **Moss** (`.moss`,
  desaturated green) — plus Light. All three share one recipe: near-black neutrals,
  not neutral gray, in three fill tiers (page → surface → state layer: hover/focus/
  selected), and only rotate hue; a new palette is a hue rotation of Ember's
  lightness/saturation steps, re-verified against the same contrast rules below, not
  a fresh design. Never collapse the state layer onto the surface tier — doing so
  once (fable-advisor 2026-08-13, doc-27) made every hover/focus/selected cue a
  1.00:1 no-op. `--muted-foreground` needs ≥4.5:1 against both the state layer and
  the surface tier (doc-27's first Ember value only cleared 4.30:1 against the state
  layer — short of AA for small text). `--input` needs ≥3:1 against the surface tier
  wherever a border is the sole affordance signal (see the Shadows rule above) — a
  naive same-lightness hue rotation isn't enough to guarantee this: WCAG luminance
  weights blue far below green, so Slate's naive rotation only cleared 2.81:1 and
  needed rebrightening while Moss's cleared 3.06:1 unchanged (TASK-235). Exact
  per-palette values live in `apps/web/app/globals.css` (`.dark`/`.slate`/`.moss`);
  don't hardcode a dark-palette hex outside its own class block — `--primary`,
  `--destructive`, `--success`, `--ring`, `--chart-*`, `--sidebar-primary`, and
  `--sidebar-ring` are shared across all three (`.dark, .slate, .moss {}`) since
  they're brand/status colors, not part of the neutral rotation. Light mode's
  palette itself is untouched — none of the three guides (doc-27 or its TASK-235
  follow-up) give a light palette, so this rule stays dark-only until one exists —
  but its `--input` did need fixing (`/code-review` 2026-08-13): every advisor round
  above only checked dark palettes, so nobody caught that `:root`'s `--input` was
  still equal to `--border` (~1.26:1 against `--card`) even after it became the sole
  boundary cue on shadow-free components. Fixed to `oklch(0.62 0 0)` (~3.64:1).
- **Typography:** headings, IDs, and point values render in the mono family
  (`--font-heading`, JetBrains Mono via `next/font/google`); body text stays
  Geist/sans (`--font-sans`, `apps/web/app/layout.tsx`).
- **Dates:** always `YYYY/M/D` (datetimes `YYYY/M/D HH:mm`), via the shared formatter —
  never bare `toLocaleDateString()`/`toLocaleString()`.
- **Copy:** never use third-party product names in UI text — e.g. the
  iteration/velocity workflow is Storylane's own; "Pivotal Tracker" must
  never appear in the product UI (spec/features.md).

## Interaction principles

1. **No dead controls.** A visible action is either pressable or explains itself
   in place. Never render a disabled button whose reason lives only in a hover
   tooltip; replace it with the action that unblocks it.
   *(Defect: unestimated feature showed a disabled Start + warning icon with no path
   forward. Original Tracker showed the point-scale buttons in Start's place.)*

2. **Every action produces visible feedback.** A click that results in no state
   change must say why. Server actions that return "nothing to do" surface that
   message; they never end in silence.
   *(Defect: Finish iteration on a not-yet-started iteration silently did nothing.)*

3. **Conditional UI never shifts layout.** Toggles, warnings, and hover affordances
   reserve their space; switching views must not move the controls the user is
   about to click.
   *(Defect: Icebox button appearing/disappearing shifted the view switcher between
   List/Kanban/Focus.)*

4. **The destination of a create action is visible at the point of action.** An
   "add" affordance lives inside the group that will receive the item, and the new
   item lands at a predictable position (bottom of that group).
   *(Defect: Add story only targeted the Backlog; with future iterations present the
   landing place was a mystery.)*

5. **Saved values render as values, not editors.** After a save, a field returns to
   text with an edit affordance; a live input implies unsaved state.
   *(Defect: iteration goal stayed a text field after saving.)*

6. **Irreversible actions stay out of the primary click path.** Buttons like
   Finish iteration sit at an edge or behind an overflow menu, never centered where
   routine clicks land. A confirm dialog is a seatbelt, not a placement excuse.
   *(Defect: Finish iteration centered in the board header.)*

7. **Hit targets are honest.** Anything clickable is at least a full row/gap tall at
   the moment the user aims for it — no pixel-hunting thin lines, and appearing
   affordances obey principle 3.
   *(Defect: + Note / + Iteration break hover line.)*

8. **Relations stay visible where the user works.** Membership (epic, iteration,
   labels) shows on the item wherever it renders; acting on an item never teleports
   the user out of their current context — stay put and offer a link.
   *(Defect: promoting a story to an epic made its stories' grouping invisible on the
   boards and force-navigated to the epic screen.)*

9. **Lists distinguish live from dormant.** Archived or done things group in their
   own clearly-labelled section below active ones — never interleaved or sorted first.
   *(Defect: archived projects appeared first when shown.)*

10. **After creating something, go to it.** A successful create lands the user in the
    thing they created, not back at the list.
    *(Defect: creating a project returned to the Projects page.)*

## Tracker-parity verification

For any tracker-mode screen or interaction, check what original Pivotal Tracker
actually did **before** designing. The product died in 2025 but its help site is
archived; fetch pages with:

```
curl -sL "https://web.archive.org/web/2024id_/https://www.pivotaltracker.com/help/articles/<slug>/"
```

(article slugs: `story_states`, `estimating_stories`, `adding_stories`,
`working_with_stories`, `tracker_workflow`, …). Record the finding in the Backlog task
before implementing. Storylane may deliberately diverge, but never diverge by accident.

## Design review gate

Every task that changes user-facing UI ends with a fable-advisor review against this
file (via the `/advisor` skill), after implementation and before the owner's manual
verification. The review question is: "which principle does this change violate, if
any?" Findings block merge until triaged with the owner.
