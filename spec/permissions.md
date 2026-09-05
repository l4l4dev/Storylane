← [SPEC.md](../SPEC.md)

## Permissions

The server is the only entry point (decision-2). Every project route runs
`withProject(actor, projectId, action)`; the answer for each `(action, role)`
is the matrix below. `spec/fixtures/permissions.json` mirrors this table
exactly and is read by the server's route matrix test — edit both.

Roles: `anonymous` (no session), `non-member` (signed in, not in the project),
`viewer`, `member`, `owner`. `200` = allowed (the route may answer 201/204);
`401` unauthenticated; `403` member-level denial; `404` non-member — existence
never leaks.

| action | anonymous | non-member | viewer | member | owner |
|---|---|---|---|---|---|
| `project:read` | 401 | 404 | 200 | 200 | 200 |
| `project:update` | 401 | 404 | 403 | 403 | 200 |
| `project:archive` | 401 | 404 | 403 | 403 | 200 |
| `project:delete` | 401 | 404 | 403 | 403 | 200 |
| `member:read` | 401 | 404 | 200 | 200 | 200 |
| `member:invite` | 401 | 404 | 403 | 403 | 200 |
| `member:change-role` | 401 | 404 | 403 | 403 | 200 |
| `member:remove` | 401 | 404 | 403 | 403 | 200 |
| `member:leave` | 401 | 404 | 200 | 200 | 403 |
| `state:read` | 401 | 404 | 200 | 200 | 200 |
| `state:write` | 401 | 404 | 403 | 200 | 200 |
| `state:delete` | 401 | 404 | 403 | 403 | 200 |
| `story:read` | 401 | 404 | 200 | 200 | 200 |
| `story:write` | 401 | 404 | 403 | 200 | 200 |
| `story:delete` | 401 | 404 | 403 | 403 | 200 |
| `story:move-cross-project` | 401 | 404 | 403 | 200 | 200 |
| `task:write` | 401 | 404 | 403 | 200 | 200 |
| `comment:create` | 401 | 404 | 403 | 200 | 200 |
| `comment:update-own` | 401 | 404 | 403 | 200 | 200 |
| `comment:delete` | 401 | 404 | 403 | 403 | 200 |
| `label:write` | 401 | 404 | 403 | 200 | 200 |
| `label:delete` | 401 | 404 | 403 | 403 | 200 |
| `iteration:read` | 401 | 404 | 200 | 200 | 200 |
| `iteration:update-goal` | 401 | 404 | 403 | 200 | 200 |
| `iteration:rollover` | 401 | 404 | 403 | 200 | 200 |
| `calendar-exception:write` | 401 | 404 | 403 | 200 | 200 |
| `activity:read` | 401 | 404 | 200 | 200 | 200 |
| `export:read` | 401 | 404 | 200 | 200 | 200 |

`story:write` covers create, update, move, reorder, transition, estimate and
split — Pivotal-style, any member operates any story (owner decision
2026-07-19). Deletion stays owner-only. `story:move-cross-project` needs the
row for **both** projects (`withTwoProjects`).

### Invariants the matrix cannot express

- **Last owner.** The sole owner can never be demoted, removed, or leave:
  `member:change-role`, `member:remove`, `member:leave` answer `409 last_owner`.
- **Archived project.** With `projects.archived_at` set, every non-`:read`
  action answers `409 project_archived` for every role; un-archiving is
  `project:archive` (owner). This replaces the DB-level lock that was never
  built for v0 (former TASK-30).
- **Rollover.** `iteration:rollover` runs lazily on an owner's or member's
  request; a viewer's request and the background worker never trigger it
  (`spec/velocity.md` "Rollover", owner decision 2026-07-22).
- **Own comment.** `comment:update-own` also requires actor = author.
- **Per-user rows.** Time-off and My Work rows are read/written only by their
  user; time-off dates are readable by members (viewers included) of a shared
  project for capacity math — dates and kind only, nothing private.

### Instance admin plane

`users.is_admin` grants `user:list`, `user:create`, `user:deactivate`,
`user:reset-link`, `instance:settings`. These are instance-wide and
independent of project membership: non-admin → 403, anonymous → 401. Project
invitations are **not** an admin action; they belong to project owners.

### Setup

While no user exists, every `/api/**` route answers `409 setup_required` and
the SPA shows `/setup` (design doc §7).
