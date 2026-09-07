# Self-host rewrite — design

Status: reviewed by fable-advisor 2026-09-05 (approve with corrections;
all corrections folded in). Supersedes `ARCHITECTURE.md`, `DEPLOY.md`,
`LOCAL_DEV.md` and `ACCOUNT_SETUP.md` once phase 0 lands. Recorded as
Backlog decision-2 (supersedes decision-1).

## 1. Goal and non-goals

**Goal.** Storylane becomes something a stranger can install on their own
machine or server in one command and try, with no account at any third-party
service. The install experience is the product; feature parity with the
current Web app comes after.

Target experience (Forgejo / Redmine class):

```sh
docker run -d -p 3000:3000 -v storylane:/data ghcr.io/l4l4dev/storylane
# open http://localhost:3000, finish the setup page, start working
```

**Why now.** The current stack (hosted Supabase + Vercel) cannot be handed to
someone else: trying Storylane means using the owner's instance. Nobody is
using the current deployment and there is no production data, so a rewrite
has no migration cost.

**Non-goals for this design.** Multi-tenant SaaS, horizontal scaling beyond
one process, Postgres support (revisit on demand), iOS (deferred; targets the
new API later), OAuth login.

**What is kept.** The product spec (`SPEC.md`, `spec/`, including the golden
fixtures in `spec/fixtures/`) unchanged except where this document says so;
the pure logic in `packages/core`; shadcn/Tailwind UI pieces where they fit;
the repository itself. Everything else is rewritten.

## 2. Shape

One process, one container, one data file.

```
Browser (SPA) ─┐
iOS            ├──► Storylane server (Hono on Bun) ──► /data/storylane.db (SQLite)
MCP            ┘     JSON API · static files · SSE · in-process worker
```

- `apps/server` — Hono HTTP server run by Bun. Serves the JSON API, the
  built SPA, Server-Sent Events, and runs the background worker in the same
  process.
- `apps/web` — Vite + React SPA (replaces Next.js). No SSR.
- `packages/core` — kept; pure velocity/board logic, tested against
  `spec/fixtures/*.json`.
- Later: `apps/mcp` against the new API; `apps/ios` against the new API.

Reverse proxy / TLS is outside the container: a `docker-compose.yml` with a
Caddy profile is shipped for people who have a domain.

### Runtime: Bun

Chosen over Node because it removes the two hard parts of self-host
distribution: `bun:sqlite` is built in (no native-module build per OS/CPU),
and `bun build --compile` produces a single executable with the SPA assets
embedded (phase 3 distribution). Hono and Drizzle support Bun first-class.
Server code stays on Hono's runtime-neutral API and Drizzle's driver
abstraction so a fallback to Node + better-sqlite3 remains a driver swap.
Workspace management stays on pnpm; server tests run with `bun test`, web
tests with vitest.

## 3. Authorization: one entry point, enforced by types

RLS was the right tool while three clients talked to Postgres directly. With
a single server as the only entry point, authorization moves to the API
layer. The safety net RLS provided is rebuilt at that layer, in this order
of strength:

1. **Type enforcement.** `authorize(actor, projectId, action)` returns a
   `ProjectTx` — an authorized, project-scoped transaction handle. Every
   function that reads or writes project data takes a `ProjectTx`, never a
   raw `db`. A service that skips authorization does not compile. Cross-
   project operations (move / copy, `spec/features.md` "Move / Copy") use
   `authorizeBoth(actor, fromId, toId, action)`.
2. **Row scoping.** The only way to load a row by id is
   `loadInProject(tx, table, id)`, which runs
   `WHERE id = ? AND project_id = tx.projectId` and returns 404 when absent.
   This closes the IDOR that `authorize` alone leaves open (`:id` belonging
   to another project). The composite key the old schema used for the same
   purpose is carried over: `UNIQUE (id, project_id)` on scoped tables and
   composite foreign keys `(child.project_id, child.parent_id)` on children.
3. **Runtime assertion.** Middleware on `/api/projects/:id/**` fails any
   response whose handler never obtained a `ProjectTx`. Fail closed: 500 in
   every environment, never "log and return".
4. **Matrix test.** One table-driven test enumerates every registered route
   and asserts the response code for five actors — owner, member, viewer,
   non-member, anonymous. Non-members get **404**, not 403 (the old RLS
   answer was "no such row"; existence must not leak). Routes outside the
   project net — `/api/me`, `/api/users`, `/api/admin/**`, invite accept,
   `/setup` — declare their own rule (self-only, instance-admin-only,
   public) and sit in the same table. A route missing from the table fails
   the suite.

Roles stay owner / member / viewer per project, plus a separate
**instance admin** plane (`users.is_admin`: user management, password reset
links, instance settings). Project invitations are an owner action, not an
admin action. `spec/rls.md` is rewritten as `spec/permissions.md`, an
action × role matrix; the TypeScript matrix reads that table as a fixture
so spec and code cannot drift (same discipline as `spec/fixtures/`).

Invariants that RLS or RPCs used to guard and that the matrix must keep:
the last owner of a project cannot be demoted or removed
(`spec/permissions.md` "Last owner"); a viewer's GET never triggers iteration
rollover (`spec/velocity.md` "Rollover", owner decision 2026-07-22).

Authorization failures return 403 for members lacking a permission, 404 for
non-members, 401 when unauthenticated.

## 4. Authentication

Hand-written, email + password only. No OAuth, no mandatory SMTP.

Tables: `users` (email `UNIQUE COLLATE NOCASE`, argon2id `password_hash`,
`display_name`, `is_admin`), `sessions`, `api_tokens`, `invites`,
`reset_tokens`. **Every secret is stored as its SHA-256 hash** (session ids,
Personal Access Tokens, invite tokens, reset tokens, the setup token); the
clear text exists only in the cookie, header, or link. Because every one of
them is a 256-bit random value stored hashed, no server-side secret exists
at all: no cookie signing key, and nothing to keep under `/data`.

Sessions: opaque id in an `HttpOnly; SameSite=Lax` cookie; `Secure` is set
only when the request is HTTPS (`STORYLANE_BASE_URL` is https, or a trusted
proxy sends `X-Forwarded-Proto: https`) — a fixed `Secure` flag breaks
login on `http://192.168.x.x:3000`, which is the home-server case this
project targets. Absolute expiry (30 days) plus idle expiry (14 days); new
id on login; logout deletes server-side; password change or admin reset
revokes all sessions of that user.

CSRF: every cookie-authenticated non-GET request must carry an `Origin`
(fallback `Sec-Fetch-Site`) matching the instance's own origin and
`Content-Type: application/json`; otherwise 403. Bearer-token requests are
exempt.

Rate limiting: login, `/setup`, invite accept and reset endpoints are
limited per IP and per email — login allows 20 attempts per IP and 5 per
email in a 15-minute window. Client IP comes from the socket unless
`STORYLANE_TRUST_PROXY=true`, in which case `X-Forwarded-For` is honoured
(the shipped compose file sets it because Caddy fronts the app).

Passwords: argon2id with explicit parameters (memory 64 MiB, iterations 3),
minimum length only, no composition rules. `Bun.password` exposes only
`memoryCost` and `timeCost`, so parallelism is whatever the implementation
fixes it to — not a knob this project sets. Login failures return one
uniform message.

Password reset without SMTP: an instance admin mints a **one-time reset
link** and hands it over out of band; admins never set another user's
password directly. With SMTP configured the same link is mailed.

PATs (iOS / MCP): named, hashed, optional expiry, `last_used_at`; sent as
`Authorization: Bearer`.

## 5. Data layer

SQLite opened with `journal_mode=WAL`, `synchronous=NORMAL` (a power loss
may drop the last committed transaction but cannot corrupt the file),
`foreign_keys=ON`, `busy_timeout=5000`. Schema in TypeScript with Drizzle;
the schema is the type source. Migrations are Drizzle Kit SQL files under
`apps/server/src/db/migrations/`, applied automatically on startup,
forward-only; a shipped migration file is never edited.

**Transaction rules** (the first two are enforced by a lint rule added in
phase 0):

- `bun:sqlite` transactions are synchronous. **No `await` inside
  `db.transaction()`** — an async callback commits before the body runs and
  atomicity silently disappears.
- Every writing transaction starts `BEGIN IMMEDIATE`, so a read-then-write
  waits on `busy_timeout` instead of failing with `SQLITE_BUSY` when
  `sqlite3` or a backup holds the file.
- Read-check-write sequences that the old schema protected with advisory
  locks (`spec/velocity.md` "Finalization concurrency") are safe as long as
  they live inside one synchronous transaction; the lint rule is what keeps
  that true.

Conventions:

| Concern | Choice |
|---|---|
| ids | text, UUIDv7 generated in the app (time-ordered) |
| timestamps (instants) | integer, UTC milliseconds |
| calendar dates (iteration start/end, time off, `today_date`) | text `YYYY-MM-DD` |
| booleans | integer 0/1 via Drizzle |
| enums (e.g. state category) | text + CHECK; the value list lives in one TS module |
| JSON | text via Drizzle json mode; never used in WHERE |
| sequences (`stories.number`, `position`) | `MAX(x)+1` inside the same transaction; safe under the single writer; `UNIQUE (project_id, number)` |
| dense reordering | one `reorder(tx, table, scope, orderedIds)` helper doing a two-step update (`position = -rank-1`, then `rank`) because SQLite has no deferrable UNIQUE (`spec/data-model.md` "Position ordering invariant") |
| project scoping | `UNIQUE (id, project_id)` + composite FKs (section 3) |

Entity relations are carried over from the current schema (see
`ARCHITECTURE.md` at tag `v0-supabase`): projects, project_members,
project_states (category is the only decision key), iterations, labels,
story_labels, stories (self-referential `parent_id`, `is_container`),
tasks, comments, activity_logs, my_work_*, user_time_off,
project_calendar_exceptions, integrations. `profiles` merges into `users`.
`story_completions` is dropped.

Behaviour moves out of the database; **guards stay in**:

| Was | Becomes |
|---|---|
| activity_logs trigger | `recordActivity(tx, …)` called by each mutating service |
| completed_at trigger | set in `moveStory()` from the target state's category |
| is_container maintenance, `split_story` | `services/hierarchy.ts` |
| Slack outbox + pg_net | outbox row in the same tx; in-process worker sends |
| `finalize_iteration` RPC | `services/iterations.ts`, math from `packages/core` |
| RLS + grants | `authorize()` / `ProjectTx` (section 3) |
| race guards: no assignment into a finalized iteration, story `number` pinned after creation | kept as SQLite triggers with `RAISE(ABORT)` — cheaper and safer than re-checking in every code path |
| FK / unique / check | kept |

Tests run against `:memory:` SQLite with the same migrations. Services are
the main test surface; the regression fixtures behind the old ordering
tasks (TASK-19..23) are ported as fixtures. API routes are thin and get the
matrix test of section 3.

**Backups and upgrades.** `storylane backup <path>` (a subcommand of the
same binary, so it survives the single-binary phase) runs `VACUUM INTO` for
a consistent single-file copy; copying the live file is unsafe under WAL.
On startup, before applying pending migrations, the server writes
`/data/backups/pre-<version>.db` automatically; if a migration fails the
process exits 1 and the operator restores that file. `INSTALL.md` states:
one process per data volume, never a network filesystem (NFS/SMB) for
`/data`.

## 6. Realtime and background work

Single process, so no Redis and no LISTEN/NOTIFY.

**SSE is invalidation-only.** After a transaction commits, the service
publishes `{type: "project.changed", projectId}` on an in-process event bus;
`GET /api/projects/:id/events` streams it to subscribers with a 15–30 s
heartbeat, and clients refetch what they show. No payloads, no ordering, no
`Last-Event-ID` replay, no snapshot drift.

**The worker drains the Slack outbox only.** Iteration rollover stays lazy:
it runs on the first board access by an owner or member
(`spec/velocity.md` "Rollover"); a viewer's access and an unattended
process never advance a project. A scheduled rollover would need a spec
change first.

Scaling to more than one instance would require moving the bus to an
external channel; explicitly out of scope.

## 7. Install experience

First run:

1. Container starts, creates the DB and the secret under `/data`, prints a
   one-time **setup token** to stdout (single use, expires after 30 minutes
   and is regenerated on restart while no admin exists, compared in constant
   time, rate-limited).
2. With zero users the SPA routes to `/setup`; API calls return
   `409 setup_required` as JSON rather than a redirect.
3. `/setup` takes the token plus the admin's email and password. The admin
   row is created inside a `BEGIN IMMEDIATE` transaction guarded by
   `WHERE NOT EXISTS (SELECT 1 FROM users)`, so two concurrent submissions
   cannot create two admins.
4. Admin creates the first project. `/setup` is closed from then on.

Further users join through **invite links** minted by a project owner
(project + role bound, hashed, expiring, revocable). Accepting while logged
in joins the project; accepting while logged out registers and joins. No
email delivery required. SMTP is optional and only enables mailing reset
links.

Configuration: four optional environment variables,
`STORYLANE_PORT` (3000), `STORYLANE_DATA_DIR` (/data),
`STORYLANE_BASE_URL` (set when served over HTTPS behind a proxy),
`STORYLANE_TRUST_PROXY` (false; the shipped compose sets true).

Operations: `/healthz` touches the DB and returns 200; JSON logs to stdout;
upgrade = pull new image and restart (pre-migration backup, then migrations,
on boot); the settings page shows version and commit as today.

Distribution ladder:

1. `docker run` one-liner (multi-arch image on ghcr; first goal).
2. `docker-compose.yml` + `.env` (DOMAIN only) with Caddy for automatic TLS.
3. Single binary per OS via `bun build --compile` on GitHub Releases, later a
   Homebrew tap. Only after 1–2 have been tried by someone else.

CI: push to `main` publishes the `edge` image; a `v*` tag publishes
`latest` + the version tag and attaches binaries to a Release.

## 8. Repository plan

Same repository. The last Supabase-era commit is tagged `v0-supabase`; the
rewrite starts with one commit deleting `apps/web`, `apps/ios`, `apps/mcp`,
`supabase/`, `deno.lock`, `DEPLOY.md`, `LOCAL_DEV.md`, `ACCOUNT_SETUP.md`
and rewriting `ARCHITECTURE.md`. Work happens on `rewrite/self-hosted` and
merges to `main` when `docker run` yields a usable phase-1 build.

Layout after phase 0:

```
apps/server/src/
  db/schema/      one file per area (Drizzle)
  db/migrations/  generated SQL
  db/tx.ts        ProjectTx, authorize, authorizeBoth, loadInProject, reorder
  services/       use cases: authorize → tx → recordActivity
  api/            Hono routes: parsing, auth, JSON only
  auth/           users / sessions / api_tokens / invites / resets
  realtime/       event bus, SSE
  worker/         outbox drain
apps/web/         Vite + React SPA
packages/core/    pure logic (kept), fixtures stay in spec/fixtures/
```

Rules that change in `CLAUDE.md`: the RLS requirement and the migration
location; the `rls-security-reviewer` gate becomes an auth/authz review gate
on `apps/server/src/auth`, `db/tx.ts` and `spec/permissions.md`; the
Supabase local-dev instructions; the "business rules in Postgres RPCs"
invariant (decision-1) is superseded by decision-2: the server is the only
entry point, business rules live in `services/`, race-closing invariants in
DB constraints and guard triggers, pure logic in `packages/core` tested
against `spec/fixtures/`.

## 9. Phases

| Phase | Scope | Exit |
|---|---|---|
| 0 Foundation | repo cleanup + tag; server/web skeletons; SQLite + Drizzle; `ProjectTx` / `authorize` / `loadInProject` / `reorder` in `db/tx.ts`; matrix-test scaffold; no-await-in-transaction lint; `spec/rls.md` → `spec/permissions.md`; healthz; CI publishes image | `docker run` answers `/healthz`; matrix test runs (empty) |
| 1 Vertical slice | setup page + token; login; project-owner invite links; instance-admin reset links; project + states (category); stories create/reorder/move; activity_logs; SSE invalidation; `Secure`-when-HTTPS and `STORYLANE_TRUST_PROXY`; pre-migration backup; README "try in 60 seconds" | a stranger can `docker run` on a LAN or behind Caddy and use a board, then upgrade safely |
| 2 Tracker core | iterations + person-day velocity (from `packages/core`), lazy rollover, estimates, labels, tasks, comments, story hierarchy, guard triggers | usable as a Pivotal-style tracker |
| 3 Periphery | My Work, themes, PAT + MCP server, Slack outbox worker, git webhook, single binary | parity with the old Web app |
| 4 Later | iOS on the new API; passkeys (`@simplewebauthn/server`, or `better-auth` if that proves heavy); Postgres driver if requested | on demand |

Between phase 1 and 2, at least one outside person installs it; their
friction is fixed first.

## 10. Accepted trade-offs

- Operations (updates, backups, disk, TLS) move to whoever runs the
  instance. Mitigated by `storylane backup`, the automatic pre-migration
  backup, `/healthz`, and an `INSTALL.md` that covers cron backups and
  unattended upgrades.
- Losing RLS as a second net. Replaced by the `ProjectTx` type,
  `loadInProject`, composite FKs, the fail-closed middleware and the
  five-actor matrix test (section 3).
- Rewriting validated logic. Old migrations are read as part of the spec
  during porting; `spec/fixtures/` carries the numeric behaviour.
- Supabase conveniences disappear: Studio (use `sqlite3` / any SQLite GUI),
  generated types (Drizzle schema is the type), PostgREST filters (write
  the endpoints), Vercel previews (none), Realtime (SSE).
- Bun is younger than Node; kept swappable.
- SQLite ceiling: tens of users and tens of thousands of stories are
  comfortable; beyond that, add the Postgres driver.
