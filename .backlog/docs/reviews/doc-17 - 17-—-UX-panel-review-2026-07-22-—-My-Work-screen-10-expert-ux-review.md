---
id: doc-17
title: 17 — UX panel review 2026-07-22 — My Work screen (10-expert /ux-review)
type: other
created_date: '2026-07-22 13:29'
updated_date: '2026-07-22 13:29'
---
# UX Panel Review 2026-07-22 — My Work Screen (10-Expert /ux-review)

Ten parallel expert-persona agents (Rams, Ive, Norman, Nielsen, Wroblewski, Krug, Au, Garrett, Hall, Levey — all completed) each reviewed the My Work screen independently, blind to the others; findings were deduplicated and weighted by how many experts raised the same issue (two findings pointing at the same location/behavior are merged even when worded or scored differently).

**Scope**: `apps/web/app/my-work/page.tsx` + `apps/web/app/my-work/layout.tsx` and the four components under `apps/web/components/features/my-work/` (my-work-sections, my-work-row, my-work-column-manager, my-work-quick-add). Shared components (draft-story-card, sortable-item, mutation-error-banner, and `kanban-columns-board`'s shared column-height constant) were touched only where the scope files render or reuse them.

**Constraints applied**: no palette/font/identity changes, no new frameworks, no motion; fixes must hold in light+dark and at 360/768/1024px.

**Disposition**: no Backlog tasks filed yet — the High rows carry `—` in Tracked pending owner triage; Medium/Low kept here for future batches.

---

## High Impact (hurts usability/readability; 3+ experts or a 2-expert Nielsen/Norman/Krug core)

| # | Issue | Experts | Location | Fix | Tracked |
|---|-------|---------|----------|-----|---------|
| 1 | Deleting a free column is a single-click destroy — no confirm, no undo, no statement of where its cards go | 4 (Rams, Norman, Nielsen, Krug) | `my-work-column-manager.tsx:67-92` | Inline confirm ("Delete 'Doing'? Its cards move to Todo.") and/or an undo toast; state the card destination on the control | — |
| 2 | Below the `sm` breakpoint a cross-project row collapses to an unlabeled color stripe — project chip and points are `hidden` | 6 (Rams, Nielsen, Wroblewski, Krug, Garrett, Levey) | `my-work-row.tsx:85,94` | Keep a compact project marker (initials/code) visible at all widths, or expose the project name in the row's accessible name; hiding points is acceptable, hiding identity is not | — |
| 3 | Personal-vs-team category — which governs drag semantics — is invisible on the card; the two behavior classes look identical | 4 (Norman, Krug, Garrett, Hall) | `my-work-row.tsx:40-98`; `page.tsx:41` (`isPersonal` computed then dropped in `toRowData`) | Carry `isPersonal` into `MyWorkRowData` and give personal rows a persistent labeled signifier (a small "Personal" tag/icon) | — |
| 4 | Empty-state tells every user to "add a personal task above," but the quick-add renders only for exactly one personal project — for zero/multiple it is absent with no explanation | 6 (Rams, Norman, Nielsen, Wroblewski, Garrett, Hall) | `my-work-sections.tsx:483-486` vs `page.tsx:202` | Branch the copy on whether the quick-add is present; when absent, show a short line ("Add tasks from a personal project's board") instead of nothing | — |
| 5 | Empty individual columns — notably an unplanned Today — render as a bare `min-h-10` strip with no placeholder or plan prompt | 4 (Norman, Nielsen, Krug, Hall) | `my-work-sections.tsx:135,382,403` | One muted line per empty column body ("Drag cards here to plan today") | — |
| 6 | "Columns" is one object edited in two disconnected places — add/rename/delete in a collapsed panel, reorder on the board grip — and the panel's "Manage columns" label over-scopes what it does | 4 (Rams, Ive, Nielsen, Garrett) | `my-work-column-manager.tsx:94-164` vs `my-work-sections.tsx:106-120` | Fold rename/delete onto the column header where order already lives; narrow the panel/label and cross-reference reordering | — |
| 7 | Column reordering is discoverable only through a bare grip icon (up/down buttons removed in TASK-148); no resting-state cue, no panel hint, and no non-drag path on touch | 5 (Rams, Nielsen, Krug, Garrett, Wroblewski) | `my-work-sections.tsx:106-120` | Make the grip read as a handle (contrast/`cursor-grab`), add a one-line hint in the manage panel, and give touch a non-drag "move left/right" fallback | — |
| 8 | Reordering a card inside a free column looks like it worked — it animates and stays on release — then silently reverts on refresh; only Today persists order | 3 (Rams, Norman, Garrett) | `my-work-sections.tsx:294,337-359`; `lib/utils/my-work.ts:222-234` | Make free columns unsortable at the interaction layer (membership only), or persist their order too — don't leave an optimistic move the model undoes | — |
| 9 | Carry-over "Not today" never states its outcome — items fall back to their columns, but the label reads as "dismiss/skip" | 4 (Nielsen, Krug, Garrett, Hall) | `my-work-sections.tsx:455-475` | Relabel to the actual result, e.g. "Carry over" / "Leave in their columns" | — |
| 10 | Done accepts a team-story drop mid-drag then the server rejects it and snaps it back — a false affordance (drag-over allows every card into every column via `() => true`) | 2 (Rams, Norman; Norman error-prevention core) | `my-work-sections.tsx:279-295,361-368`; `actions.ts:64-67` | Gate Done as a non-droppable target for team cards during drag-over so the card never enters a place it cannot stay | — |

## Medium Impact (unpolished inconsistencies; 2+ experts or Rams/Au/Ive precision) — deferred

| # | Issue | Experts | Location | Fix sketch |
|---|-------|---------|----------|------------|
| 11 | Carry-over is one all-or-nothing yes/no with no undo — a misclick on "Not today" drops the whole day's plan | Norman, Nielsen | `my-work-sections.tsx:239-249,449-480` | Per-item selection, or a brief "Undo" affordance on the banner after resolving |
| 12 | A story that is both live and completed renders in an active column and in Done, differentiated only by a subtle marker — reads as a duplication bug | Norman, Krug | `my-work-row.tsx:57-64` | Give Done entries a distinct log-style treatment so the duplicate reads as history, not a second copy |
| 13 | Carry-over buttons are hand-rolled `<button>`s that drift from the shared `Button` (size, radius, no focus-visible ring) | Nielsen, Au | `my-work-sections.tsx:460-475` | Render with `<Button size="sm" variant="outline">` / `variant="ghost"` |
| 14 | Done is dressed as a peer draggable column (same shell, grip, count) but is an append-only, 7-day-truncated log — its nature isn't marked | Rams, Garrett | `my-work-sections.tsx:400-419`; `page.tsx:15` | Differentiate Done's chrome (no grip, a "last 7 days" subhead / terminal line) so its append-only, time-boxed nature is visible |
| 15 | A debug link sits in the primary title row beside the `<h1>`, and its "My Tasks" wording introduces a competing name for "My Work" | Rams, Ive; Hall (naming) | `page.tsx:195-199` | Move dev-only affordances out of the header (footer/dev toolbar); rename to "Debug: My Work source" |
| 16 | Empty board shows an explanatory paragraph stacked on top of a full row of live-but-empty "0" columns — the same "nothing here" stated twice | Ive | `my-work-sections.tsx:482-500` | Show one composed empty state instead of prose over empty labelled columns |
| 17 | The carry-over prompt asks the user to decide without showing which stories are affected (count only) | Rams | `my-work-sections.tsx:455-457` | List or link the affected titles, or highlight them in Today |
| 18 | Project identity is encoded three times per row — colored left border, chip border tint, and chip label | Ive | `my-work-row.tsx:51-55,85,88` | Keep the left border as the at-a-glance cue and drop the redundant chip border tint |
| 19 | The dragged card is cosmetically tilted (`rotate-1`) — a decorative flourish carrying no information | Ive | `my-work-sections.tsx:506` | Remove the rotation; convey "lifted" with elevation/shadow alone |
| 20 | Card-to-card gap is inconsistent between columns — Today/free use `gap-2`, Todo/Done groups use `gap-1.5`; `gap-1.5` also breaks board parity | Au | `my-work-sections.tsx:135,386,407` | Make the Todo/Done group gaps `gap-2` to match FlatColumn and the real board |
| 21 | The two text inputs in the manage panel are built differently and have diverged — rename is a raw `<input>` (no focus ring), add uses `<Input>` | Au | `my-work-column-manager.tsx:60,148-153` | Render the rename editor with the `<Input>` component |
| 22 | The rename field's corner radius flips between saved (`rounded`) and editing (`rounded-md`) states and bypasses the `radius-*` tokens | Au | `my-work-column-manager.tsx:34,60` | Use one `radius-*` token on both states |
| 23 | The completion marker uses a raw Tailwind green instead of a semantic token, sitting outside the palette | Au | `my-work-row.tsx:59` | Route the done/success color through a semantic token (add a `success` token if none exists) |
| 24 | Sibling row chips are truncated against unrelated max-widths (project chip `max-w-28` vs state badge `max-w-24 sm:max-w-32`) | Au | `my-work-row.tsx:85,90` | Pick one max-width scale for row chips |

## Low Impact (single expert / edge case) — deferred

| # | Issue | Expert | Location |
|---|-------|--------|----------|
| 25 | Column-reorder save shows no in-progress feedback (`startColumnReorder` pending flag discarded) | Nielsen | `my-work-sections.tsx:208,311-317` |
| 26 | `GripVertical` signifies up/down but the drag moves the column left/right — the signifier contradicts the mapping | Norman | `my-work-sections.tsx:116` |
| 27 | The only sentence explaining what the board *is* renders only when totally empty — a user with one item never sees it | Krug | `my-work-sections.tsx:482-487` |
| 28 | "Manage columns" is muted text with no chrome — it reads as a caption, not a clickable control | Krug | `my-work-column-manager.tsx:122-128` |
| 29 | Fixed 288px (`w-72`) columns overflow a 360px viewport — one column shows, no peek/snap/scroll cue that others exist | Wroblewski | `my-work-sections.tsx:104,489-500`; `page.tsx:189` |
| 30 | Dragging a card to an off-screen column on touch is impractical (auto-scroll collides with page scroll) with no non-drag path | Wroblewski | `my-work-sections.tsx:279-369,490` |
| 31 | Systemic sub-44px touch targets across grip, delete-X, carry-over buttons, quick-add trigger, and rows | Wroblewski | `my-work-sections.tsx:107,460-475`; `my-work-column-manager.tsx:72-88`; `my-work-row.tsx:52` |
| 32 | No sticky/fixed column header below `lg` — the header (title, count, grip) scrolls away in a long column | Wroblewski | `kanban-columns-board.tsx:232` (shared height const); `my-work-sections.tsx:106-120` |
| 33 | The primary create action is an unlabeled 28px "+" icon with no visible text | Wroblewski | `my-work-quick-add.tsx:33` → `draft-story-card.tsx:15` |
| 34 | Carry-over controls are cramped on narrow screens and the "Not today" ghost button reads as non-interactive | Wroblewski | `my-work-sections.tsx:454-476` |
| 35 | Subject–verb disagreement: "1 item **were** marked Today on an earlier day." | Hall | `my-work-sections.tsx:456` |
| 36 | "Today" used as a bare word in prose collides with "Todo"; the two key columns share a stem and sit adjacent | Hall | `my-work-sections.tsx:456,380,493` |
| 37 | Generic dead-end error copy ("Failed to save") and raw server strings rendered verbatim in the banner | Hall | `my-work-column-manager.tsx:20`; `my-work-sections.tsx:441` |
| 38 | The manage-panel toggle switches nouns on itself: "Manage columns" closed vs "Hide column settings" open | Hall | `my-work-column-manager.tsx:127` |
| 39 | Empty-state prose is vague about the planning mechanism and uses the em-dash the owner dislikes | Hall | `my-work-sections.tsx:483-486` |
| 40 | The "Unknown project" fallback chip reads as an error rather than "a project you've left" | Hall | `page.tsx:181` |
| 41 | The Done marker's hover `title` ("Logged as done {date}") and its `aria-label` ("Completion log entry") describe it with different vocabularies | Hall, Levey | `my-work-row.tsx:57-64` |
| 42 | The carry-over prompt is a plain `<div>` — no role/live-region/heading and focus is never moved to it | Levey | `my-work-sections.tsx:449-480` |
| 43 | The card drag wrapper is `role="button"` (dnd-kit) wrapping the story `<Link>` — invalid nesting and a double tab stop per card | Levey | `sortable-item.tsx:12-24`; `my-work-row.tsx:65` |
| 44 | The "Manage columns" disclosure lacks `aria-expanded` / `aria-controls` | Levey | `my-work-column-manager.tsx:122-128` |
| 45 | Drag reorders emit only dnd-kit's generic default announcements — no source/target column or new position | Levey | `my-work-sections.tsx:422-438` |
| 46 | Small muted metadata (counts, group headers, toggle) may miss 4.5:1 contrast at `text-xs`; verify in both themes | Levey | `my-work-sections.tsx:119,385,406` |

## Expert consensus (themes raised by 5+ experts)

1. **Mobile/narrow-width degradation** — the cross-project row collapses to an unlabeled color stripe, fixed columns overflow the viewport, and targets shrink below the hit-target bar exactly where triage happens (6).
2. **The create path and its explanation misfire** — the quick-add and the empty-state guidance that names it are absent or point at nothing for zero/multiple personal projects (6).
3. **"Columns" is fragmented** — one object edited in two disconnected surfaces, with reordering discoverable only through a bare, hint-less grip (6).
4. **The carry-over prompt is unclear and unrecoverable** — an ambiguous "Not today", no undo, an all-or-nothing choice, and hand-rolled off-spec controls (9).
5. **Personal and team stories look identical but obey different rules** — the drag-to-Done that completes a personal story is rejected for a team one, with nothing on the card to predict it (5).

## Conflicts & owner-decision items

- **My Work is NOT a tracker-mode board.** Per `spec/screens.md:373` and doc-15 it is a *purely personal* view with no project-board mapping, so the CLAUDE.md "check original Pivotal Tracker behavior (Wayback)" parity rule does **not** apply here — these fixes can be decided on their own UX merits without a parity check.
- **The Done/duplicate marker (#12 vs Ive)**: Norman and Krug want to *strengthen* the Done-entry treatment so the live+done duplicate reads as history; Ive argues the per-row check is redundant in a column already titled "Done" and should be *removed* (kept only for the genuinely ambiguous cross-column case). Opposite directions on the same marker — owner call. Note the marker itself is a deliberate `spec/ux-principles.md #9` choice, so the question is its strength/placement, not its existence.
- **The column grip (#7 vs Ive)**: Nielsen/Krug/Garrett/Rams want the grip *more* visible/discoverable; Ive wants it hidden until header hover as resting-state noise. Wroblewski's touch finding argues against hover-reveal (no hover on touch). Owner call.
- **Quick-add gating (#4)**: suppressing the trigger for zero/multiple personal projects is an intentional spec decision (`screens.md:434-438`, doc-8 §10). The fix is to *explain/soften* the absence, not to change the gating — flagged so it isn't read as "the spec is wrong."
- **Done behavior (#10, #14)**: the 7-day window, append-only log, and team-story→Done rejection are spec'd (`screens.md:386-419`). The findings ask to make that behavior *legible*, not to change it.
- **Two competing grids (Ive)**: Ive faults the centered `max-w-3xl` header/panel floating over a full-bleed board; Au explicitly reviewed the same thing and lists the `max-w-3xl`/full-width split as *a spec'd decision*, not a bug. Excluded from fixes unless the owner reopens the layout decision.
- **Mobile column width (#29 vs board parity)**: Au explicitly did **not** flag `w-72` / overlay `w-64` / `min-h-10` because they match the project board exactly (board parity); Wroblewski's proposed `85vw` mobile columns would diverge from that parity. Owner call on whether the mobile fix is a conscious divergence.

## Method note

Each expert reviewed independently against their own published principles (Rams' ten, Ive's reduction/honesty, Norman's affordances/gulfs, Nielsen's ten heuristics, Wroblewski's mobile-first, Krug's Trunk Test, Au's type/spacing systems, Garrett's Five Planes, Hall's content strategy, Levey's WCAG), blind to the others' findings. Issues flagged by several experts independently carry the most weight; single-expert Lows are candidates, not mandates. Levey separately confirmed the keyboard drag path and heading hierarchy are already correct, so those are not re-raised here.
