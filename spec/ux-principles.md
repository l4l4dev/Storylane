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
Pivotal Tracker and Material Design 1–2 — not today's soft, rounded consumer look.

- **Corners:** 4px base radius (`--radius: 0.25rem` in `apps/web/app/globals.css`).
  All rounding derives from the `radius-*` tokens; never hardcode a larger radius.
  `rounded-full` is reserved for genuinely circular elements (avatars, dots).
- **Density:** compact rows and cards; information a project member needs daily
  (state, points, epic, assignee) is visible without hovering or expanding.
- **Dates:** always `YYYY/M/D` (datetimes `YYYY/M/D HH:mm`), via the shared formatter —
  never bare `toLocaleDateString()`/`toLocaleString()`.
- **Copy:** never use third-party product names in UI text (defect: free-mode template
  displayed as "KanbanFlow").

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
