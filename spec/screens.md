← [SPEC.md](../SPEC.md)

## Screen Structure

### Web (Next.js)

```
/                         Login / top page
/auth/login               Login (OAuth)
/dashboard                Projects page (see "Projects page" below)
/my-work                  My Work: cross-project personal view of stories assigned to the
                          signed-in user (see "My Work" below — screen details deliberately
                          not fully specced yet, doc-8 §9)
/settings                 Account settings (2026-07-07): username and display name
                          editing — the only place profile identity is edited.
                          Reached from the sidebar account menu and the
                          Projects page header
/projects/[id]            Redirects to the board (see below) — the board is the project's home view
/projects/[id]/board      Board (List / Kanban view, toggled in place — see "Board layout" below)
/projects/[id]/epics      Epic list
/projects/[id]/iterations Iteration history (past/done iterations with velocity and their stories)
/projects/[id]/activity   Project activity log (read-only feed of recent story/comment changes)
/projects/[id]/settings   Project settings (members, integrations, point scale, etc.)
/stories/[id]             Story detail (standalone deep-link page; primary editing happens
                          in the board's side peek — see "Board layout" below)
```

### Onboarding (doc-8 §4, TASK-93)

A fresh signup lands on **`/my-work`** (TASK-104) with one personal project
already present: **"My Tasks"**, a 1-day-cadence, minimal-template project
owned by the new user (`handle_new_user` trigger). It is flagged
`projects.is_personal = true` (TASK-103, doc-11 D1) and is **hidden from the
owner's own projects list (`/dashboard`) and sidebar switcher** — the owner
works with it through My Work, so personal tasks and team projects don't mix
in the list. Invites are still allowed on it, and it stays a move/copy
target; only the owner's own list hides it (the filter is viewer-scoped,
`is_personal AND created_by = me`, so an *invited* member still sees it).
It exists so a solo user can start working (and `/my-work` isn't empty) with
zero setup; its iterations render date-titled like any 1-day project.

### Projects page (`/dashboard`) — redesigned 2026-07-07

Shares the project pages' design language (same tokens, card styles, and
type scale as the board/side-peek UI) so the app reads as one product. The
UsernameEditor is removed from this page (moved to `/settings`).

- **Inline creation — no overlay.** "New project" expands an inline
  creation panel at the top of the page (the card grid pushes down); no
  dialog, no route change. The panel gathers everything a project needs up
  front:
  - name, description;
  - **state template** (seeds `project_states`, doc-8 §2): **classic**
    (Unstarted / Started / Finished / Delivered / Accepted / Rejected —
    the Pivotal-parity anchor) or **minimal** (Todo / Doing / Done). States
    are freely edited afterwards in Settings;
  - **cadence** (`iteration_length`): 1 day / 1w / 2w / 3w / 4w — a 1-day
    cadence is an ordinary project, not a special mode (doc-8 §4);
  - **display term** for iterations ("Sprint" / "Iteration" / free text,
    doc-8 §5) and **working weekdays** (default Mon–Fri, doc-8 §6);
  - point scale (+ custom points), velocity window;
  - initial member invites via an exact-match username picker (optional,
    addable later) — deliberately not the fuzzy search-as-you-type picker
    used in project settings, since that RPC requires an existing
    project_id to stay owner-gated; searching before a project exists can
    only safely support confirm/deny-one-exact-username, not fuzzy
    enumeration (see TASK-6's rls-security-reviewer finding).
- **Project cards** show: name, a summary line (current iteration number
  and velocity), member avatars (overlapping initials/OAuth avatars, capped
  with a "+N"), and last-updated time.
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

### Navigation (Web) — updated 2026-07-21 (doc-12 Thread B)

A fixed left sidebar (multica/Linear style) replaces the former top header tabs.
It is rendered once by the project layout (and, with no current project, by
the My Work layout — doc-8 §9) and contains, top to bottom: the Storylane
brand (links to `/dashboard`), a **fixed My Work link**, the Projects
switcher, the section nav (**Board / Epics / Iterations / Activity /
Settings**, active item highlighted — omitted outside a project), and at
the bottom the theme toggle and the account menu (sign out, link to
`/settings`). Pages outside a project or My Work (dashboard, login) keep
their own minimal headers.

**My Work link:** always visible (My Work is a cross-project dashboard,
doc-12 Thread A), styled like a section-nav item with an icon, highlighted
via `aria-current="page"` when on `/my-work` — no longer an entry inside
the Projects dropdown.

**Projects switcher (resized 2026-07-21):** the switcher must read as a
control, not a label — chevron affordance on the trigger, trigger button
`size="default"` (grown from `size="sm"` for an easier target). The
trigger shows the current project's name, or "Projects" with no current
project. The dropdown lists favorites first (pin icon) among the projects,
excluding archived ones, then "All projects" (`/dashboard`) and a
**"+ New project"** entry (`/dashboard?new=1`, opens the dashboard's
inline create panel pre-opened) — the switcher is the sole project-creation
entry point; My Work's own page has no New-project button (superseded
TASK-104's).

### Board layout (Web) — List / Kanban views

`/projects/[id]/board` renders the List/Kanban board described below (doc-8
removed free mode and the per-project Focus view; board views reduce to
List / Kanban). The board columns are the project's **`project_states`**
(spec/data-model.md), not a fixed state enum.

The board toolbar has a **List / Kanban** toggle (**List is the
default**). Both views read and write the same stories — the toggle only
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
- **Controls row**: the **List / Kanban** toggle (**List is the
  default**; both views read/write the same stories, the toggle only
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

A kanban whose columns are the project's **`project_states`** in `position`
order (spec/data-model.md) — a focused execution view; backlog
prioritization happens in the List view. With the **classic** template the
columns render identically to the former fixed Kanban
(Unstarted / Started / Finished / Delivered / Accepted, plus Rejected when
present) — the Pivotal-parity anchor.

- Each column header shows the state name, its category styling (e.g. green
  for `done`, red for `rejected`), the story count, and the point sum.
  Rejected-category columns appear only while the current iteration has
  stories in them. No Backlog or Icebox columns.
- Past (done) iterations are not on the board — they live on
  `/projects/[id]/iterations`.
- **Drag = set state.** Dropping a card on a column moves the story to that
  state via `set_story_state` (spec/data-model.md doc-8 §2). The DB allows
  **any → any** state within the project; ordering discipline lives in the
  UI advance button, not in the drop (spec/features.md — this is a
  deliberate divergence from Pivotal's strict step machine).
  - **Advance button / Accept-Reject pair:** each story also carries one
    **advance-to-next-state** button labelled with the next state's
    `action_label` (Start / Finish / Deliver …). On the state immediately
    before a `done` state the advance affordance is the **Accept / Reject
    pair**; a `rejected`-category story shows **Restart** back to the first
    `in_progress` state. This advance/pair/gate computation is a per-client
    pure function in `packages/core`, driven by `project_states` data, with
    golden fixtures shared with iOS.
  - **Estimation gate:** an unestimated `feature` can only sit in Icebox
    (`state_id IS NULL`) or an `unstarted`-category state; a drop into any
    other category is rejected and the card snaps back.
  - Dragging within a column reorders (position).
- **Inline quick-add (TASK-82, Pivotal parity):** the first `unstarted`-
  category column header carries a single small **"+"** trigger. Clicking it
  opens an inline **draft story card** at the top of that column — the full
  field set (title, description, type, points, epic, assignee, labels),
  title the only required one. See "Quick-add: draft story card" below.
- **Side peek:** clicking a card opens the story detail in a right-hand panel
  overlaying the board's right edge, driven by `?story=<id>` on the board URL
  (shareable/bookmarkable). The board stays visible and interactive; Esc or ✕
  closes the peek. This replaces the former in-card accordion expansion.
  `/stories/[id]` remains the standalone page for deep links.
- Columns have subtle category-tinted backgrounds (e.g. green for `done`, red
  for `rejected`), with dark-mode variants derived from the same tokens.

#### List view (Pivotal Tracker parity, added 2026-07-07; default)

Replaces the physical per-state columns with **one continuous, full-width
list per zone** — Current iteration and Backlog stack vertically, in
priority order, matching the classic Pivotal Tracker backlog rather than a
Trello/Linear-style kanban. State is shown as a badge on the row instead of
a physical column.

- **Zones:** the **current iteration** section (every state, across all
  categories, in one flat, priority-ordered list) stacked
  above the **Backlog** section. The **Icebox** (toolbar toggle) renders as
  its own narrow side column to the right — it's a pre-triage parking lot,
  not part of the priority order, so it stays out of the main list to keep
  the PO focused on prioritization.
- **Backlog groups (2026-07-07, replaces boundary markers):** the Backlog
  renders as a stack of **collapsible virtual-iteration groups** — the
  Pivotal-style accordion. Each group has a **header above its stories**:
  a collapse triangle (▸/▾), "Iteration #N", projected dates (walked forward
  from the current iteration by the cadence rule — spec/velocity.md
  "Fixed-cadence sprints"; a 1-day project uses working-day boundaries, not a
  flat `+ iteration_length`), an
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
  follows the same scheduling rules as before (only a story in an
  `unstarted`-category state can cross between Current ⇄ Backlog ⇄ Icebox;
  Icebox = `state_id IS NULL`); a story in an `in_progress`/`done`/`rejected`
  state cannot be dragged out of the current zone. Notes and manual breaks
  reorder within the Backlog only.
- **Advance button / Accept-Reject pair** render directly on each row (same
  computation and rules as the Kanban view above and the side peek), since
  there's no column to drop onto for a state change: one advance-to-next
  button labelled with the next state's `action_label`, the Accept/Reject
  pair on the state before done, and Restart on a rejected story.
- **Quick-add: one "+" per panel header (TASK-82, supersedes the earlier
  per-group bottom-edge composer):** Current, Backlog, and Icebox each carry
  a single small **"+"** trigger in their section header — not one per
  virtual-iteration group. Clicking it opens a draft story card at the very
  top of that panel (Backlog: before the whole backlog's first row,
  regardless of which virtual-iteration group that row belongs to — there is
  no per-group placement anymore). See "Quick-add: draft story card" below.
- The side peek works the same as Kanban.

### Quick-add: draft story card (2026-07-07, reworked 2026-07-20 — TASK-82, Pivotal parity)

> **Parity note (doc-8 §10):** original Pivotal used a single "+ Add Story"
> icon per panel that opens an inline draft story detail card (all fields
> editable, title the only required one, Save / Cmd+S) — not an
> always-visible title-only composer. This replaces the earlier Trello-style
> composer (one dashed "+ Add story" button per group, title-only, Enter to
> create) with that shape.

Shared by every panel that can create a story — Kanban's `unstarted`
column, and List's Current / Backlog / Icebox — via one component
(`StoryFields`, also used by the side peek and `/stories/[id]`, so the two
never fork):

- **Trigger:** a single small "+" icon button in the panel's header (not a
  full-width always-visible bar). Clicking it renders the draft card inline
  at the top of that panel's list, pushing existing rows down rather than
  opening a modal.
- **Fields:** title (required), description, type, points (from the
  project's point scale), epic, assignee, labels — the same field set and
  markup as the side peek, just with local state and an explicit save
  instead of autosave.
- **Save:** the **Save** button or **Cmd/Ctrl+S** creates the story with
  every field in one action, positioned at the top of the panel that opened
  it (the same move/reposition path a drag uses — never a hand-picked
  position). The card closes on success; it does **not** reopen for
  consecutive adds (Pivotal parity).
- **Discard:** **Esc** or a click outside the card discards it silently —
  no confirmation, nothing is created. Escape during an IME composition is
  ignored (doesn't discard mid-conversion).
- **Failure:** a failed save keeps the card open with the typed fields
  intact and shows an inline error; the user edits and saves again.

### Story detail editing — autosave (2026-07-07)

Applies to the side peek and `/stories/[id]`; there are no Save buttons.

- **Text fields** (title, description): autosave after the user stops
  typing (~800 ms debounce) and on blur. Esc reverts the field to its last
  saved value.
- **Discrete fields** (type, points, assignee, epic, labels): save
  immediately on change, as most already do. State changes go through the
  advance button / Accept-Reject pair (`set_story_state`), not a free-form
  dropdown.
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

### My Work (`/my-work`, replaces the per-project Focus view — doc-8 §9, doc-14, TASK-89/131/132)

A cross-project personal view: the signed-in user's stories assigned to
them, across every project they belong to (archived projects excluded).
Scoped to **assigned, non-Icebox** stories — Icebox stories haven't entered
a board yet. Renders as a real **Kanban board**: four columns, side by side,
draggable — **Todo / Today / Doing / Done** — reusing the project board's own
drag machinery (dnd-kit sensors, optimistic per-card revert on a failed
drop). My Work keeps its **own** status per (user, story)
(`my_work_story_state`), independent of the story's real project state; a
project can optionally map its Doing/Done columns onto its own board states
(owner-configured in Settings, TASK-133) to keep the two in sync.

Done is an **additive log**, evaluated independently of the other three:

- **Done** — every time the viewer completes a story (`story_completions`,
  append-only — reopening and re-completing adds a new entry, never
  overwrites one), plus any unmapped-project story the viewer has locally
  marked done. Grouped by date (Today / Yesterday / date, newest first).
  Entries are **live-joined** to the story's current title/points/state, so
  they keep updating even if the story is reassigned away or the viewer
  later leaves the project — the log is permanent, the ticket underneath
  isn't frozen. A story currently active elsewhere (e.g. reopened and
  back in progress) can appear in **both** Done and Doing at once — Done
  never hides an active card, and an active card never erases its history.

Todo/Today/Doing classify a story into exactly one of the three, gated only
by "its real state category isn't `done` right now":

- **Today** — a pure personal marker: the user dragged this card into Today
  (or out of it). Not derived from any project's iteration — no automatic
  membership, no separate pin button, no pinning at all. Carries over
  automatically (it's just a stored flag, not a per-day snapshot).
- **Doing** — the project maps Doing to a real `in_progress`-category state
  and the story is currently in it, OR the project is unmapped and the
  viewer's local status is `doing` (defaulting to derived-from-real-category
  when untouched).
- **Todo** — everything else assigned to the viewer, grouped by project
  (personal project first, then project name; board position order within
  a group).

**Dragging a card** always writes `my_work_story_state` first:

- **To Today or Todo** — a `my_work_story_state`-only write, mapped or not.
  Never changes the story's real project state.
- **To Doing or Done, project mapped** — also transitions the story's real
  state (`set_story_state`) to the mapped state, so a mapped project's
  Doing/Done can never drift from its real board. If the target state would
  need to schedule the story into a current iteration and the project has
  none, the drag is rejected with a visible banner (never a silent no-op).
- **To Doing or Done, project unmapped** — a local-only write
  (`my_work_story_state.local_status`); the real project is untouched, by
  design (an accepted, permanent divergence for projects that don't map).

Every row shows the story's type icon/title (linking to the standalone
`/stories/[id]` page — My Work has no side peek of its own), its project as
a chip, its state badge, and its points. Each row carries a **per-project
accent color** (left border + project chip) so rows from different projects
read apart at a glance — a deterministic project-identity color
(`lib/utils/project-color.ts`, the dataviz-validated categorical palette)
also reused by the sidebar/dashboard.

No global quick-add shortcut (doc-8 §10): a Linear-style shortcut is
deferred indefinitely. Instead, when the user has exactly one personal
project, My Work's header carries that project's own draft story card (see
"Quick-add: draft story card"). Zero or multiple personal projects: no
trigger here (ambiguous which one), same as today.

The per-project Focus view is removed with `stories.focus` (TASK-88); board
views reduce to List / Kanban.

### Story card UX (Kanban view)

- Card contents (multica-style): story-type icon, title, one-line truncated
  description, points badge, label chips, and assignee avatar (initials).
- State changes happen by dragging between columns or from the side
  peek — there are no state controls on the card itself. The side peek
  offers the advance-to-next-state button / Accept-Reject pair (same
  computation as the board), not a free-form state dropdown.
- The whole card is draggable (no dedicated drag handle).
- Stories in a `done`-category state render with a green card background
  (styling follows the state's category, not its name).
- `release` stories render as milestone marker rows (flag + horizontal rule)
  in any state, not as regular cards.
- Point estimates of 3 or less are shown as dots (`•`, `••`, `•••`);
  larger values as numerals.

### Story row UX (List view)

- Row contents: story-type icon, title, a state badge, points badge, label
  chips, assignee avatar (initials), and the advance button / Accept-Reject
  pair — all on one compact, full-width row (no fixed column width, unlike
  the Kanban card).
- The whole row is draggable (no dedicated drag handle), same convention as
  the Kanban card.
- `done`-category stories render with a green row background, same as Kanban.
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
