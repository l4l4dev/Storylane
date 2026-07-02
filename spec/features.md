← [SPEC.md](../SPEC.md)

## Feature List

### Phase 1 (Initial Release)

#### Story Management
- Icebox: new stories start as `unscheduled` in the Icebox; promoting a story
  to the backlog makes it `unstarted` (Pivotal Tracker's triage flow)
- Backlog list with drag-and-drop reordering
- Create, edit, and delete stories
- Story types: feature / bug / chore / release
  (`release` stories act as milestone markers in the backlog — see spec/screens.md)
- Story states: unscheduled → unstarted → started → finished → delivered → accepted / rejected
- One-click state transitions on the story card (Start / Finish / Deliver /
  Accept / Reject / Restart) — only the next valid transition is offered;
  arbitrary state jumps are not allowed
- Point estimation — points are chosen from the project's point scale, no free numeric input
  - `fibonacci`: 0, 1, 2, 3, 5, 8, 13 / `linear`: 0, 1, 2, 3 / `custom`: values from `projects.custom_points`
  - An unestimated `feature` cannot be started
- Task (checklist) management within stories
- Assignee, label, and epic associations

#### Iteration Management
- Automatic iteration scheduling: the backlog is divided into upcoming
  iterations by velocity (rendered as boundary markers) — iterations are not
  created manually
- Automatic rollover: when an iteration's `end_date` passes, it is finalized
  automatically and unaccepted stories roll over into the next iteration
  (see spec/velocity.md) — iterations are not completed manually
- Sprint goal setting (Storylane addition — not in Pivotal Tracker)
- Manual story movement between iterations

#### Epics & Labels
- Create epics with color settings and progress display (completed / total stories)
- Create labels with colors and apply multiple labels to stories

#### Team Collaboration
- Invite members to projects by email
- Role management: owner / member / viewer
- Comments and @mentions on stories
- Activity log (timeline of changes within a project)

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
