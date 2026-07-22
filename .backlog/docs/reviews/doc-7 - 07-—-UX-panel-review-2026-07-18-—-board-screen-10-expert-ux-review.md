---
id: doc-7
title: 07 — UX panel review 2026-07-18 — board screen (10-expert /ux-review)
type: other
created_date: '2026-07-17 15:21'
updated_date: '2026-07-22 09:04'
tags:
  - web
  - ux
  - review
---
# UX Panel Review 2026-07-18 — Tracker Board Screen (10-Expert /ux-review)

Ten parallel expert-persona agents (Rams, Ive, Norman, Nielsen, Wroblewski, Krug, Au, Garrett, Hall, Levey — all completed) each reviewed the tracker-mode board screen independently; findings were deduplicated and weighted by how many experts raised them.

**Scope**: `apps/web/app/projects/[id]/board/page.tsx` + 13 components under `apps/web/components/features/board/` (kanban-board, board-list-view, kanban-columns-board, story-card, story-list-row, quick-add-composer, board-filters, story-peek(+host), epic-panel, promoted-epic-banner, mutation-error-banner). Free/Focus boards and `transition-buttons` were touched only where scope files render them.

**Constraints applied**: no palette/font/identity changes, no new frameworks, no motion; fixes must hold in light+dark and at 360/768/1024px.

**Disposition**: High #1–12 approved by the owner → TASK-79 (10 items) + TASK-77 (filter clear-all & filtered-empty hint, view persistence; owner decision to persist recorded there). Medium/Low NOT yet approved — kept here for future batches.

---

## High Impact (hurts usability/readability; 3+ experts or Norman/Nielsen/Krug core)

| # | Issue | Experts | Location | Fix | Tracked |
|---|-------|---------|----------|-----|---------|
| 1 | Iteration bar prints the end date twice: `{start} – {end}` then `auto-finishes on {end}` | 7 (Rams, Ive, Nielsen, Krug, Wroblewski, Garrett, Hall) | `kanban-board.tsx:152-160` | Drop the span; fold into range label `(auto-finishes)` | TASK-79 |
| 2 | No one-click filter clear + a fully-filtered-out board is indistinguishable from an empty one | 5 (Nielsen, Krug, Norman, Garrett, Hall) | `board-filters.tsx:51-141` | "Clear all filters" in popover; "No stories match the current filters." empty hint | TASK-77 |
| 3 | Iteration-goal edit pencil is hover-only — invisible on touch; saved goal reads as static text | 5 for persistent (Krug, Norman, Garrett, Hall, Levey); Ive alone for removal | `kanban-board.tsx:393-396` | Persistent faint pencil (`opacity-60`), drop `opacity-0 group-hover` | TASK-79 |
| 4 | StoryListRow: title is the only shrinkable element; `shrink-0` chips crush it on narrow widths | 5 (Wroblewski, Krug, Garrett, Hall; Rams runner-up) | `story-list-row.tsx:53-113` | Title `min-w`; responsively demote points/epic chips like labels already are | TASK-79 |
| 5 | `h-[calc(100dvh-13rem)]` duplicated in two files and breaks when the header wraps on mobile | 5 (Wroblewski, Rams, Au, Levey, Ive) | `kanban-columns-board.tsx:140`, `board-list-view.tsx:955` | Fixed height `lg:` only; hoist value to one shared constant | TASK-79 |
| 6 | View selection (List/Kanban/Focus) and Icebox visibility reset every load while filters/collapse persist | 4 (Nielsen, Krug, Garrett, Hall) | `kanban-board.tsx:116-117` | Persist per project (localStorage, mirroring `useCollapsedGroups`) — owner decided persist | TASK-77 |
| 7 | List view repeats iteration identity: section header restates `Iteration #N · current · pts` under the bar that already says it (capitalization also differs) | 4 (Rams, Ive, Krug, Au) | `board-list-view.tsx:1180-1185` | Reduce header to `Current · {pts} pts` | TASK-79 |
| 8 | Committed pts and velocity — the screen's core comparison — sit in disconnected regions | 4 (Rams, Garrett, Nielsen, Hall) | `page.tsx:260` / `kanban-board.tsx:156` | Velocity into the iteration bar: `{committed} / {velocity} pts committed` | TASK-79 |
| 9 | `<h1>Board</h1>` never names the project (fetched but unused) — Trunk Test failure | 3 (Nielsen, Krug, Garrett) | `page.tsx:259,433` | `project.name` as heading, demote "Board"; pass name to FreeBoardPage | TASK-79 |
| 10 | Label/epic chips render user-chosen color as text over a 13%-alpha tint of itself — contrast fails for pale/dark colors, differently per theme | 3 (Levey, Garrett; Nielsen noted) | `story-card.tsx:79-88,154-161`, `story-list-row.tsx:84-92` | Color only in the dot/tint; names in `text-foreground` | TASK-79 |
| 11 | Note / manual iteration-break delete is instant with no confirm, while Finish iteration confirms | 2, error-prevention core (Nielsen, Norman) | `board-list-view.tsx:199-215,338-353` | Reuse existing confirm-dialog pattern (precedent TASK-72) | TASK-79 |
| 12 | Drag-failure banner mounts at the top of the scroll region — a failed drop deep in a long backlog reports off-screen | 2, visibility core (Nielsen, Garrett) | `board-list-view.tsx:1175`, `kanban-columns-board.tsx:301` | `sticky top-2` or `scrollIntoView()+focus()` on set | TASK-79 |

## Medium Impact (unpolished inconsistencies; 2+ experts or Rams/Au/Ive precision) — deferred

| # | Issue | Experts | Location | Fix sketch |
|---|-------|---------|----------|------------|
| 13 | Touch targets systematically small: `icon-xs` = 24px, collapse chevrons ≈14px, `text-[10px]` insert buttons a few px tall | Wroblewski, Levey | rows/dividers/toolbar | Expand hit area (`-m-2 p-2`), `max-sm:size-9` on icon buttons |
| 14 | Drag affordances missing: no grab cursor at rest, no valid/invalid drop-target highlight, empty zones are dead blank space | Norman | `sortable-item.tsx`, columns, empty lists | `cursor-grab`; ring valid targets during drag; dashed "Drop stories here" placeholder |
| 15 | A11y cluster: toggles lack `aria-pressed`; goal input `focus:outline-none` with no ring; peek gets no focus on open/return on close; avatar name is `title`-only; generic "Collapse" labels | Nielsen, Levey | switcher, `kanban-board.tsx:430`, `story-peek.tsx`, chips, section headers | Add aria/ring tokens/focus management (peek focus already in TASK-77) |
| 16 | Keyboard drag impossible (Space opens peek) and Kanban state changes are drag-only — no keyboard/AT path at all in Kanban | Levey | `kanban-columns-board.tsx:89-95` | Dedicated drag handle with dnd-kit listeners; TransitionButtons in Kanban too |
| 17 | `text-[10px]` in five places — an off-scale 5th text size | Au, Levey | story-card/row, board-list-view | Unify to `text-xs` |
| 18 | Points/label/avatar pills copy-pasted between card and row and already diverged (responsive hiding on one side only); `STORY_TYPE_ICON` map defined twice | Ive, Au | `story-card.tsx` / `story-list-row.tsx` | Extract shared `PointsPill`/`LabelPill`/`AssigneeChip` beside `EpicBadge` |
| 19 | Corner-radius inconsistency: cards `rounded-lg` vs `rounded-md` peers; sibling pills `rounded-full` vs `rounded` | Ive, Au | cards, epic-panel, quick-add, pills | Cards = lg; pills = full (badge-radius item also in TASK-77) |
| 20 | Gap inconsistency: card stacks `gap-2` vs `gap-1.5`; header rows `gap-2` vs `gap-3`; board gaps `gap-3` vs `gap-4` | Rams, Au | boards/lists/headers | Pick one value per role |
| 21 | Decorative `rotate-1` tilt on drag overlays carries no information | Rams, Ive | `kanban-columns-board.tsx:329`, `board-list-view.tsx:1216` | Remove |
| 22 | Persistent instructional hints: "Esc to close"; error's "press Enter to retry" contradicts the Add button | Rams, Ive | `quick-add-composer.tsx:142,147` | Delete hint; error message only |
| 23 | Kanban hides Backlog/Icebox with no hint they exist — an empty-looking board with 50 backlog stories reads as "empty project" | Krug, Hall | `kanban-columns-board.tsx` | One muted line: "Backlog and Icebox are managed in List view." |
| 24 | Kanban horizontal scroll has no snap or edge cue that more columns exist | Wroblewski, Norman | `kanban-columns-board.tsx:302` | `snap-x snap-mandatory` + right-edge gradient mask (CSS only) |
| 25 | Same heading rank at two sizes: Kanban column `h2 text-sm` vs List zone titles `text-xs`; "Iteration #N" `text-base` in bar vs `text-xs` in List | Au | headers | Unify zone/column titles on `text-sm font-semibold` |
| 26 | Inline estimation dumps the whole point scale (6+ buttons) into an already-crowded row | Wroblewski | `transition-buttons.tsx:76-97` | Single "Estimate" trigger opening existing Popover |
| 27 | Icebox column sits beside the list on mobile, crushing the primary content to a sliver | Wroblewski | `board-list-view.tsx:1173,1209` | `flex-col lg:flex-row`; Icebox full-width when stacked |
| 28 | Kanban column pts follow the active filter while the bar's committed total doesn't — same "pts" label, two meanings | Norman | `kanban-columns-board.tsx:146` | Compute from unfiltered containers, or relabel "N shown" |
| 29 | List-row meta chips look identical to the card's clickable ones but are dead (false affordance) | Norman | `story-list-row.tsx:73-100` | Include meta cluster in the openPeek surface |
| 30 | No in-flight feedback on filter changes / realtime refresh (server round-trip looks like nothing happened) | Nielsen | `board-filters.tsx:44` | `useTransition` + dim while pending |

## Low Impact (single expert / edge case) — deferred

| # | Issue | Expert | Location |
|---|-------|--------|----------|
| 31 | Empty-state copy quotes a nonexistent label: `"+ Add story"` vs actual "Add story" | Rams | `kanban-board.tsx:249-251` |
| 32 | Card title has no `line-clamp` — a pasted 300-char title makes a towering card | Hall | `story-card.tsx:135` |
| 33 | New projects show "Current velocity: 0 pts" — unknown presented as zero; 0 also feeds backlog segmentation | Hall | `page.tsx:226,260` |
| 34 | "Current" badge labels a set of one (the bar only ever shows the current iteration) | Ive | `kanban-board.tsx:149-151` |
| 35 | "manual" break badge's meaning lives only in a `title` tooltip | Krug | `board-list-view.tsx:367-384` |
| 36 | Filters use `router.replace` so Back can't undo a filter, while peek uses `push` | Norman | `board-filters.tsx:44` |
| 37 | Velocity figure is unexplained jargon — no tooltip about the window/derivation | Nielsen | `page.tsx:260` |
| 38 | `p-6` page padding eats 48px of a 360px viewport | Wroblewski | `page.tsx:257,431` |
| 39 | Story peek on mobile: full-screen but board still scrolls behind, no backdrop | Wroblewski | `story-peek.tsx:43-45` |
| 40 | Labels vanish entirely below `sm` — no dot/+N fallback, label info lost on phones | Levey | `story-list-row.tsx:87` |
| 41 | Drag overlay width (`w-64`) ≠ resting card width in `w-72` column — card resizes at pick-up | Au | `kanban-columns-board.tsx:329` |
| 42 | Icebox count shown twice when column open (toggle badge + column header) — note: badge behavior is a TASK-59 decision | Ive | `kanban-board.tsx:226-231`, `board-list-view.tsx:957-959` |

## Expert consensus (themes raised by 5+ experts)

1. **Repetition of the same fact** (end date ×2, iteration identity ×2) — density without information.
2. **Hover-gated affordances** (goal pencil, insert band) — nonexistent on touch.
3. **Inconsistent state persistence** — collapse remembered, view choice forgotten.
4. **The title (primary scan target) loses to secondary chrome** in rows and cards.
5. **Mobile structural breakage** — fixed column height, sub-24px targets, side-by-side Icebox.

## Conflicts & owner-decision items

- **Goal pencil (#3)**: Ive alone argued for removal; the other five for persistent visibility. Owner approved the persistent-faint fix.
- **Finish-button invisible layout reserve** (Hall): conflicts with the deliberate TASK-59 decision — excluded from fixes; revisit only if the owner reopens TASK-59.
- **Dual insert mechanisms** (hover band + "…" menu): Krug wants the band deleted; Levey/Hall consider the menu the touch path and the band a fine enhancement. Split opinion — deferred, owner call.
- **Rejected column pop-in/out** (Hall): check original Pivotal Tracker behavior before changing (parity rule).

## Method note

Each expert reviewed independently against their own published principles (heuristics, Five Planes, Trunk Test, WCAG, mobile-first, type/spacing systems), blind to the others' findings. Findings flagged by several experts independently carry the most weight; single-expert Lows are candidates, not mandates.
