← [SPEC.md](../SPEC.md)

## Feature List

### Phase 1 (Initial Release)

#### Story Management
- Backlog list with drag-and-drop reordering
- Create, edit, and delete stories
- Story types: feature / bug / chore / release
- Story states: unstarted → started → finished → delivered → accepted / rejected
- Point estimation (fibonacci: 0, 1, 2, 3, 5, 8, 13 / custom scale)
- Task (checklist) management within stories
- Assignee, label, and epic associations

#### Iteration Management
- Auto-generate iterations based on sprint length
- Auto-assign stories from backlog based on velocity
- Sprint goal setting
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
