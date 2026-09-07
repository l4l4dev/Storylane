# Storylane — Architecture Relations

How things connect, so relations don't have to be re-derived each session.

**Everything above the `hook:end` marker is injected into every session by the SessionStart hook** (`scripts/session-context.sh`, wired from `.claude/settings.json` and `.codex/hooks.json`; it refuses to run if the marker goes missing). Keep that part to invariants. Detail belongs below the marker. Design: `docs/design/2026-09-05-self-host-rewrite-design.md`; decision-2.

## Shape

```
Browser (SPA) ─┐
iOS (later)    ├──► apps/server (Hono on Bun) ──► $STORYLANE_DATA_DIR/storylane.db (SQLite)
MCP (later)    ┘     JSON API · static SPA · SSE · in-process worker
```

## Invariants

- **The server is the only entry point.** No client holds a DB connection or a service key. iOS/MCP use the same JSON API with Personal Access Tokens.
- **Project data is reachable only through a `ProjectTx`** (`apps/server/src/db/tx.ts`): `withProject(actor, projectId, action, fn)` authorizes, opens the transaction, and hands `fn` a `ProjectTx`. Repositories and services never accept a raw `db`. Rows by id are loaded with `loadInProject(tx, table, id)` (404 outside the project).
- **Permissions come from `spec/permissions.md` via `spec/fixtures/permissions.json`.** `can(role, action)` reads the fixture; the route matrix test (`apps/server/test/route-matrix.test.ts`) fails when a route has no manifest entry.
- **Fail closed, per project.** A successful `/api/projects/:id/**` response must have authorized *that* project id (`src/authz/context.ts`); anything else is turned into 500 in every environment. Non-members get 404, never 403.
- **One `withProject` per request.** Nesting throws — there are no savepoints; services take the `ProjectTx` they are handed. Routes never touch `.tx` (`local/no-project-tx-escape`).
- **`bun:sqlite` transactions are synchronous.** No `await` inside `db.transaction()`; the ESLint rule `local/no-await-in-transaction` enforces it. Writes use `behavior: "immediate"`.
- **Behaviour lives in `services/`, guards stay in the DB.** activity log, outbox, completed_at, container flags are explicit code in one transaction; composite `(id, project_id)` keys, unique `(project_id, number)`, and `RAISE(ABORT)` guard triggers stay in SQLite.
- **Read `project_states.category`, never the state name** (unchanged from v0).
- **Migrations run on boot, forward-only, after `pre-<version>.db` is written.** A shipped migration file is never edited.
- **Iteration rollover is lazy** on owner/member access; the worker drains the Slack outbox only (`spec/velocity.md` "Rollover").

<!-- hook:end -->

## Where things are

| Concern | Path |
|---|---|
| Config / env | `apps/server/src/config.ts` |
| DB open, pragmas, migrations, backup | `apps/server/src/db/` |
| Authorization core | `apps/server/src/db/tx.ts`, `apps/server/src/authz/` |
| Services (all project writes) | `apps/server/src/services/` |
| Activity log | `apps/server/src/services/activity.ts` (`recordActivity`, only writer) |
| Routes | `apps/server/src/routes/` |
| Invitations (owner-minted, single-use) | `apps/server/src/services/invites.ts`; see `spec/permissions.md` "Invitations" |
| SPA | `apps/web/` (served from `apps/web/dist` in production) |
| Pure logic + fixtures | `packages/core/`, `spec/fixtures/` |
| Distribution | `apps/server/Dockerfile`, `docker-compose.yml`, `INSTALL.md` |

The pre-rewrite architecture (Supabase, RLS, RPCs, Next.js) is preserved at tag `v0-supabase`: `git show v0-supabase:ARCHITECTURE.md`.
