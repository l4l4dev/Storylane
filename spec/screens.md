← [SPEC.md](../SPEC.md)

## Screen Structure

### Web (Next.js)

```
/                         Login / top page
/auth/login               Login (OAuth)
/dashboard                Project list
/projects/[id]            Redirects to the board (see below) — the board is the project's home view
/projects/[id]/board      Board (state-based kanban — see "Board layout" below)
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

### Board layout (Web) — updated 2026-07-06: state-based kanban

The board is a full-width kanban whose columns are **story states**
(multica/Linear style; replaces the 2026-07-02 Pivotal-style panel workspace).
Display comes first: every board interaction happens in place — no page
navigation and no blocking modals.

- Columns, left to right: **Backlog** / **Unstarted** / **Started** /
  **Finished** / **Delivered** / **Accepted**, plus a **Rejected** column that
  appears only while the current iteration has rejected stories. Each column
  header shows a state icon, the story count, and the column's point sum.
- The **Backlog** column lists unstarted stories not yet in the current
  iteration, in priority order, with velocity-based iteration boundary
  markers (spec/velocity.md). A toggle at the top of the column switches it
  to the **Icebox** (unscheduled stories).
- The state columns show only the **current iteration's** stories. Past
  (done) iterations are not on the board — they live on
  `/projects/[id]/iterations`.
- An **iteration bar** above the columns shows the current iteration number,
  date range, inline-editable sprint goal, committed points, and current
  velocity.
- **Drag = state transition.** Dropping a card on a column performs that
  transition. Only the valid next transition(s) are accepted (see
  spec/features.md); invalid targets reject the drop and the card snaps back.
  - Backlog → Unstarted assigns the story to the current iteration;
    Backlog → Started assigns and starts it in one gesture.
  - Rejected → Started is the `Restart` transition.
  - An unestimated `feature` cannot be dropped on Started.
  - Dragging within a column reorders (position), Backlog ⇄ Icebox works via
    the column toggle views.
- **Inline quick-add:** the Backlog, Icebox, and Unstarted columns have a `+`
  composer pinned to the column — type a title, press Enter to create
  (defaults: type `feature`, unestimated, unassigned), and the composer stays
  open for consecutive adds; Esc closes it. Every other field is edited
  afterwards in the side peek. No modal, no navigation.
- **Side peek:** clicking a card opens the story detail in a right-hand panel
  overlaying the board's right edge, driven by `?story=<id>` on the board URL
  (shareable/bookmarkable). The board stays visible and interactive; Esc or ✕
  closes the peek. This replaces the former in-card accordion expansion.
  `/stories/[id]` remains the standalone page for deep links.
- Columns have subtle state-tinted backgrounds (e.g. green for Accepted, red
  for Rejected), with dark-mode variants derived from the same tokens.

### Story card UX

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
