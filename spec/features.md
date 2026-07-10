← [SPEC.md](../SPEC.md)

## Feature List

> **Mode naming (2026-07-07):** the iteration/velocity workflow is called
> **Tracker** in every user-facing surface (mode picker, badges, marketing
> copy). The name "Pivotal Tracker" must never appear in the product UI —
> it may appear in this spec only as a design reference. The DB value is
> `workflow_mode = 'tracker'` (renamed from `'pivotal'`, see
> spec/data-model.md).

### Phase 1 (Initial Release)

#### Story Management
- Icebox: new stories start as `unscheduled` in the Icebox; promoting a story
  to the backlog makes it `unstarted` (Pivotal Tracker's triage flow)
- Backlog list with drag-and-drop reordering
- Create, edit, and delete stories
- Story types: feature / bug / chore / release
  (`release` stories act as milestone markers in the backlog — see spec/screens.md)
- Story states: unscheduled → unstarted → started → finished → delivered → accepted / rejected
- State transitions (Start / Finish / Deliver / Accept / Reject / Restart) —
  only the next valid transition is allowed; arbitrary state jumps are not
  allowed. On the Web board a transition is performed by dragging the card to
  the target state column (or via buttons in the story side peek); on iOS via
  one-click buttons (see spec/screens.md)
- Point estimation — points are chosen from the project's point scale, no free numeric input
  - `fibonacci`: 0, 1, 2, 3, 5, 8, 13 / `linear`: 0, 1, 2, 3 / `custom`: values from `projects.custom_points`
  - An unestimated `feature` cannot be started
- Task (checklist) management within stories
- Assignee, label, and epic associations
- **Autosave (2026-07-07):** story detail fields save automatically as the
  user edits — there is no Save button (see spec/screens.md "Story detail
  editing")
- **Promote to Epic (2026-07-07):** a story that has grown too big can be
  promoted from the story detail menu. The story is converted into a new
  epic and its tasks are expanded into new stories:
  - The new epic takes the story's title and description.
  - Each task becomes a new story (type `feature`, unestimated,
    backlog position inherited from the original story's spot, preserving
    task order) linked to the new epic. The original story's labels are
    copied to each new story.
  - **State (2026-07-10, advisor-reviewed):** new stories never inherit a
    `started`-or-later state — an unestimated feature can't be started. If
    the original was `unscheduled` (Icebox) the new stories stay
    `unscheduled`; otherwise they land as `unstarted`. `iteration_id` is
    copied from the original except when that iteration is already `done`
    (an accepted story keeps `iteration_id` after finalization), in which
    case the new stories drop back to the backlog instead of raising the
    done-iteration-assignment guard. Assignee is never inherited (new
    stories start unassigned); task completion state (`is_done`) is not
    carried over either.
  - The original story is deleted. A confirmation dialog spells out the
    conversion; if the story has comments it warns that they will be
    deleted with the story. Points and assignee are discarded (epics carry
    neither). The promotion is recorded in the activity log (single RPC,
    see ARCHITECTURE.md).
- **Move / Copy to another project (2026-07-07):** from the story detail
  menu, targeting any project the user is a member of (either mode):
  - **Move** carries title, description, type, tasks, labels (recreated by
    name+color in the target if missing) and comments; the story receives a
    new per-project number in the target. Epic link is dropped; iteration
    link is dropped (story lands in the target's Icebox as `unscheduled`,
    or the leftmost column in a free project); points are kept only if the
    value exists in the target's point scale, otherwise cleared; assignee
    is kept only if they are a member of the target project. The original
    is deleted; both projects get an activity-log entry.
  - **Copy** duplicates content only (title, description, type, tasks,
    labels) — no comments, no history. Same landing rules as Move.
  - Implemented as a single Postgres RPC per operation for atomicity.
  - Hardening (2026-07-08): the RPCs are SECURITY DEFINER (fixed
    `search_path`, granted to `authenticated` only) and re-check
    everything explicitly inside: caller has role **owner or member in
    both projects** (viewer is not enough), source ≠ target, and neither
    project is archived. Move is implemented as **insert-into-target +
    re-parent tasks/comments/labels + delete-source in one
    transaction** — never `UPDATE stories SET project_id`: the
    per-project numbering trigger pins `number` on UPDATE, so only a
    fresh INSERT gets a correct target-project number. `focus` and
    `completed_at` are cleared on landing (the story arrives
    unscheduled / leftmost). Labels are recreated by lookup-then-insert
    inside the transaction (`labels` has no `UNIQUE(project_id, name)`;
    a concurrent duplicate is benign). Move/Copy land at the **bottom**
    of the target Icebox / leftmost column. The RPC inserts the
    `story.moved_out` / `story.moved_in` / `story.copied_in` activity
    rows itself — in-database, single path, consistent with the trigger
    rule in ARCHITECTURE.md. A concurrent editor of the moved story sees
    their save fail as "story deleted" (handled by the autosave rules in
    spec/screens.md).

#### Iteration Management (Tracker mode)
- Automatic iteration scheduling: the backlog is divided into upcoming
  iterations by velocity, rendered as collapsible numbered groups (see
  spec/screens.md "Backlog groups") — future iterations are not created
  manually
- Automatic rollover: when an iteration's `end_date` passes, it is finalized
  automatically and unaccepted stories roll over into the next iteration
  (see spec/velocity.md)
- **Manual finish (2026-07-07):** in addition to automatic rollover, a
  "Finish iteration" action lets owners/members close the current iteration
  early (see spec/velocity.md "Manual finish"). The iteration bar always
  shows the end date ("auto-finishes on <date>") so the automatic behavior
  is visible.
- Iteration goal setting (Storylane addition — not in Pivotal Tracker).
  Goals commit on Enter with inline feedback — no Save button.
- **Upcoming-iteration goals (2026-07-07):** goals can also be set on
  future (virtual) iterations, keyed by iteration number
  (`iteration_goals`, see spec/data-model.md); adopted into the real
  iteration row on rollover.
- Manual story movement between iterations

#### Epics & Labels
- Create epics with color settings and progress display (completed / total stories)
- Create labels with colors and apply multiple labels to stories

#### Team Collaboration
- **Invite members by user search (2026-07-07, replaces email invite):**
  registered users are found via a search box (matches `username` /
  `display_name`, backed by a capped SECURITY DEFINER RPC) and invited with
  a role. Available in project settings and in the project creation form.
- Role management: owner / member / viewer
- Comments and @mentions on stories
- Activity log (timeline of changes within a project)

#### Projects Page & Account Settings (2026-07-07)
- Projects page (`/dashboard`): inline project creation (no overlay dialog)
  with all initial settings in one form — name, description, mode
  (comparison cards), iteration length, point scale, velocity window
  (Tracker), column template (Free), and initial member invites
- Project cards show a mode badge, mode-specific summary and member avatars
  (see spec/screens.md "Projects page")
- Project archive (owner only): archived projects are hidden from the
  default list behind an "Archived" filter; unarchive restores them
- Per-user favorites (pin): favorited projects sort first on the Projects
  page and in the sidebar project switcher
- Search and sort (last updated / name / created)
- Account settings (`/settings`): username and display name editing lives
  here — not on the Projects page, not per project. Avatar comes from OAuth
  (`avatar_url`); avatar upload is Phase 2.

#### Focus View (Tracker mode, 2026-07-07)
- A third board view (List / Kanban / **Focus**) for personal focus,
  KanbanFlow-inspired: columns **Todo / This week / Today / In progress /
  Done** over the current iteration's stories (see spec/screens.md
  "Focus view"). Dragging between Todo / This week / Today sets
  `stories.focus`; state changes use the on-card transition buttons; Done
  groups accepted stories by acceptance date (`stories.completed_at`).

#### Free Mode (Trello-style board; KanbanFlow parity 2026-07-07)
- Custom columns (`custom_statuses`), any-to-any drag, no
  iterations/velocity — see spec/screens.md "Free mode board"
- Column templates at creation: **KanbanFlow** (Todo / This week / Today /
  In progress / Done) or **Basic** (To do / Doing / Done); Done columns are
  seeded with `is_done = true`
- Done-date display: cards in `is_done` columns show and group by
  completion date (`stories.completed_at`)
- WIP limits per column (`custom_statuses.wip_limit`) — soft limit: the
  column header turns warning-colored when exceeded, drops are not blocked
- Swimlanes: optional horizontal lanes (`swimlanes` table +
  `stories.swimlane_id`)
- Recurring stories: schedule rules (`recurring_stories`) generate story
  instances lazily on board access — daily / weekly / monthly cadence,
  managed in project settings

#### Notifications
- When assigned to a story
- When mentioned in a comment
- When a story you own changes state
- Web: browser notifications / iOS: push notifications
- Web 通知のトリガーは Supabase Realtime のイベント購読（Task 11 が Task 10 の前提）

#### Integrations
- **GitHub**: Link PRs to stories. Auto-update story to `finished` on PR merge
- **Slack**: Notify channels on story updates, iteration start/completion
- **Forgejo**: Same webhook integration as GitHub (for self-hosted environments)

### Phase 2 (Future)
- Burndown chart
- CSV export
- Generic Webhook API
- Avatar upload (Supabase Storage)
