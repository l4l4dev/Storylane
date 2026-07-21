← [SPEC.md](../SPEC.md)

## Feature List

> **Naming:** the product's own iteration/velocity workflow is Storylane's;
> the name "Pivotal Tracker" must never appear in the product UI — it may
> appear in this spec only as a design reference. Free mode and the
> `workflow_mode` concept were removed (doc-8 §1); every project runs the
> single workflow.

### Phase 1 (Initial Release)

#### Story Management
- Icebox: new stories start in the Icebox (`state_id IS NULL`, doc-8 §2);
  triaging into the backlog assigns an `unstarted`-category state
- Backlog list with drag-and-drop reordering
- Create, edit, and delete stories
- Story types: feature / bug / chore / release
  (`release` stories act as milestone markers in the backlog — see spec/screens.md)
- **States are per-project, fully custom** (`project_states`,
  spec/data-model.md): freely named/added/removed/reordered board columns,
  each carrying a fixed system **category** (`unstarted` / `in_progress` /
  `done` / `rejected`). The **classic** template reproduces the Pivotal
  columns (Unstarted → Started → Finished → Delivered → Accepted / Rejected).
- **Transitions — deliberate divergence from Pivotal (doc-8 §2):** the DB
  allows **any → any** state within the project (`set_story_state`); there is
  no fixed one-step machine. Ordering discipline lives in the UI: one
  **advance-to-next-state** button per story labelled with the next state's
  `action_label`, the **Accept / Reject** pair on the state before a `done`
  state, and **Restart** on a `rejected` story. On the Web board dragging a
  card to a column also sets the state; on iOS via the advance button (see
  spec/screens.md). The advance/pair computation is a shared `packages/core`
  pure function with golden fixtures.
- Point estimation — points are chosen from the project's point scale, no free numeric input
  - `fibonacci`: 0, 1, 2, 3, 5, 8, 13 / `linear`: 0, 1, 2, 3 / `custom`: values from `projects.custom_points`
  - **Estimation gate (category terms):** an unestimated `feature` can only
    sit in Icebox (`state_id IS NULL`) or an `unstarted`-category state; the
    RPC and board-move deltas reject entry into any `in_progress` / `done` /
    `rejected` state
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
  - **State (2026-07-10, advisor-reviewed; category terms since doc-8 §2):**
    new stories never inherit an `in_progress`-or-later state — an
    unestimated feature can't be started. If the original was in the Icebox
    (`state_id IS NULL`) the new stories stay in the Icebox; otherwise they
    land in the project's first `unstarted`-category state. `iteration_id` is
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
    link is dropped (story lands in the target's Icebox, `state_id IS NULL`);
    points are kept only if the value exists in the target's point scale,
    otherwise cleared; assignee is kept only if they are a member of the
    target project. **Pins carry over** (doc-8 §9): `move_story_to_project`
    recreates `story_pins` on the new story id for pinners who are members of
    the target project, discarding the rest (cross-user write, inside the
    RPC). The original is deleted; both projects get an activity-log entry.
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
    fresh INSERT gets a correct target-project number. `state_id` is set
    to NULL and `completed_at` cleared on landing (the story arrives in
    the target Icebox). Labels are recreated by lookup-then-insert
    inside the transaction (`labels` has no `UNIQUE(project_id, name)`;
    a concurrent duplicate is benign). Move/Copy land at the **bottom**
    of the target Icebox. The RPC inserts the
    `story.moved_out` / `story.moved_in` / `story.copied_in` activity
    rows itself — in-database, single path, consistent with the trigger
    rule in ARCHITECTURE.md. A concurrent editor of the moved story sees
    their save fail as "story deleted" (handled by the autosave rules in
    spec/screens.md).

#### Iteration Management
- Automatic iteration scheduling: the backlog is divided into upcoming
  iterations by velocity, rendered as collapsible numbered groups (see
  spec/screens.md "Backlog groups") — future iterations are not created
  manually
- Automatic rollover: when an iteration's `end_date` passes, it is finalized
  automatically and stories not in a done-category state roll over into the next iteration
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

#### Personal project on signup (doc-8 §4, TASK-93)
- A fresh signup auto-creates one personal project ("My Tasks", 1-day
  cadence, minimal state template, the new user as owner) via the
  `handle_new_user` trigger — no manual setup, `/my-work` has content from
  the first login (see spec/screens.md "Onboarding").
- Marked with `projects.is_personal = true` (TASK-103, doc-11 D1 — reversing
  doc-8's original "no flag" call). Rationale: a 1-day cadence is a legitimate
  team project too, so `iteration_length = 1` can't tell "the user's personal
  project" apart from "a 1-day team project" — and hiding the personal one from
  the projects list needs exactly that distinction. One personal project per
  owner (partial unique index). Otherwise an ordinary project: invites allowed;
  it stays a valid move/copy target.
- Hidden from the owner's own projects list (`/dashboard`) and sidebar switcher
  — it lives in My Work instead. The filter is viewer-scoped
  (`is_personal AND created_by = me`), so a personal project someone was
  *invited* to still shows in their list.
- Seeding runs in the same transaction as the `auth.users` insert; a
  seeding failure fails signup rather than leaving a user without their
  personal project.

#### Projects Page & Account Settings (2026-07-07)
- Projects page (`/dashboard`): inline project creation (no overlay dialog)
  with all initial settings in one form — name, description, state template
  (classic / minimal), cadence, iteration display term, working weekdays,
  point scale, velocity window, and initial member invites
- Project cards show the iteration/velocity summary and member avatars
  (see spec/screens.md "Projects page")
- Project archive (owner only): archived projects are hidden from the
  default list behind an "Archived" filter; unarchive restores them
- Per-user favorites (pin): favorited projects sort first on the Projects
  page and in the sidebar project switcher
- Search and sort (last updated / name / created)
- Account settings (`/settings`): username and display name editing lives
  here — not on the Projects page, not per project. Avatar comes from OAuth
  (`avatar_url`); avatar upload is Phase 2.

#### My Work (cross-project personal view, doc-8 §9 — replaces Focus view)
- All stories assigned to the signed-in user across every project they
  belong to (`/my-work`, see spec/screens.md "My Work").
- 1-day-project current-iteration stories are today's plan by definition;
  longer-cadence stories appear in "today" when the user **pins** them
  (`story_pins`). Personal/1-day stories are visually distinguished.
- The per-project Focus view and `stories.focus` are removed; board views
  reduce to List / Kanban. Screen details (buckets, ordering) are not yet
  fully specced.

#### Notifications
- When assigned to a story
- When mentioned in a comment
- When a story you own changes state
- Web: browser notifications / iOS: push notifications
- Web 通知のトリガーは Supabase Realtime のイベント購読（Task 11 が Task 10 の前提）

#### Integrations
- **GitHub**: Link PRs to stories. On PR merge, advance the story to the
  integration's **configurable target state** (classic default: Finished;
  unset = disabled), guarded forward-only, never into done/rejected (doc-8 §2)
- **Slack**: Notify channels on story updates, iteration start/completion
- **Forgejo**: Same webhook integration as GitHub (for self-hosted environments)

### Phase 2 (Future)
- Burndown chart
- CSV export
- Generic Webhook API
- Avatar upload (Supabase Storage)
