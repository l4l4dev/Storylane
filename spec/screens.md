← [SPEC.md](../SPEC.md)

## Screen Structure

### Web (Next.js)

```
/                         Login / top page
/auth/login               Login (OAuth)
/dashboard                Projects page (see "Projects page" below)
/settings                 Account settings (2026-07-07): username and display name
                          editing — the only place profile identity is edited.
                          Reached from the sidebar account menu and the
                          Projects page header
/projects/[id]            Redirects to the board (see below) — the board is the project's home view
/projects/[id]/board      Board (List / Kanban / Focus view, toggled in place — see "Board layout" below)
/projects/[id]/epics      Epic list
/projects/[id]/iterations Iteration history (past/done iterations with velocity and their stories)
/projects/[id]/activity   Project activity log (read-only feed of recent story/comment changes)
/projects/[id]/settings   Project settings (members, integrations, point scale, etc.)
/stories/[id]             Story detail (standalone deep-link page; primary editing happens
                          in the board's side peek — see "Board layout" below)
```

### Projects page (`/dashboard`) — redesigned 2026-07-07

Shares the project pages' design language (same tokens, card styles, and
type scale as the board/side-peek UI) so the app reads as one product. The
UsernameEditor is removed from this page (moved to `/settings`).

- **Inline creation — no overlay.** "New project" expands an inline
  creation panel at the top of the page (the card grid pushes down); no
  dialog, no route change. The panel gathers everything a project needs up
  front:
  - name, description;
  - **mode selection as comparison cards** — two side-by-side cards
    (**Tracker**: "Fixed story states, iterations, and velocity" /
    **Free**: "Trello-style board with your own columns — no iterations")
    so the difference is visible at a glance, not radio buttons;
  - Tracker settings: iteration length (7/14/21/28 days), point scale
    (+ custom points), velocity window;
  - Free settings: column template (**Daily**: Todo / Today / In progress /
    Done, Done seeded `is_done` / **Basic**: To do / Doing / Done);
  - initial member invites via an exact-match username picker (optional,
    addable later) — deliberately not the fuzzy search-as-you-type picker
    used in project settings, since that RPC requires an existing
    project_id to stay owner-gated; searching before a project exists can
    only safely support confirm/deny-one-exact-username, not fuzzy
    enumeration (see TASK-6's rls-security-reviewer finding).
- **Project cards** show: name, mode badge (Tracker / Free), a
  mode-specific summary line (Tracker: current iteration number and
  velocity; Free: column count and open-card count), member avatars
  (overlapping initials/OAuth avatars, capped with a "+N"), and
  last-updated time.
- **Favorites:** a pin toggle on each card (`project_members.is_favorite`);
  pinned projects sort first here and in the sidebar project switcher.
- **Search & sort:** a search box (name match) and a sort select — last
  updated (default) / name / created.
- **Archive:** owner-only action in the card's overflow menu (confirmation
  required). Archived projects are hidden by default behind an "Archived"
  filter toggle; unarchive restores them. Read-only enforcement is scoped
  to the Move/Copy story RPCs (reject an archived source/target) and this
  UI's own display/archive-control gating — there is no DB-level lock
  across every write-capable table (see spec/rls.md); full enforcement is
  follow-up work.

### Navigation (Web) — updated 2026-07-06

A fixed left sidebar (multica/Linear style) replaces the former top header tabs.
It is rendered once by the project layout and contains, top to bottom: the
Storylane brand (links to `/dashboard`), the project switcher, the section nav
(**Board / Epics / Iterations / Activity / Settings**, active item highlighted),
and at the bottom the theme toggle and the account menu (sign out, link to
`/settings`). Pages outside a project (dashboard, login) keep their own
minimal headers.

**Project switcher (polished 2026-07-07):** the switcher must read as a
control, not a label — chevron affordance on the trigger. The dropdown
lists favorites first (pin icon), shows each project's mode badge, and
excludes archived projects; "All projects" links to `/dashboard`.

### Board layout (Web) — updated 2026-07-07: List / Kanban / Focus views, Free mode

`/projects/[id]/board` branches on `projects.workflow_mode` (Task 14, fixed
at project creation — see spec/data-model.md): **tracker** renders the
List/Kanban/Focus board described below; **free** renders the separate
DB-driven board described in "Free mode board" further down. The rest of
this section (view toggle, iteration bar, Icebox) applies to
**tracker mode only**.

The board toolbar has a **List / Kanban / Focus** toggle (**List is the
default**). All views read and write the same stories — the toggle only
changes how they're grouped and dragged; there is no separate route or
server state per view. Display comes first in all of them: every board
interaction happens in place — no page navigation and no blocking modals.
Shared chrome above whichever view is active, split into two rows
(2026-07-13, TASK-45 — replaces the earlier single wrapping row that
crowded iteration info against the view controls and put an irreversible
action at the visual center):

- **Info row** (only when a current iteration exists): iteration number
  (bolder, for hierarchy), a "Current" badge, date range, committed
  points, **"auto-finishes on <end_date>"**, and the iteration goal.
  The goal (spec/ux-principles.md principle 5) renders as **text** — the
  saved goal, or italic **"Add goal…"** ghost text when empty — with a
  pencil affordance on hover; clicking opens an inline input. **Enter** or
  **blur** commits and returns to text (only on success; a failed save
  keeps the input open with the typed value and an inline error); **Esc**
  discards and returns to text. There is no separate "Saved" flash —
  returning to text view is the success feedback.
- **Controls row**: the **List / Kanban / Focus** toggle (**List is the
  default**; all views read/write the same stories, the toggle only
  changes grouping/dragging), the **Icebox toggle** (List view only —
  Backlog/Icebox management lives exclusively there), a single **Filters**
  button (opens a popover with Type/Assignee/Label selects and shows an
  active-count badge, e.g. "Filters · 2" — replaces three always-visible
  selects), and, anchored to this row's right edge, the **Finish
  iteration** button (spec/velocity.md "Manual finish";
  spec/ux-principles.md principle 6 — an irreversible action stays off
  the primary click path, never centered between routine info and
  controls).

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
- **Backlog groups (2026-07-07, replaces boundary markers):** the Backlog
  renders as a stack of **collapsible virtual-iteration groups** — the
  Pivotal-style accordion. Each group has a **header above its stories**:
  a collapse triangle (▸/▾), "Iteration #N", projected dates (computed
  from the current iteration's `end_date` + `iteration_length`), an
  inline-editable goal (`iteration_goals`, a compact always-visible input
  that commits on Enter — unlike the current iteration's own goal above,
  which is click-to-edit text, see "Board layout" above), and the group's
  point sum. The current-iteration
  section header gets the same collapse triangle. This fixes the old
  confusion where the first backlog group had no label and an inserted
  break appeared to skip a number: **every group shows its own number**,
  starting at current + 1 (see spec/velocity.md "Virtual-group
  computation"). Collapse state persists per user in localStorage.
  Within the groups, rows interleave in one flat sortable list (see
  `lib/utils/iterations.ts` "buildBacklogRows"):
  - stories, in priority order;
  - user-created rows from `backlog_dividers` (spec/data-model.md): a
    **note** (dashed labeled row, cosmetic grouping, draggable/deletable
    like a story) or a **manual iteration break**, which forces the group
    to close at that exact spot regardless of remaining capacity.
  - **Manual break lifecycle (2026-07-11, supersedes "stays draggable and
    deletable" above — TASK-43):** a break never renders as its own row.
    The group header it forces the boundary of instead carries a small
    removable **"manual ×"** badge next to its number — clicking × deletes
    the break and lets automatic capacity-based splitting decide that spot
    again. This replaces the original design (the break stayed visible as
    a permanent, separately-draggable "Iteration break" row) because every
    break ever placed kept its row forever with no way to feel resolved:
    the raw row was redundant clutter once the numbered header beside it
    already announced the same boundary, and it piled up one such row per
    break across the whole Backlog. A break is no longer independently
    draggable to a new spot — delete it via its header badge and re-insert
    at the new spot instead (still exact, via the insert-between
    affordance below).
- **Indent distinction (2026-07-07):** note labels start flush at the
  list's left edge and span full width; story rows are indented slightly
  to the right, so structure rows and work rows are distinguishable at a
  glance.
- **Row insert menu (2026-07-12, primary path — TASK-42):** every Backlog
  story/note row carries a "…" menu with **Insert note above/below** and
  **Insert iteration break above/below** — no hover precision needed. Note
  items open a small label dialog; iteration-break items insert immediately.
  Not shown on Current/Icebox rows (notes/breaks are Backlog-only).
- **Insert-between hover line (secondary shortcut):** hovering the gap
  between any two backlog rows reveals a hairline with **+ Note** / **+
  Iteration break** buttons — clicking inserts at that exact spot (+ Note
  opens an inline label input). The visible gap stays a thin line (no
  layout shift when it appears), but the hoverable band is taller than the
  line itself so the pointer doesn't have to land on an 8px sliver. No
  append-then-drag needed either way.
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
- **Quick-add sits at each group's bottom edge (2026-07-11):** every
  List-view group — Current, each virtual future-iteration group inside
  Backlog (even an empty one), and Icebox — gets its own full-width dashed
  "+ Add story" button after that group's last row, not the section
  header, so where a new story will land is never ambiguous. A story added
  from a specific virtual-iteration group's composer inserts at that exact
  group's bottom, not just the end of the whole Backlog. A group's
  composer is hidden while that group is collapsed (its rows aren't visible
  either). Composer behavior: see "Quick-add composer" below.
- The side peek works the same as Kanban.

### Quick-add composer (2026-07-07, revised 2026-07-11 — all boards)

The old composer morphed the "+ Add story" button itself into an input,
which felt broken. Current behavior (Trello/Linear convention), shared by
the List-view groups, the Kanban Unstarted column, and free-mode columns:

- The "+ Add story" trigger stays visible where it is; clicking it reveals
  a **separate card-shaped composer** beneath it: a title input, an
  explicit **Add** button, and a hint "Esc to close".
- Enter also submits (same as clicking Add): creates the story (same
  defaults as before: type `feature`, unestimated, unassigned) and keeps
  the composer open with an empty input for consecutive adds; Esc or
  clicking outside closes it, discarding the draft. An empty submit does
  nothing.
- The trigger itself never changes shape or turns into an input.
- A failed create keeps the typed title and shows an inline error,
  offering retry (press Enter or Add again).

### Story detail editing — autosave (2026-07-07)

Applies to the side peek and `/stories/[id]`; there are no Save buttons.

- **Text fields** (title, description): autosave after the user stops
  typing (~800 ms debounce) and on blur. Esc reverts the field to its last
  saved value.
- **Discrete fields** (type, points, assignee, epic, labels, free-mode
  status): save immediately on change, as most already do.
- A small **"Saving… / Saved ✓"** indicator in the peek header reflects
  in-flight state; a failed save keeps the local value, shows an error,
  and offers retry. Realtime updates from other users must not clobber a
  field the user is actively editing.

Conflict & failure rules (2026-07-08):

- Saves are **serialized per story**: at most one in-flight save; edits
  arriving during flight mark the story dirty and trigger one trailing
  save when it returns. Full field values are sent (no diffs), so the
  last applied save wins deterministically even if requests raced.
- **Field-level lock**: a text field is *locked* while focused or dirty.
  Remote (Realtime) updates apply immediately to unlocked fields; for a
  locked field the local value stays and the next save overwrites —
  last-write-wins per field, no merging (Phase 1, accepted trade-off).
  The self-echo of your own save must be ignored.
- An **empty title is never saved** (`title` is NOT NULL): inline
  validation while typing, revert to last-saved on blur.
- Pending debounced edits **flush on blur, on peek close, and on route
  change** — closing the peek never discards typed text. "Last saved
  value" (the Esc target) means the last server-acknowledged value.
- If the story was **deleted remotely**, the failed save switches the
  peek to a "story was deleted" state that keeps the unsaved text visible
  and copyable instead of silently closing.
- Autosave must not spam collaboration surfaces: the activity-log
  trigger records state/assignment events — title/description edits must
  not produce a row per save — and Slack notifications stay
  state-change-only. Verify this against the existing trigger before
  shipping.
- The overflow (⋯) menu in the peek header hosts **Promote to Epic** and
  **Move / Copy to another project** (behavior in spec/features.md
  "Story Management"), alongside Delete.

#### Focus view (tracker mode, added 2026-07-07; Today-first since 2026-07-17)

A personal, Today-first execution view over the **current iteration's
stories** — the third option in the view toggle. Columns:

- **Todo** — current-iteration stories with `focus IS NULL`, not yet
  started;
- **Today** — stories with `stories.focus = 'today'` (spec/data-model.md);
  dragging between Todo / Today sets or clears `focus` and never touches
  state;
- **In progress** — stories in `started` / `finished` / `delivered` /
  `rejected` (state badge shown on the card; `rejected` groups here rather
  than getting its own column since it still needs action — the Restart
  transition — same as Kanban view's Rejected→Started, TASK-15 decision
  2026-07-09);
- **Done** — `accepted` stories, read-only, grouped under date headers
  (Today / Yesterday / date) by `completed_at`, so *when* something was
  finished is visible.

State changes in this view use the **on-card one-click transition
buttons** (same rules as the List view) — the In progress and Done columns
are not drop targets, keeping the state machine intact. Quick-add and the
side peek work the same as the other views. `focus` values persist until
changed (they survive rollover on carried-over stories).

TASK-34 (2026-07-17): the view previously had a third draggable column,
**This week**, dropped to keep the view centered on *today* rather than the
week — the user's actual ask. `stories.focus` no longer accepts
`'this_week'` (CHECK constraint narrowed to `'today'` only,
`20260717000002_focus_drop_this_week.sql`); any story that was in This week
fell back to Todo (`focus` set to `NULL`).

#### Free mode board (Task 14, added 2026-07-07)

A pure Trello-style board for `workflow_mode = 'free'` projects — no
iteration bar, no Icebox, no view toggle, no auto-rollover, no
velocity. `ensureCurrentIteration` never runs for these projects.

- **Columns are `custom_statuses` rows** (project-scoped, managed in
  Settings — see below), ordered by `position`. A story with no
  `custom_status_id` (or one that no longer exists) renders in the
  leftmost column.
- **Any-to-any drag:** dropping a card on any column moves it there —
  forward, backward, or skipping columns, unlike tracker's state machine.
  Dragging within a column reorders.
- **Per-column quick-add:** each column has its own `+` composer (same
  inline create-on-Enter UX as tracker's Unstarted composer).
- **Points** are shown as a badge and freely editable, but never feed a
  velocity calculation (there is none in this mode).
- **Side peek** works the same as tracker mode, except the story detail
  shows a **Status select** (the project's custom statuses) instead of
  one-click state transition buttons.
- The left sidebar hides the **Iterations** nav item for free projects.

KanbanFlow parity additions (2026-07-07 — see spec/features.md "Free
Mode" and spec/data-model.md for schema):

- **Column templates** at project creation seed the board (KanbanFlow /
  Basic — see "Projects page" above).
- **Done dates:** cards in `is_done` columns show `completed_at` and the
  column groups its cards under date headers (Today / Yesterday / date),
  newest first.
- **WIP limits:** a column with `wip_limit` set shows "count / limit" in
  its header; when count exceeds the limit the header turns
  warning-colored. Soft limit — drops are never blocked. Configured from
  the column header menu.
- **Swimlanes:** when the project has `swimlanes` rows, the board splits
  into horizontal lanes (lane name on the left) × the same columns, plus a
  "No lane" band for unassigned stories, shown **first** (above the named
  lanes) so cards created via a column's quick-add — which always start
  with `swimlane_id = NULL` — never land buried under existing lanes;
  dragging a card across bands sets `swimlane_id`. Managed in Settings
  alongside custom statuses.
- **Recurring stories:** managed in a Settings section (free projects
  only): title, description, target column/lane, cadence
  (daily / weekly + weekday / monthly + day), active toggle. Instances are
  generated lazily on board access (see spec/data-model.md
  `recurring_stories`).

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
