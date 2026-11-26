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
| `invite:read` | 401 | 404 | 403 | 403 | 200 |
| `story:read` | 401 | 404 | 200 | 200 | 200 |
| `story:write` | 401 | 404 | 403 | 200 | 200 |
| `story:delete` | 401 | 404 | 403 | 200 | 200 |
| `story:move-cross-project` | 401 | 404 | 403 | 200 | 200 |
| `follower:write` | 401 | 404 | 200 | 200 | 200 |
| `task:write` | 401 | 404 | 403 | 200 | 200 |
| `comment:create` | 401 | 404 | 403 | 200 | 200 |
| `comment:update-own` | 401 | 404 | 403 | 200 | 200 |
| `comment:delete` | 401 | 404 | 403 | 200 | 200 |
| `attachment:write` | 401 | 404 | 403 | 200 | 200 |
| `attachment:delete` | 401 | 404 | 403 | 200 | 200 |
| `label:write` | 401 | 404 | 403 | 200 | 200 |
| `label:delete` | 401 | 404 | 403 | 200 | 200 |
| `epic:write` | 401 | 404 | 403 | 200 | 200 |
| `epic:delete` | 401 | 404 | 403 | 200 | 200 |
| `blocker:write` | 401 | 404 | 403 | 200 | 200 |
| `review:write` | 401 | 404 | 403 | 200 | 200 |
| `review-type:write` | 401 | 404 | 403 | 403 | 200 |
| `iteration:read` | 401 | 404 | 200 | 200 | 200 |
| `iteration:override` | 401 | 404 | 403 | 200 | 200 |
| `activity:read` | 401 | 404 | 200 | 200 | 200 |
| `search:read` | 401 | 404 | 200 | 200 | 200 |

Role definitions follow `docs/reference/tracker-notes/core-model.md` §8: a
member may do anything with stories, tasks, comments, attachments, labels,
epics, blockers and reviews; only an owner edits project settings, review
types and membership; a viewer is read-only except for following/unfollowing
their own stories.

`story:write` covers create, update, move, reorder, transition, estimate and
split — Pivotal-style, any member operates any story. Deletion is also
member-level. `story:move-cross-project` needs the row for **both** projects
(`withTwoProjects`).

`member:invite` covers minting **and** revoking an invitation; `invite:read`
covers listing a project's pending invitations, which is owner-only
bookkeeping (`member:read` is 200 for viewers and must not carry it).

### Invariants the matrix cannot express

- **Last owner.** The sole owner can never be demoted or removed:
  `member:change-role` demoting the sole owner answers `409 last_owner`.
  Removing yourself is `403`: `member:leave` is `403` for any owner, and
  `member:remove` naming the actor's own id answers `403 forbidden`, so an owner
  transfers ownership first and then leaves. `member:leave` is the actor removing
  their own membership. Removing another owner implies at least two owners, so
  `member:remove` never reaches `409 last_owner` through the API.
- **Archived project.** With `projects.archived_at` set, `:read` actions are
  unaffected and every other action answers `409 project_archived` for every
  role, except `project:archive` (un-archive) and `project:delete`, which stay
  owner-only, and `member:leave`, which a member may still do. Precedence is
  `404` → `409` → `403`: a non-member still gets `404`, so archiving never
  reveals that a project exists, and a viewer gets `409` rather than `403`
  because the project is closed to everyone. This replaces the DB-level lock
  that was never built for v0 (former TASK-30).
- **Own comment.** `comment:update-own` also requires actor = author.
  `comment:delete` is allowed to the author or to any project owner; another
  member deleting someone else's comment gets `403` from the service.
- **Own follow.** `follower:write` is `200` for a viewer only for the
  viewer's own follow row; adding or removing somebody else's follow is
  refused to a viewer by the service. Story owners are managed under
  `story:write` instead — adding or removing an owner is a story edit, not a
  follower action, so a viewer never reaches that route at all.
- **Iteration override.** `iteration:override` is member-level by
  assumption: Tracker sets iteration length and team strength from the
  iteration header in the Current panel, which members use, not from the
  owner-only Settings page.

### Invitations

An owner mints an invite bound to one project and one role (`member` or
`viewer` — `owner` is never mintable, and a row somehow carrying it is treated
as unusable on the read side too, defense in depth). It is a random 256-bit
token stored only as its SHA-256 hash (`invites.token_hash`); the clear token
appears exactly once, in the mint response. It expires after 7 days
(`INVITE_TTL_MS`) and is single-use: accepting it stamps `accepted_at` in the
same transaction as the membership insert, so a concurrent second accept sees
it already spent.

Every invalid state — unknown token, expired, revoked, already accepted, or
bound to a project that is now archived — answers the same uniform `404` from
both the public preview (`GET /api/invites/:token`) and accept
(`POST /api/invites/:token/accept`); none of these leak which case applied.
Accepting while already a member of the bound project is idempotent: it
answers `200` with the member's *existing* role (an invite can never demote or
promote an existing member) and does not stamp `accepted_at` — the invite
stays usable for the recipient it was actually sent to.

Accept runs before the accepting user is a member, so there is no `ProjectTx`
to authorize through — `withProject` requires a membership row that does not
exist yet. This is the same shape as project creation: both write
`project_members` and log activity through `bootstrapScope`, a documented
exception to "project data only through a `ProjectTx`" for the one moment a
user is joining, not yet a member. Accepting while logged out (registration)
runs the token recheck, user insert, membership insert, and activity log in
one immediate transaction, so a token invalidated between an earlier read-only
pre-check and the actual write can never leave a registered user with no
membership.

### Instance admin plane

`users.is_admin` grants `user:list`, `user:create`, `user:deactivate`,
`user:reset-link`, `instance:settings`. These are instance-wide and
independent of project membership: non-admin → 403, anonymous → 401. Project
invitations are **not** an admin action; they belong to project owners.

`user:reset-link` mints a password reset for one user
(`POST /api/admin/users/:userId/reset-link`): a random 256-bit token stored
only as its SHA-256 hash (`reset_tokens.token_hash`), expiring after one hour
(`RESET_TTL_MS`), single-use. The clear token appears exactly once, in the
mint response; a deactivated user 404s the mint the same as an unknown one, so
a disabled account's credentials stay out of reach. As with invitations, every
invalid state on the public preview/consume routes
(`GET|POST /api/auth/reset/:token`) — unknown token, expired, already used, or
bound to a now-disabled user — answers one uniform `404`. Consuming a link
runs the token recheck, the `used_at` stamp, and the credential change (new
hash, every session of that user revoked, `credentials_changed_at` bumped) in
one immediate transaction; every *other* outstanding, unused link for that
same user is spent in the same transaction, so a second admin-minted link
cannot later overwrite the password this one just set. The reset response
starts no session: the user proves the new password by logging in.

### Setup

While no user exists, every `/api/**` route answers `409 setup_required` and
the SPA shows `/setup` (design doc §7).

### Routes outside the matrix

Some routes are not project-scoped and therefore have no `(action, role)` cell.
They declare a rule in the server's route manifest
(`apps/server/src/authz/route-manifest.ts`) and the matrix test asserts the
rule exists for every registered route:

- `public` — no session needed: `GET /healthz`, `POST /api/auth/login`,
  `GET /api/invites/:token`, `POST /api/invites/:token/accept`, and
  `GET|POST /api/auth/reset/:token`.
- `self` — any signed-in user, acting only on their own data:
  `GET /api/me`, `POST /api/me/password`, `POST /api/auth/logout`,
  `GET /api/projects`, `POST /api/projects` (a create has no role in a project
  that does not exist yet).
- `admin` — `users.is_admin` only (instance plane): anonymous → 401,
  signed-in non-admin → 403. `POST /api/admin/users/:userId/reset-link`.
- `setup` — reachable only while the instance has no user
  (`GET|POST /api/setup`); afterwards 404.
