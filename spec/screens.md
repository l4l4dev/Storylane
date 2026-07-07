← [SPEC.md](../SPEC.md)

## Screen Structure

### Web (Next.js)

```
/                         Login / top page
/auth/login               Login (OAuth)
/dashboard                Project list
/projects/[id]            Redirects to the board (see below) — the board is the project's home view
/projects/[id]/board      Board (Kanban or List view, toggled in place — see "Board layout" below)
/projects/[id]/epics      Epic list
/projects/[id]/iterations Iteration history (past/done iterations with velocity and their stories)
/projects/[id]/activity   Project activity log (read-only feed of recent story/comment changes)
/projects/[id]/settings   Project settings (members, integrations, point scale, etc.)
/stories/[id]             Story detail (standalone deep-link page; primary editing happens
                          in the board's side peek — see "Board layout" below)
```

### Navigation (Web) — updated 2026-07-06

A fixed left sidebar (multica/Linear style) replaces the former top header tabs.
It is rendered once by the project layout and contains, top to bottom: the
Storylane brand (links to `/dashboard`), the project switcher, the section nav
(**Board / Epics / Iterations / Activity / Settings**, active item highlighted),
and at the bottom the theme toggle and the account menu (sign out). Pages
outside a project (dashboard, login) keep their own minimal headers.

### Board layout (Web) — updated 2026-07-07: Kanban / List view toggle, Free mode

`/projects/[id]/board` branches on `projects.workflow_mode` (Task 14, fixed
at project creation — see spec/data-model.md): **pivotal** renders the
List/Kanban board described below unchanged; **free** renders the separate
DB-driven board described in "Free mode board" further down. The rest of
this section (List/Kanban toggle, iteration bar, Icebox) applies to
**pivotal mode only**.

The board toolbar has a **List / Kanban** toggle (**List is the default**).
Both views read and write the same stories — the toggle only changes how
they're grouped and dragged; there is no separate route or server state per
view. Display comes first in both: every board interaction happens in
place — no page navigation and no blocking modals. The iteration bar
(current iteration number, date range, inline-editable sprint goal,
committed points) and the filters toolbar are shared chrome above whichever
view is active. The **Icebox toggle** appears in the toolbar in List view
only — Backlog/Icebox management lives exclusively in the List view.

#### Kanban view (multica/Linear style; current iteration only)

A kanban whose columns are the **current iteration's story states** — a
focused execution view; backlog prioritization happens in the List view.

- Columns, left to right: **Unstarted** / **Started** / **Finished** /
  **Delivered** / **Accepted**, plus a **Rejected** column that appears only
  while the current iteration has rejected stories. Each column header shows
  a state icon, the story count, and the column's point sum. No Backlog or
  Icebox columns.
- Past (done) iterations are not on the board — they live on
  `/projects/[id]/iterations`.
- **Drag = state transition.** Dropping a card on a column performs that
  transition. Only the valid next transition(s) are accepted (see
  spec/features.md); invalid targets reject the drop and the card snaps back.
  - Rejected → Started is the `Restart` transition.
  - An unestimated `feature` cannot be dropped on Started.
  - Dragging within a column reorders (position).
- **Inline quick-add:** the Unstarted column has a `+` composer pinned to
  the column — type a title, press Enter to create (defaults: type
  `feature`, unestimated, unassigned), and the composer stays open for
  consecutive adds; Esc closes it. Every other field is edited afterwards in
  the side peek. No modal, no navigation.
- **Side peek:** clicking a card opens the story detail in a right-hand panel
  overlaying the board's right edge, driven by `?story=<id>` on the board URL
  (shareable/bookmarkable). The board stays visible and interactive; Esc or ✕
  closes the peek. This replaces the former in-card accordion expansion.
  `/stories/[id]` remains the standalone page for deep links.
- Columns have subtle state-tinted backgrounds (e.g. green for Accepted, red
  for Rejected), with dark-mode variants derived from the same tokens.

#### List view (Pivotal Tracker parity, added 2026-07-07; default)

Replaces the physical per-state columns with **one continuous, full-width
list per zone** — Current iteration and Backlog stack vertically, in
priority order, matching the classic Pivotal Tracker backlog rather than a
Trello/Linear-style kanban. State is shown as a badge on the row instead of
a physical column.

- **Zones:** the **current iteration** section (every state — unstarted
  through accepted/rejected — in one flat, priority-ordered list) stacked
  above the **Backlog** section. The **Icebox** (toolbar toggle) renders as
  its own narrow side column to the right — it's a pre-triage parking lot,
  not part of the priority order, so it stays out of the main list to keep
  the PO focused on prioritization.
- **Backlog rows** interleave three things in one flat sortable list (see
  `lib/utils/iterations.ts` "buildBacklogRows"):
  - stories, in priority order;
  - automatic, velocity-based **"Iteration #N" markers** (spec/velocity.md)
    — not stored rows; not draggable or deletable;
  - user-created rows from `backlog_dividers` (spec/data-model.md): a
    **note** (dashed labeled row, cosmetic grouping) or a **manual
    iteration break**, which forces the virtual iteration to close at that
    exact spot regardless of remaining capacity — it renders as the same
    "Iteration #N" line but is draggable and deletable (✕).
- **Insert-between affordance:** hovering the gap between any two backlog
  rows reveals a hairline with **+ Note** / **+ Iteration break** buttons —
  clicking inserts at that exact spot (+ Note opens an inline label input).
  No append-then-drag needed.
- **Drag = reorder,** not state transition. Dragging within a zone only
  changes priority order and never touches state. Crossing a zone boundary
  follows the same scheduling rules as before (only an `unstarted` story can
  cross between Current ⇄ Backlog ⇄ Icebox); a story of any other
  current-iteration state cannot be dragged out of the current zone. Notes
  and manual breaks reorder within the Backlog only.
- **One-click transition buttons** (Start / Finish / Deliver / Accept /
  Reject / Restart) render directly on each row, since there's no column to
  drop onto for a state change — the same buttons and rules as the side
  peek's (see "Story row UX" below).
- **Quick-add is compact:** each section header carries a small "+ Add
  story" text link (opening the same inline composer) instead of a
  full-width story-shaped button, so the list itself stays visually
  dominant.
- The side peek works the same as Kanban.

#### Free mode board (Task 14, added 2026-07-07)

A pure Trello-style board for `workflow_mode = 'free'` projects — no
iteration bar, no Icebox, no List/Kanban toggle, no auto-rollover, no
velocity. `ensureCurrentIteration` never runs for these projects.

- **Columns are `custom_statuses` rows** (project-scoped, managed in
  Settings — see below), ordered by `position`. A story with no
  `custom_status_id` (or one that no longer exists) renders in the
  leftmost column.
- **Any-to-any drag:** dropping a card on any column moves it there —
  forward, backward, or skipping columns, unlike pivotal's state machine.
  Dragging within a column reorders.
- **Per-column quick-add:** each column has its own `+` composer (same
  inline create-on-Enter UX as pivotal's Unstarted composer).
- **Points** are shown as a badge and freely editable, but never feed a
  velocity calculation (there is none in this mode).
- **Side peek** works the same as pivotal, except the story detail shows a
  **Status select** (the project's custom statuses) instead of one-click
  state transition buttons — see "Story detail (Free mode)" below.
- The left sidebar hides the **Iterations** nav item for free projects.

### Story card UX (Kanban view)

- Card contents (multica-style): story-type icon, title, one-line truncated
  description, points badge, label chips, and assignee avatar (initials).
- State transitions happen by dragging between columns or from the side
  peek — there are no transition buttons on the card itself. The side peek
  offers the same next-valid-transition buttons as before (no free-form
  state dropdown).
- The whole card is draggable (no dedicated drag handle).
- Accepted stories render with a green card background.
- `release` stories render as milestone marker rows (flag + horizontal rule)
  in the Backlog/Icebox columns, not as regular cards.
- Point estimates of 3 or less are shown as dots (`•`, `••`, `•••`);
  larger values as numerals.

### Story row UX (List view)

- Row contents: story-type icon, title, a state badge, points badge, label
  chips, assignee avatar (initials), and the one-click transition buttons —
  all on one compact, full-width row (no fixed column width, unlike the
  Kanban card).
- The whole row is draggable (no dedicated drag handle), same convention as
  the Kanban card.
- Accepted stories render with a green row background, same as Kanban.
- `release` stories render as the same milestone marker row as Kanban.
- Points use the same dot/numeral convention as Kanban.

### iOS (SwiftUI)

```
TabView
├── Backlog          BacklogView
├── Iterations       IterationsView
├── Epics            EpicsView
└── Settings         SettingsView

Sub-screens
├── StoryDetailView  Story detail
├── StoryEditView    Create / edit story
└── ProjectListView  Project selection (on launch)
```
