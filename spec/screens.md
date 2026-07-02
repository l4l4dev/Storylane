← [SPEC.md](../SPEC.md)

## Screen Structure

### Web (Next.js)

```
/                         Login / top page
/auth/login               Login (OAuth)
/dashboard                Project list
/projects/[id]            Project home (backlog + current iteration, read-only summary)
/projects/[id]/board      Board (multi-panel workspace — see "Board layout" below)
/projects/[id]/epics      Epic list
/projects/[id]/settings   Project settings (members, integrations, point scale, etc.)
/stories/[id]             Story detail (standalone deep-link page; primary editing happens
                          inline on the board — see "Board layout" below)
```

### Board layout (Web) — updated 2026-07-02 for Pivotal Tracker parity

The board is a full-width, Pivotal Tracker-style multi-panel workspace
(replaces the earlier single-column layout where iterations stacked above the backlog):

- A slim sidebar on the left toggles panels on/off. Enabled panels render
  side by side as vertical columns, each independently scrollable.
- Panels: **Current** / **Backlog** / **Icebox** / **Done** / **Epics**.
  Default on: Current, Backlog, Icebox.
- Drag-and-drop works within a panel (reorder) and across panels
  (Icebox ⇄ Backlog ⇄ Current). Dropping into Done is not allowed.
- Clicking a story card expands the story detail **inline within the panel**
  (accordion), not a page navigation. `/stories/[id]` remains as a
  standalone page for deep links (e.g. from notifications or PR descriptions).
- The inline expansion shows the same content as `/stories/[id]`: editable
  fields, state-transition buttons, the task checklist, and the comment
  thread (Task 9).

### Story card UX

- One-click state-transition buttons on the card itself: only the next valid
  transition(s) are offered — `Start` (unstarted) → `Finish` (started) →
  `Deliver` (finished) → `Accept` / `Reject` (delivered); rejected shows
  `Restart`. No free-form state dropdown.
- The whole card is draggable (no dedicated drag handle).
- Accepted stories render with a green card background.
- `release` stories render as milestone marker rows (flag + horizontal rule),
  not as regular cards.
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
