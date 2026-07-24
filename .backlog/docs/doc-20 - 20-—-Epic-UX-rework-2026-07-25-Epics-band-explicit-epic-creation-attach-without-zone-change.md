---
id: doc-20
title: >-
  20 — Epic UX rework 2026-07-25: Epics band, explicit epic creation, attach
  without zone change
type: specification
created_date: '2026-07-24 18:07'
updated_date: '2026-07-24 18:08'
---
# 20 — Epic UX rework 2026-07-25: Epics band, explicit epic creation, attach without zone change

Supersedes **doc-18 §1 (surfacing half), §4 (`is_container` lifecycle), §9
(surfaces)**. doc-18's data model — an epic is a story with children, grouped by
`parent_id`, single-level, off the board — stays intact. What changes is where a
container is *shown* and how one comes into existence.

Advisor verdict on this design: **修正付き承認** (fable-advisor, 2026-07-25). The
four corrections it required are folded into §2, §3, §7, and §8 below.

## §0 The four defects this fixes (owner report, 2026-07-25)

1. **No top-down epic creation.** The only entry points are "Split an oversized
   story" and the child's Parent picker. A container exists only as a
   consequence of a child pointing at it, so "I know this one is big — file it
   as an epic first" cannot be expressed.
2. **Containerizing drops the story into the Icebox.** doc-18 §4 NULLs
   `state_id`, and List renders containers inside the Icebox column. The Icebox
   means "not touching this now"; epics under active planning do not belong
   there.
3. **An epic's contents disappear as they get scheduled.** The Icebox accordion
   expands only the container's *Icebox* children, so a child that moves to
   Current/Backlog leaves the epic's visible contents.
4. **`/epics` shows no children and no progress per epic.** It links to a plain
   story detail, which has no children section.

## §1 Tracker parity (Wayback, recorded per spec/ux-principles.md)

Sources: `organizing_with_epics`, `tracking_big_features_themes_with_epics`
(fetched 2026-07-25 via `web.archive.org/web/2024id_/`).

- Epics live in **their own panel**; they never appear in the Backlog or Icebox
  panels, and they are **ordered independently** of stories.
- Creation is top-down: **"+ Add Epic"** at the top of the Epics panel. An epic
  carries title, description, comments, attachments — like a story.
- The progress bar (or the arrow beside it) **reveals all of the epic's
  stories**, regardless of where they sit.
- An existing story joins an epic by being **dragged onto the epic**; that
  applies the epic label and **does not move the story**.

Storylane keeps the container-is-a-story model (labels stay orthogonal — no
"epic label"), but adopts all four behaviours above.

## §2 Data model: `epic_pinned` (advisor correction 1)

**`is_container` stays derived. The `derive_is_container` trigger is not
relaxed.** It exists because TASK-182's rls-security-reviewer pass found that a
member could send `is_container = false, points = 5` and un-containerize a row,
defeating the off-board CHECK and the `set_story_state` guard. Loosening it to
let the app write the flag would reopen exactly that hole.

Instead, the *intent* to remain an epic with zero children gets its own column:

```sql
alter table stories add column epic_pinned boolean not null default false;
```

- `is_container` becomes `has_children OR epic_pinned`, still computed by the
  trigger on every INSERT/UPDATE, still never written by clients.
- The off-board CHECK (`NOT is_container OR (points IS NULL AND state_id IS NULL
  AND iteration_id IS NULL)`) is unchanged and now also covers pinned-but-
  childless epics.
- The `false → true` flip keeps clearing `points`/`state_id`/`iteration_id` and
  logging the old points to `activity_logs` (doc-18 §4).

`epic_pinned` is written **only** through two new SECURITY DEFINER RPCs
(owner + member, `require_project_role`, explicit grant — decision-1 and
spec/rls.md's "no direct client write to container flags"):

- **`create_epic(project_id, title, ...)`** — inserts a childless story with
  `epic_pinned = true` (the `+ Add Epic` path), and the "make this big story an
  epic" path for an existing story.
- **`unpin_epic(story_id)`** — clears `epic_pinned`; rejects while the story
  still has children (`is_container` would stay true anyway). A story that
  loses its last child while unpinned reverts to a plain story exactly as
  today.

This migration touches TASK-182's remediation surface, so it takes an
`rls-security-reviewer` pass in addition to `/code-review high`.

## §3 List view: the Epics band

- A collapsible **Epics** section at the top of the List view; collapse state
  persists in localStorage like the existing groups.
- Epic row: `epic_color` chip, `#number title`, roll-up progress bar (doc-18 §5,
  existing `EpicProgressBar`), `5/8 pt`, drag-reorderable among epics (the
  TASK-188 logic, moved out of the Icebox block).
- Expanding shows **every child regardless of zone**, ordered by `position`, as
  a deliberately lighter row: a location dot + `#number title` + points. The dot
  encodes Current / Backlog / Icebox / Done; hover reveals the precise location
  (`Backlog #3`).
- **Container rows leave the Icebox column entirely.** The Icebox returns to
  meaning only "stories nobody is touching yet".
- `[+]` creates an epic (`create_epic`) and lands expanded on it
  (ux-principles §10). An empty epic renders "no stories yet / add one".

**Mirror-row requirements (advisor correction 2).** A child appears twice: as a
light row in the band and as its real row in its zone. Therefore:

- Band child rows are **not drag sources in v1 and must not render a drag
  handle** — a control that looks grabbable but refuses the drag violates
  ux-principles §1.
- Whether done/rejected children stay distinguishable from active ones by dot
  colour alone is re-checked in the post-implementation design review.

## §4 List view: two-line story rows

The single-line row already overflows (type icon, number, title, state, points,
epic, labels, assignee, transition buttons) — the epic chip is `hidden
sm:inline` and vanishes on narrow widths, which is defect 3 in miniature.

- A story that belongs to an epic gets a **left vertical rule in `epic_color`**,
  so a run of siblings reads as one group while scrolling.
- Line 1: type icon / `#number` / title / transition buttons.
- Line 2: epic name (never hidden by width) / state badge / points / labels /
  assignee.
- A story with no epic keeps no rule; its second line carries the same metadata.

## §5 Attach = parent only

Dropping a story onto an epic row sets `parent_id` **and nothing else** —
`state_id`, `iteration_id`, and `position` are untouched, matching Tracker's
"drag onto the epic, the story does not move".

- TASK-187's "dropping into a container's Icebox nest moves the story to the
  Icebox" behaviour is **retired**, along with the Icebox-crossing gate it
  needed.
- Detaching is a row-menu action ("remove from epic") or Parent = None in the
  detail — not a drag, in v1.
- Single-level nesting (doc-18 §3) is unchanged.
- Stories that were already moved to the Icebox by the retired behaviour are
  **not** retroactively restored.

## §6 Epic surfaces

- **`/epics`** becomes two panes: epic list (with roll-up progress) on the left,
  the selected epic's children on the right. Clicking a child opens the existing
  `StoryPeek` (the same component and `peekStoryId` URL parameter the board and
  My Work already use) for description, tasks, and comments.
- **Story detail** of a container gains a **Child stories** section: roll-up
  progress bar, child rows with their location, and "add a child".
- The band, `/epics`, and the detail section share one child-row component.

Not in scope: Tracker's hover-for-projected-completion-date on the progress bar
(depends on velocity projection; revisit separately).

## §7 What survives from TASK-186/187/188 (advisor correction 3)

| Asset | Fate |
|---|---|
| `derive_is_container` trigger, off-board CHECK, `set_story_state` guard | **Survives** — §2 builds on it |
| TASK-188's finding: a container shares the single dense `position` sequence with flat rows; no second scope needed | **Survives** — the band reorders in that same space |
| `move_story_board`'s `parent_id` delta + advisory lock + staleness snapshot (`20260724153129`) | **Survives**, but the caller stops sending state/iteration changes with it |
| Container-row reorder logic (TASK-188, `CONTAINER_ROWS_ZONE_ID`, `isDisallowedContainerRowDrop`) | **Moves** from the Icebox block to the Epics band |
| `EpicAccordionRow` / `ContainerAccordionRow` Icebox-only rendering, `epic:<id>` zone keys | **Replaced** by the band's rows |
| Icebox-crossing attach gate (`isAllowedEpicNestDrop` and its callers in `evaluateListDrop`) | **Deleted** — attach no longer crosses zones |
| `kanban.test.ts` / `move-story-board.integration.test.ts` assertions asserting attach-crosses-into-Icebox | **Replaced**, not extended |
| spec/screens.md "Container accordion" section, spec/features.md Move/Copy container note, spec/data-model.md `is_container` comment | **Rewritten** against this doc |

TASK-188 finishes and is committed in its current shape first; §3 ports it.

## §8 Phases (advisor correction 4: creation RPCs belong to the DB phase)

1. **DB** — `epic_pinned`, derived `is_container = has_children OR epic_pinned`,
   `create_epic` / `unpin_epic` RPCs, attach contract (parent only) frozen here.
   `rls-security-reviewer` + `/code-review high`.
2. **Epics band** — render, expand-all-children, remove containers from Icebox,
   `+ Add Epic` calling the phase-1 RPC.
3. **Two-line rows** — epic colour rule, always-visible epic name.
4. **Attach D&D** — drop-on-epic = parent only, delete the Icebox-crossing gate,
   port container-row reordering into the band. Depends on phase 1's contract.
5. **`/epics` two panes + StoryPeek + detail's Child stories section.**
6. **Spec revision** — screens.md, features.md, data-model.md per §7.
