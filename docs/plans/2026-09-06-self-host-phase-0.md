# Self-host rewrite — Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the repository into a single-process Bun/Hono + SQLite server with a Vite SPA shell, so that `docker run ghcr.io/l4l4dev/storylane` answers `/healthz` and the authorization skeleton (`ProjectTx`, permission matrix test, transaction lint) exists before any feature is written.

**Architecture:** One Hono app served by Bun owns the JSON API, the built SPA, and the database. All project data access goes through `withProject()` which authorizes the actor and yields a `ProjectTx`; the DB is a SQLite file opened through Drizzle on `bun:sqlite`, migrated on boot after an automatic backup. The permission matrix is a spec fixture (`spec/fixtures/permissions.json`) read by both the spec test and the route matrix test.

**Tech Stack:** Bun (runtime, `bun test`), Hono, Drizzle ORM + Drizzle Kit (sqlite dialect, `bun-sqlite` driver), Vite + React 19 + Tailwind v4 (web), ESLint 9 flat config with one local rule, GitHub Actions + docker buildx → ghcr, Caddy (compose profile). Package manager stays pnpm (Bun only runs code).

**Spec:** `docs/design/2026-09-05-self-host-rewrite-design.md` (sections 2, 3, 5, 7, 8, 9). Backlog: TASK-236 … TASK-243 (milestone m-8). Decision: `.backlog/decisions/decision-2*.md`.

## Global Constraints

- Branch: all work on `rewrite/self-hosted`, branched from `main` after tag `v0-supabase` is set. Never push; merge to `main` only after the owner runs `/code-review`.
- Repo rules that still apply: no `git add -A`/`git add .`; never chain state-changing commands with `&&`; no personal names in git-tracked files (say `@l4l4dev` / "the owner"); commit messages follow Conventional Commits and end with the Co-Authored-By trailer the session prints.
- Environment variables (design §7): `STORYLANE_PORT` default `3000`; `STORYLANE_DATA_DIR` default `/data`; `STORYLANE_BASE_URL` optional; `STORYLANE_TRUST_PROXY` default `false`. No other configuration source.
- SQLite pragmas (design §5): `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`. Every writing transaction uses `behavior: "immediate"`. No `await` inside `db.transaction()` callbacks.
- ids are `text` UUIDv7; instants are `integer` UTC milliseconds; calendar dates are `text` `YYYY-MM-DD`; booleans `integer` 0/1; enums `text` + CHECK.
- Response codes: 401 unauthenticated, 403 member lacking permission, 404 non-member (and any row outside the project), 409 `setup_required` while no admin exists, 500 when a project route completed without authorization (fail closed, every environment).
- Docker image: base `oven/bun:1-slim`, non-root user, `VOLUME /data`, `EXPOSE 3000`, under 250 MB; multi-arch `linux/amd64,linux/arm64`.
- Tests: server with `bun test` (from `apps/server`), web with `vitest` (from `apps/web`), core with `vitest` (from `packages/core`). A task is not done until its tests pass and the commit is made.
- Preserve `<!-- hook:end -->` in `ARCHITECTURE.md`; `scripts/session-context.sh` exits non-zero without it.

---

## File map after Phase 0

```
.github/workflows/publish.yml         build+test+push image (Task 7)
apps/server/
  package.json  tsconfig.json  bunfig.toml  eslint.config.js  drizzle.config.ts
  Dockerfile  README.md
  eslint-rules/no-await-in-transaction.js         (Task 5)
  src/index.ts          Bun.serve entry, CLI dispatch (serve | backup)
  src/config.ts         env parsing → Config
  src/log.ts            JSON-lines logger + request middleware
  src/app.ts            createApp(deps) → Hono
  src/http-error.ts     HttpError(status, code)
  src/routes/healthz.ts
  src/routes/projects.ts (one scaffold route, Task 5)
  src/db/client.ts      openDatabase(path | ":memory:") with pragmas
  src/db/migrate.ts     backupThenMigrate(), runMigrations()
  src/db/backup.ts      vacuumInto(db, path)
  src/db/schema/index.ts  re-exports
  src/db/schema/meta.ts   instance_meta
  src/db/schema/auth.ts   users            (Task 5)
  src/db/schema/projects.ts projects, project_members (Task 5)
  src/db/migrations/*.sql + meta/_journal.json (generated)
  src/db/tx.ts          Actor, ProjectTx, withProject, withTwoProjects, loadInProject, reorder
  src/authz/permissions.ts  loads spec/fixtures/permissions.json, can(role, action)
  src/authz/middleware.ts   failClosed()
  src/authz/route-manifest.ts  ROUTE_ACTIONS
  test/harness.ts        makeTestDb(), makeTestApp()
  test/*.test.ts
apps/web/
  package.json  vite.config.ts  tsconfig.json  index.html  vitest.config.ts
  src/main.tsx  src/App.tsx  src/index.css  src/App.test.tsx
docker-compose.yml  Caddyfile  .env.example  INSTALL.md   (Task 8)
spec/permissions.md  spec/fixtures/permissions.json        (Task 2)
packages/core/src/permissions.test.ts                    (Task 2)
```

---

### Task 1: Repo cleanup (TASK-236)

**Files:**
- Delete: `apps/web/`, `apps/ios/`, `apps/mcp/`, `supabase/`, `deno.lock`, `DEPLOY.md`, `LOCAL_DEV.md`, `ACCOUNT_SETUP.md`, `.github/workflows/deploy.yml`, `.github/workflows/web-ci.yml`, `.github/workflows/ios-ci.yml`, `.claude/agents/rls-security-reviewer.md`, `.claude/commands/db-migrate.md`
- Modify: `pnpm-workspace.yaml`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`, `REVIEW.md`, `README.md`, `.claude/settings.json` (only if it references deleted files)
- Create: `.claude/agents/authz-reviewer.md`

**Interfaces:**
- Produces: a workspace containing only `packages/core` (plus `apps/*` glob for later tasks); `ARCHITECTURE.md` with the new invariants above the marker.

- [ ] **Step 1: Tag and branch**

```bash
git tag -a v0-supabase -m "Last commit of the hosted Supabase + Vercel architecture" main
git switch -c rewrite/self-hosted
```

- [ ] **Step 2: Remove the old implementation**

```bash
git rm -r -q apps/web apps/ios apps/mcp supabase deno.lock DEPLOY.md LOCAL_DEV.md ACCOUNT_SETUP.md .github/workflows/deploy.yml .github/workflows/web-ci.yml .github/workflows/ios-ci.yml .claude/agents/rls-security-reviewer.md .claude/commands/db-migrate.md
```

Then check nothing else references them: `grep -rn "rls-security-reviewer\|db-migrate\|apps/web\|supabase" --include=*.md --include=*.json --include=*.yml --include=*.sh . | grep -v node_modules | grep -v ".backlog/" | grep -v "^./spec/" | grep -v "^./specs/" | grep -v "^./docs/"`. Every hit outside `.backlog/`, `spec/`, `specs/`, `docs/` is a line to fix in Steps 3–6 (Backlog history and spec stay as they are; `spec/rls.md` is Task 2).

- [ ] **Step 3: Workspace**

Replace `pnpm-workspace.yaml` with:

```yaml
packages:
  - apps/*
  - packages/*

allowBuilds:
  esbuild: true
```

Run `pnpm install` (root). Expected: succeeds, lockfile shrinks; `pnpm --filter @storylane/core test` passes.

- [ ] **Step 4: ARCHITECTURE.md**

Replace the whole file. Everything above the marker is what the SessionStart hook injects, so keep it to invariants:

```markdown
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
- **Fail closed.** A `/api/projects/:id/**` response produced without a `ProjectTx` is turned into 500 in every environment. Non-members get 404, never 403.
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
| Routes | `apps/server/src/routes/` |
| SPA | `apps/web/` (served from `apps/web/dist` in production) |
| Pure logic + fixtures | `packages/core/`, `spec/fixtures/` |
| Distribution | `Dockerfile`, `docker-compose.yml`, `INSTALL.md` |

The pre-rewrite architecture (Supabase, RLS, RPCs, Next.js) is preserved at tag `v0-supabase`: `git show v0-supabase:ARCHITECTURE.md`.
```

Run `bash scripts/session-context.sh >/dev/null`; expected exit 0.

- [ ] **Step 5: CLAUDE.md**

Edit these sections in place (do not rewrite the whole file):

1. "About This Project": append one sentence: "Since 2026-09-05 the project is being rewritten as a self-hostable single-container app; see `docs/design/2026-09-05-self-host-rewrite-design.md`."
2. "Critical Rules": replace the bullet "Destructive DB operations (DELETE/TRUNCATE/UPDATE without a primary-key filter)…" with "Destructive operations on a SQLite data file you did not create in this session (deleting `/data`, running `DELETE` without an id filter) require explicit owner approval first". Keep the rest.
3. "Review Workflow": replace "Migrations additionally require an `rls-security-reviewer` agent pass" with "Changes under `apps/server/src/auth`, `apps/server/src/db/tx.ts`, `apps/server/src/authz/` or `spec/permissions.md` additionally require an `authz-reviewer` agent pass".
4. "Token Economy": replace the bullet about `apps/web/lib/database.types.ts` with "Never read generated files in full (`apps/server/src/db/migrations/*.sql`, lockfiles)"; replace "Run long-lived commands (`pnpm dev`, `supabase start`)" with "Run long-lived commands (`bun run dev`, `pnpm --filter web dev`)"; replace the last bullet with "While iterating, run targeted tests (`bun test <path>` in `apps/server`, `pnpm exec vitest run <path>` in `apps/web`); before commit run `bun test` in `apps/server`, `pnpm test` + `pnpm run lint` in `apps/web`".
5. Delete the whole "Supabase Conventions" section. Insert in its place:

```markdown
## Server Conventions

- All project data access goes through `withProject()` / `ProjectTx` (`ARCHITECTURE.md` invariants). Never import the raw `db` into `services/` or `routes/`.
- Permissions are declared in `spec/permissions.md` and mirrored in `spec/fixtures/permissions.json`; a new route needs a `ROUTE_ACTIONS` entry or the matrix test fails.
- Migrations: `bun run db:generate` in `apps/server` after editing `src/db/schema/*.ts`; commit the generated SQL; never edit a shipped migration.
- Secrets never live in source; the server reads only the four `STORYLANE_*` variables.
```

6. "Do Not": replace "Leave RLS disabled while implementing" with "Bypass `withProject()` for project data".
7. In the closing line "iOS conventions live in `apps/ios/`, Web conventions in `apps/web/`" change to "Server conventions live in `apps/server/`, Web conventions in `apps/web/`".

- [ ] **Step 6: AGENTS.md, REVIEW.md, README.md, authz-reviewer agent**

- `AGENTS.md`: apply the same replacements as CLAUDE.md wherever it duplicates them (grep for `supabase`, `RLS`, `rls-security-reviewer`, `Next`).
- `REVIEW.md`: remove rules that name Supabase/RLS/PostgREST/Next; add: "Authorization: every project route obtains a `ProjectTx`; row loads use `loadInProject`; non-member → 404. Transactions: no `await` inside `db.transaction()`; writes use `immediate`."
- `README.md`: replace the body with a short description, the target one-liner (`docker run -d -p 3000:3000 -v storylane:/data ghcr.io/l4l4dev/storylane`), a "Status: rewrite in progress, see docs/design/…" line, and links to `INSTALL.md` (Task 8) and `SPEC.md`.
- Create `.claude/agents/authz-reviewer.md`:

```markdown
---
name: authz-reviewer
description: Reviews authentication and authorization changes in apps/server (auth/, db/tx.ts, authz/) and spec/permissions.md for holes. Invoke after any change under those paths.
tools: Read, Grep, Glob, Bash
model: opus
---

You review authorization and authentication code for Storylane's single-process server. Read `ARCHITECTURE.md` invariants and `spec/permissions.md` first.

Check, in order:
1. Every route under `/api/projects/:id/**` obtains a `ProjectTx` through `withProject`/`withTwoProjects`; no raw `db` import in routes or services.
2. Every by-id row load uses `loadInProject`; any `WHERE id = ?` without `project_id` is a finding.
3. `ROUTE_ACTIONS` has an entry for every registered route and the action's row in `spec/fixtures/permissions.json` matches the intent of the route.
4. Non-members receive 404, unauthenticated 401, members lacking permission 403; nothing leaks existence.
5. Tokens (session ids, PATs, invite/reset/setup tokens) are stored hashed; comparisons are constant-time; cookies are `HttpOnly`, `SameSite=Lax`, `Secure` only when HTTPS.
6. Cookie-authenticated non-GET requests check `Origin`/`Sec-Fetch-Site` and require `application/json`.
7. No `await` inside `db.transaction()`; writes use `behavior: "immediate"`.
8. Last-owner invariant and archived-project read-only rule are enforced in code, with tests.

Report findings ranked by severity with file:line and a one-line fix each. Do not modify files.
```

Check `.claude/settings.json` and `.codex/hooks.json` for references to deleted paths (`grep -n "supabase\|apps/web" .claude/settings.json .codex/hooks.json`); remove only those lines.

- [ ] **Step 7: Verify and commit**

```bash
pnpm install
pnpm --filter @storylane/core test
bash scripts/session-context.sh >/dev/null
grep -rln "supabase\|Supabase" CLAUDE.md AGENTS.md REVIEW.md README.md .claude/ | cat
```

Expected: install ok, core tests pass, hook exit 0, grep prints nothing (or only lines that say "v0-supabase" / "pre-rewrite"). Then:

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml ARCHITECTURE.md CLAUDE.md AGENTS.md REVIEW.md README.md .claude/agents/authz-reviewer.md
git add -u
git commit -m "chore: remove Supabase-era apps and rewrite agent instructions for the self-host rewrite (TASK-236)"
```

(`git add -u` stages only the deletions already recorded by `git rm` plus tracked modifications; it never adds untracked files.) Mark TASK-236 Done: `backlog task edit TASK-236 -s Done --append-notes "Tag v0-supabase set; old apps removed; instructions rewritten. Commit <sha>."`.

---

### Task 2: spec/permissions.md + fixture (TASK-237)

**Files:**
- Create: `spec/permissions.md`, `spec/fixtures/permissions.json`, `packages/core/src/permissions.test.ts`
- Delete: `spec/rls.md`
- Modify: `SPEC.md` (index row), `spec/velocity.md` and `spec/data-model.md` only where they link to `rls.md`

**Interfaces:**
- Produces: `spec/fixtures/permissions.json` with shape
  ```ts
  type Role = "anonymous" | "non-member" | "viewer" | "member" | "owner";
  type Expect = 200 | 401 | 403 | 404;
  interface PermissionsFixture {
    roles: Role[];                                  // fixed order above
    actions: Record<string, Record<Role, Expect>>;  // e.g. "story:write"
    adminActions: string[];                         // instance-admin plane
    notes: Record<string, string>;                  // invariants by key
  }
  ```
  `200` means allowed (the real route may answer 201/204). Later tasks import the fixture through `apps/server/src/authz/permissions.ts` (Task 5).

- [ ] **Step 1: Write the failing spec test**

`packages/core/src/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const fixture = JSON.parse(readFileSync(resolve(root, "spec/fixtures/permissions.json"), "utf8"));
const md = readFileSync(resolve(root, "spec/permissions.md"), "utf8");

/** Parse the first markdown table whose header starts with "| action |". */
function parseMatrix(src: string): Record<string, Record<string, number>> {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /^\|\s*action\s*\|/i.test(l));
  if (start < 0) throw new Error("matrix table not found");
  const header = lines[start].split("|").map((s) => s.trim()).filter(Boolean);
  const out: Record<string, Record<string, number>> = {};
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    const cells = lines[i].split("|").map((s) => s.trim()).filter(Boolean);
    const action = cells[0].replace(/`/g, "");
    out[action] = {};
    header.slice(1).forEach((role, idx) => {
      out[action][role] = Number(cells[idx + 1]);
    });
  }
  return out;
}

describe("spec/permissions.md ↔ spec/fixtures/permissions.json", () => {
  it("lists roles in the fixed order", () => {
    expect(fixture.roles).toEqual(["anonymous", "non-member", "viewer", "member", "owner"]);
  });
  it("has identical matrices", () => {
    expect(parseMatrix(md)).toEqual(fixture.actions);
  });
  it("uses only the allowed response codes", () => {
    for (const row of Object.values(fixture.actions) as Record<string, number>[]) {
      for (const code of Object.values(row)) expect([200, 401, 403, 404]).toContain(code);
    }
  });
  it("anonymous is always 401 and non-member always 404", () => {
    for (const row of Object.values(fixture.actions) as Record<string, number>[]) {
      expect(row["anonymous"]).toBe(401);
      expect(row["non-member"]).toBe(404);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @storylane/core exec vitest run src/permissions.test.ts`
Expected: FAIL — `ENOENT … spec/fixtures/permissions.json`.

- [ ] **Step 3: Write the fixture**

`spec/fixtures/permissions.json` (values: 200 allowed; 403 member-level denial; non-member always 404; anonymous always 401):

```json
{
  "roles": ["anonymous", "non-member", "viewer", "member", "owner"],
  "actions": {
    "project:read":            { "anonymous": 401, "non-member": 404, "viewer": 200, "member": 200, "owner": 200 },
    "project:update":          { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "project:archive":         { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "project:delete":          { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "member:read":             { "anonymous": 401, "non-member": 404, "viewer": 200, "member": 200, "owner": 200 },
    "member:invite":           { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "member:change-role":      { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "member:remove":           { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "member:leave":            { "anonymous": 401, "non-member": 404, "viewer": 200, "member": 200, "owner": 403 },
    "state:read":              { "anonymous": 401, "non-member": 404, "viewer": 200, "member": 200, "owner": 200 },
    "state:write":             { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "state:delete":            { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "story:read":              { "anonymous": 401, "non-member": 404, "viewer": 200, "member": 200, "owner": 200 },
    "story:write":             { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "story:delete":            { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "story:move-cross-project":{ "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "task:write":              { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "comment:create":          { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "comment:update-own":      { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "comment:delete":          { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "label:write":             { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "label:delete":            { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
    "iteration:read":          { "anonymous": 401, "non-member": 404, "viewer": 200, "member": 200, "owner": 200 },
    "iteration:update-goal":   { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "iteration:rollover":      { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "calendar-exception:write":{ "anonymous": 401, "non-member": 404, "viewer": 403, "member": 200, "owner": 200 },
    "activity:read":           { "anonymous": 401, "non-member": 404, "viewer": 200, "member": 200, "owner": 200 },
    "export:read":             { "anonymous": 401, "non-member": 404, "viewer": 200, "member": 200, "owner": 200 }
  },
  "adminActions": ["user:list", "user:create", "user:deactivate", "user:reset-link", "instance:settings"],
  "notes": {
    "last-owner": "The sole owner of a project can never be demoted, removed, or leave. member:change-role / member:remove / member:leave return 409 last_owner in that case.",
    "archived": "When projects.archived_at is set every write action (any action not ending in :read) returns 409 project_archived for every role; project:archive itself (un-archive) stays owner-only.",
    "rollover": "iteration:rollover is never triggered by a viewer's or non-member's request, and never by the background worker.",
    "comment-own": "comment:update-own additionally requires the actor to be the comment's author; another member gets 403.",
    "member-leave": "member:leave is the actor removing their own membership; owners must transfer ownership first.",
    "self-only": "time-off and My Work rows are per-user: read/write only by their user; time-off dates are readable by members of a shared project (spec/velocity.md capacity).",
    "admin-plane": "adminActions require users.is_admin; they are instance-wide and never depend on project membership. Non-admin → 403, anonymous → 401.",
    "codes": "200 stands for allowed (the route may answer 201/204). 401 unauthenticated, 403 member-level denial, 404 non-member or row outside the project."
  }
}
```

- [ ] **Step 4: Write spec/permissions.md**

Body (after the `← [SPEC.md](../SPEC.md)` line):

```markdown
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
```

- [ ] **Step 5: Retire spec/rls.md and fix the index**

```bash
git rm -q spec/rls.md
```

In `SPEC.md` replace the `spec/rls.md` row with `| [spec/permissions.md](spec/permissions.md) | Permission matrix (action × role) and the invariants around it | Adding a route or changing who may do what |`. Run `grep -rn "rls.md" SPEC.md spec/ docs/ specs/ .claude/ CLAUDE.md AGENTS.md` and change each remaining link to `permissions.md` (Backlog history under `.backlog/` is left alone).

- [ ] **Step 6: Run tests, get owner approval, commit**

Run: `pnpm --filter @storylane/core test`
Expected: PASS (4 tests).

Show the matrix to the owner in chat and wait for approval (spec change). Record it: `backlog task edit TASK-237 --append-notes "Owner approved the matrix on <date>."`. Then:

```bash
git add spec/permissions.md spec/fixtures/permissions.json packages/core/src/permissions.test.ts SPEC.md
git add -u spec/
git commit -m "docs(spec): replace RLS guidelines with the permission matrix and its fixture (TASK-237)"
```

Mark TASK-237 Done with the commit sha in notes.

---

### Task 3: apps/server skeleton (TASK-238)

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/bunfig.toml`, `apps/server/src/config.ts`, `apps/server/src/log.ts`, `apps/server/src/http-error.ts`, `apps/server/src/app.ts`, `apps/server/src/routes/healthz.ts`, `apps/server/src/index.ts`, `apps/server/test/config.test.ts`, `apps/server/test/healthz.test.ts`, `apps/server/Dockerfile`, `apps/server/README.md`, `.dockerignore`

**Interfaces:**
- Produces:
  ```ts
  // config.ts
  export interface Config { port: number; dataDir: string; baseUrl: URL | null; trustProxy: boolean }
  export function loadConfig(env: Record<string, string | undefined>): Config  // throws ConfigError
  // log.ts
  export interface Logger { info(msg: string, fields?: object): void; error(msg: string, fields?: object): void }
  export function createLogger(out: (line: string) => void): Logger
  export function requestLogger(log: Logger): MiddlewareHandler
  // app.ts
  export interface AppDeps { config: Config; log: Logger; health: () => boolean }
  export function createApp(deps: AppDeps): Hono
  // http-error.ts
  export class HttpError extends Error { constructor(public status: number, public code: string, message?: string) }
  ```
- Task 4 replaces `health: () => boolean` with a DB ping; Task 5 adds routes and middleware to `createApp`.

- [ ] **Step 1: Package scaffolding**

`apps/server/package.json`:

```json
{
  "name": "@storylane/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts serve",
    "start": "bun src/index.ts serve",
    "test": "bun test",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "hono": "latest",
    "drizzle-orm": "latest"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "drizzle-kit": "latest",
    "eslint": "latest",
    "typescript": "^5",
    "typescript-eslint": "latest"
  }
}
```

Run `pnpm install` at the repo root, then replace every `"latest"` in the file with the resolved versions from `pnpm list --filter @storylane/server --depth 0` (pin with `^`).

`apps/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "types": ["bun-types"],
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src", "test", "eslint-rules"]
}
```

`apps/server/bunfig.toml`:

```toml
[test]
root = "./test"
```

- [ ] **Step 2: Failing config test**

`apps/server/test/config.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { loadConfig, ConfigError } from "../src/config";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.dataDir).toBe("/data");
    expect(c.baseUrl).toBeNull();
    expect(c.trustProxy).toBe(false);
  });
  it("reads every STORYLANE_* variable", () => {
    const c = loadConfig({
      STORYLANE_PORT: "8080",
      STORYLANE_DATA_DIR: "/tmp/sl",
      STORYLANE_BASE_URL: "https://tracker.example.org",
      STORYLANE_TRUST_PROXY: "true",
    });
    expect(c.port).toBe(8080);
    expect(c.dataDir).toBe("/tmp/sl");
    expect(c.baseUrl?.origin).toBe("https://tracker.example.org");
    expect(c.trustProxy).toBe(true);
  });
  it("rejects a bad port", () => {
    expect(() => loadConfig({ STORYLANE_PORT: "eighty" })).toThrow(ConfigError);
    expect(() => loadConfig({ STORYLANE_PORT: "70000" })).toThrow(ConfigError);
  });
  it("rejects a relative or non-http base URL", () => {
    expect(() => loadConfig({ STORYLANE_BASE_URL: "tracker.example.org" })).toThrow(ConfigError);
    expect(() => loadConfig({ STORYLANE_BASE_URL: "ftp://x" })).toThrow(ConfigError);
  });
  it("rejects an unknown boolean", () => {
    expect(() => loadConfig({ STORYLANE_TRUST_PROXY: "yes" })).toThrow(ConfigError);
  });
});
```

Run: `cd apps/server; bun test test/config.test.ts` → FAIL (module not found).

- [ ] **Step 3: config.ts**

```ts
export class ConfigError extends Error {}

export interface Config {
  port: number;
  dataDir: string;
  baseUrl: URL | null;
  trustProxy: boolean;
}

function parseBool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ConfigError(`${name} must be "true" or "false", got "${raw}"`);
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const portRaw = env.STORYLANE_PORT ?? "3000";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`STORYLANE_PORT must be an integer 1-65535, got "${portRaw}"`);
  }
  const dataDir = env.STORYLANE_DATA_DIR && env.STORYLANE_DATA_DIR !== "" ? env.STORYLANE_DATA_DIR : "/data";
  let baseUrl: URL | null = null;
  if (env.STORYLANE_BASE_URL && env.STORYLANE_BASE_URL !== "") {
    let parsed: URL;
    try {
      parsed = new URL(env.STORYLANE_BASE_URL);
    } catch {
      throw new ConfigError(`STORYLANE_BASE_URL must be an absolute URL, got "${env.STORYLANE_BASE_URL}"`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ConfigError(`STORYLANE_BASE_URL must be http(s), got "${parsed.protocol}"`);
    }
    baseUrl = parsed;
  }
  return { port, dataDir, baseUrl, trustProxy: parseBool("STORYLANE_TRUST_PROXY", env.STORYLANE_TRUST_PROXY, false) };
}
```

Run the config test → PASS.

- [ ] **Step 4: Failing healthz + logging test**

`apps/server/test/healthz.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { createLogger } from "../src/log";
import { loadConfig } from "../src/config";

function build(health: () => boolean) {
  const lines: string[] = [];
  const log = createLogger((l) => lines.push(l));
  const app = createApp({ config: loadConfig({}), log, health });
  return { app, lines };
}

describe("GET /healthz", () => {
  it("returns 200 with status ok when healthy", async () => {
    const { app } = build(() => true);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
  it("returns 503 when the health check fails", async () => {
    const { app } = build(() => false);
    const res = await app.request("/healthz");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });
  it("logs one JSON line per request with method, path, status, duration, request id", async () => {
    const { app, lines } = build(() => true);
    await app.request("/healthz");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry).toMatchObject({ level: "info", msg: "request", method: "GET", path: "/healthz", status: 200 });
    expect(typeof entry.duration_ms).toBe("number");
    expect(typeof entry.request_id).toBe("string");
    expect(typeof entry.ts).toBe("string");
  });
  it("answers unknown /api paths with JSON 404", async () => {
    const { app } = build(() => true);
    const res = await app.request("/api/nothing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
```

Run → FAIL.

- [ ] **Step 5: log.ts, http-error.ts, app.ts, routes/healthz.ts**

`src/log.ts`:

```ts
import type { MiddlewareHandler } from "hono";

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(out: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (level: "info" | "error", msg: string, fields?: Record<string, unknown>) =>
    out(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
  return {
    info: (msg, fields) => emit("info", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

export function requestLogger(log: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    await next();
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
      request_id: requestId,
    });
  };
}
```

`src/http-error.ts`:

```ts
export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message?: string) {
    super(message ?? code);
  }
}
```

`src/routes/healthz.ts`:

```ts
import { Hono } from "hono";

export function healthzRoute(health: () => boolean) {
  return new Hono().get("/healthz", (c) => {
    return health() ? c.json({ status: "ok" }, 200) : c.json({ status: "unavailable" }, 503);
  });
}
```

`src/app.ts`:

```ts
import { Hono } from "hono";
import type { Config } from "./config";
import { HttpError } from "./http-error";
import { requestLogger, type Logger } from "./log";
import { healthzRoute } from "./routes/healthz";

export interface AppDeps {
  config: Config;
  log: Logger;
  health: () => boolean;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use(requestLogger(deps.log));
  app.route("/", healthzRoute(deps.health));
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code }, err.status as 400);
    deps.log.error("unhandled", { message: err.message, stack: err.stack });
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
```

Run `bun test` → all PASS.

- [ ] **Step 6: Entry point**

`src/index.ts`:

```ts
import { loadConfig, ConfigError } from "./config";
import { createLogger } from "./log";
import { createApp } from "./app";

const [command = "serve"] = Bun.argv.slice(2);
const log = createLogger();

if (command === "serve") {
  let config;
  try {
    config = loadConfig(Bun.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      log.error("config", { message: e.message });
      process.exit(2);
    }
    throw e;
  }
  const app = createApp({ config, log, health: () => true });
  Bun.serve({ port: config.port, hostname: "0.0.0.0", fetch: app.fetch });
  log.info("listening", { port: config.port, data_dir: config.dataDir });
} else {
  log.error("unknown command", { command });
  process.exit(2);
}
```

Verify: `bun run dev` in `apps/server`, then `curl -s localhost:3000/healthz` → `{"status":"ok"}`; `STORYLANE_PORT=x bun src/index.ts serve` → exits 2 with a JSON error line.

- [ ] **Step 7: Dockerfile and README**

`.dockerignore` at repo root:

```
node_modules
**/node_modules
.git
apps/web/dist
**/*.test.ts
.backlog
docs
specs
```

`apps/server/Dockerfile` (build context is the repo root):

```dockerfile
# syntax=docker/dockerfile:1
FROM oven/bun:1-slim AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter @storylane/server... --prod

FROM base AS runtime
ENV NODE_ENV=production STORYLANE_DATA_DIR=/data STORYLANE_PORT=3000
RUN groupadd -r storylane && useradd -r -g storylane -d /app storylane \
 && mkdir -p /data && chown storylane:storylane /data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY apps/server ./apps/server
COPY packages/core ./packages/core
COPY spec/fixtures ./spec/fixtures
USER storylane
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /app/apps/server
ENTRYPOINT ["bun", "src/index.ts"]
CMD ["serve"]
```

If `corepack` is missing from the Bun image, replace the `RUN corepack…` line with `RUN bun add -g pnpm@11` and call `pnpm` the same way. Build and check:

```bash
docker build -f apps/server/Dockerfile -t storylane:dev .
docker run --rm -d -p 3000:3000 -v storylane-dev:/data --name sl storylane:dev
curl -s localhost:3000/healthz
docker image inspect storylane:dev --format '{{.Size}}'
docker stop sl
```

Expected: `{"status":"ok"}`; size under 250 000 000 bytes.

`apps/server/README.md`: purpose, `bun run dev`, `bun test`, the four env vars with defaults, `docker build` line above.

- [ ] **Step 8: Commit**

```bash
git add .dockerignore apps/server pnpm-lock.yaml
git commit -m "feat(server): Bun + Hono skeleton with config, /healthz, JSON request log and Dockerfile (TASK-238)"
```

Mark TASK-238 Done with the commit sha.

---

### Task 4: SQLite + Drizzle foundation (TASK-239)

**Files:**
- Create: `apps/server/drizzle.config.ts`, `apps/server/src/db/client.ts`, `apps/server/src/db/schema/index.ts`, `apps/server/src/db/schema/meta.ts`, `apps/server/src/db/migrate.ts`, `apps/server/src/db/backup.ts`, `apps/server/src/db/migrations/` (generated), `apps/server/test/harness.ts`, `apps/server/test/db-client.test.ts`, `apps/server/test/migrate.test.ts`, `apps/server/test/backup.test.ts`
- Modify: `apps/server/src/index.ts`, `apps/server/src/app.ts` (health uses DB), `apps/server/package.json` (version import)

**Interfaces:**
- Produces:
  ```ts
  // client.ts
  export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };
  export function openDatabase(path: string): Db          // ":memory:" allowed; applies pragmas
  export function readPragmas(db: Db): { journal_mode: string; synchronous: number; foreign_keys: number; busy_timeout: number }
  // migrate.ts
  export function runMigrations(db: Db): void             // drizzle migrate, sync
  export function backupThenMigrate(db: Db, opts: { dataDir: string; version: string; log: Logger }): void  // throws → caller exits 1
  // backup.ts
  export function vacuumInto(db: Db, targetPath: string): void
  // test/harness.ts
  export function makeTestDb(): Db                        // :memory: + migrations
  ```

- [ ] **Step 1: Failing client test**

`apps/server/test/db-client.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { openDatabase, readPragmas } from "../src/db/client";

describe("openDatabase", () => {
  it("applies the required pragmas", () => {
    const db = openDatabase(":memory:");
    const p = readPragmas(db);
    // :memory: databases report journal_mode "memory"; the WAL assertion uses a file below
    expect(p.foreign_keys).toBe(1);
    expect(p.synchronous).toBe(1); // NORMAL
    expect(p.busy_timeout).toBe(5000);
  });
  it("uses WAL for file databases", () => {
    const path = `/tmp/sl-test-${crypto.randomUUID()}.db`;
    const db = openDatabase(path);
    expect(readPragmas(db).journal_mode).toBe("wal");
    db.$client.close();
  });
  it("enforces foreign keys", () => {
    const db = openDatabase(":memory:");
    db.$client.run("create table parent(id text primary key)");
    db.$client.run("create table child(id text primary key, parent_id text references parent(id))");
    expect(() => db.$client.run("insert into child values ('c1', 'missing')")).toThrow(/FOREIGN KEY/);
  });
});
```

Run → FAIL.

- [ ] **Step 2: client.ts and schema/meta.ts**

`src/db/schema/meta.ts`:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/** Instance-wide key/value rows (setup token hash, secret, settings). */
export const instanceMeta = sqliteTable("instance_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(), // UTC ms
});
```

`src/db/schema/index.ts`:

```ts
export * from "./meta";
```

`src/db/client.ts`:

```ts
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

export function openDatabase(path: string): Db {
  const client = new Database(path, { create: true, strict: true });
  client.run("PRAGMA journal_mode = WAL");
  client.run("PRAGMA synchronous = NORMAL");
  client.run("PRAGMA foreign_keys = ON");
  client.run("PRAGMA busy_timeout = 5000");
  return drizzle({ client, schema }) as Db;
}

export function readPragmas(db: Db) {
  const one = <T>(sql: string) => db.$client.query(sql).get() as T;
  return {
    journal_mode: one<{ journal_mode: string }>("PRAGMA journal_mode").journal_mode,
    synchronous: one<{ synchronous: number }>("PRAGMA synchronous").synchronous,
    foreign_keys: one<{ foreign_keys: number }>("PRAGMA foreign_keys").foreign_keys,
    busy_timeout: one<{ timeout: number }>("PRAGMA busy_timeout").timeout,
  };
}
```

Run → PASS. (If `drizzle({ client, schema })` is not the signature of the installed drizzle-orm, use `drizzle(client, { schema })`; check `node_modules/drizzle-orm/bun-sqlite/driver.d.ts`.)

- [ ] **Step 3: Drizzle Kit config and first migration**

`apps/server/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
});
```

Run `pnpm --filter @storylane/server db:generate`. Expected: `src/db/migrations/0000_*.sql` creating `instance_meta` and `meta/_journal.json`. Open the SQL once to confirm it is only that table.

- [ ] **Step 4: Failing migrate + backup tests**

`apps/server/test/migrate.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/client";
import { backupThenMigrate, runMigrations } from "../src/db/migrate";
import { createLogger } from "../src/log";

const silent = createLogger(() => {});

describe("migrations", () => {
  it("creates instance_meta and is idempotent", () => {
    const db = openDatabase(":memory:");
    runMigrations(db);
    runMigrations(db);
    const tables = db.$client.query("select name from sqlite_master where type='table' order by name").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("instance_meta");
  });
  it("writes pre-<version>.db before migrating a file database", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-"));
    const db = openDatabase(join(dir, "storylane.db"));
    backupThenMigrate(db, { dataDir: dir, version: "0.1.0", log: silent });
    expect(existsSync(join(dir, "backups", "pre-0.1.0.db"))).toBe(true);
    expect(readdirSync(join(dir, "backups"))).toEqual(["pre-0.1.0.db"]);
  });
  it("skips the backup for :memory:", () => {
    const db = openDatabase(":memory:");
    expect(() => backupThenMigrate(db, { dataDir: "/nonexistent", version: "0.1.0", log: silent })).not.toThrow();
  });
});
```

`apps/server/test/backup.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/client";
import { vacuumInto } from "../src/db/backup";
import { runMigrations } from "../src/db/migrate";

describe("vacuumInto", () => {
  it("produces a consistent copy with the same tables and rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-"));
    const db = openDatabase(join(dir, "live.db"));
    runMigrations(db);
    db.$client.run("insert into instance_meta(key, value, updated_at) values ('k', 'v', 1)");
    const target = join(dir, "copy.db");
    vacuumInto(db, target);
    const copy = new Database(target, { readonly: true });
    const row = copy.query("select value from instance_meta where key = 'k'").get() as { value: string };
    expect(row.value).toBe("v");
    copy.close();
  });
  it("refuses to overwrite an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-"));
    const db = openDatabase(join(dir, "live.db"));
    const target = join(dir, "copy.db");
    vacuumInto(db, target);
    expect(() => vacuumInto(db, target)).toThrow(/exists/);
  });
});
```

Run → FAIL.

- [ ] **Step 5: backup.ts and migrate.ts**

`src/db/backup.ts`:

```ts
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Db } from "./client";

/** Consistent single-file copy; safe while the WAL is live (unlike cp). */
export function vacuumInto(db: Db, targetPath: string): void {
  if (existsSync(targetPath)) throw new Error(`backup target already exists: ${targetPath}`);
  mkdirSync(dirname(targetPath), { recursive: true });
  db.$client.run("VACUUM INTO ?", [targetPath]);
}
```

`src/db/migrate.ts`:

```ts
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { vacuumInto } from "./backup";
import type { Db } from "./client";
import type { Logger } from "../log";

const migrationsFolder = fileURLToPath(new URL("./migrations", import.meta.url));

export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}

export function backupThenMigrate(db: Db, opts: { dataDir: string; version: string; log: Logger }): void {
  const isFile = db.$client.filename !== "" && db.$client.filename !== ":memory:";
  if (isFile) {
    const target = join(opts.dataDir, "backups", `pre-${opts.version}.db`);
    if (existsSync(target)) {
      opts.log.info("pre-migration backup exists, keeping it", { path: target });
    } else {
      vacuumInto(db, target);
      opts.log.info("pre-migration backup written", { path: target });
    }
  }
  runMigrations(db);
  opts.log.info("migrations applied");
}
```

Run `bun test` → PASS. (`Database#filename` is the bun:sqlite property holding the path; for `:memory:` it is `":memory:"`.)

- [ ] **Step 6: Test harness and wiring into the entry point**

`apps/server/test/harness.ts`:

```ts
import { openDatabase, type Db } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";

export function makeTestDb(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  return db;
}
```

`src/index.ts` — replace the `serve` branch body and add `backup`:

```ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";
import { openDatabase } from "./db/client";
import { backupThenMigrate } from "./db/migrate";
import { vacuumInto } from "./db/backup";
// … existing imports

if (command === "serve") {
  const config = loadConfigOrExit();
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDatabase(join(config.dataDir, "storylane.db"));
  try {
    backupThenMigrate(db, { dataDir: config.dataDir, version: pkg.version, log });
  } catch (e) {
    log.error("migration failed; restore backups/pre-<version>.db if needed", { message: (e as Error).message });
    process.exit(1);
  }
  const app = createApp({
    config,
    log,
    health: () => {
      try { db.$client.query("select 1").get(); return true; } catch { return false; }
    },
  });
  Bun.serve({ port: config.port, hostname: "0.0.0.0", fetch: app.fetch });
  log.info("listening", { port: config.port, data_dir: config.dataDir, version: pkg.version });
} else if (command === "backup") {
  const [, target] = Bun.argv.slice(2);
  if (!target) { log.error("usage: storylane backup <path>"); process.exit(2); }
  const config = loadConfigOrExit();
  const db = openDatabase(join(config.dataDir, "storylane.db"));
  vacuumInto(db, target);
  log.info("backup written", { path: target });
}
```

Extract `loadConfigOrExit()` from the previous try/catch. Manual check from `apps/server`:

```bash
STORYLANE_DATA_DIR=/tmp/sl-data bun src/index.ts serve &
sleep 1; curl -s localhost:3000/healthz; kill %1
ls /tmp/sl-data /tmp/sl-data/backups
STORYLANE_DATA_DIR=/tmp/sl-data bun src/index.ts backup /tmp/sl-copy.db
sqlite3 /tmp/sl-copy.db ".tables"
```

Expected: `{"status":"ok"}`, `storylane.db` + `backups/pre-0.1.0.db`, and `.tables` lists `__drizzle_migrations instance_meta`.

- [ ] **Step 7: Broken-migration exit test (manual, documented)**

Copy `/tmp/sl-data` to `/tmp/sl-broken`, add a file `src/db/migrations/9999_broken.sql` containing `CREATE TABLE instance_meta(x);` **without** touching `_journal.json` … Drizzle ignores files missing from the journal, so instead append a journal entry pointing at that file, run `STORYLANE_DATA_DIR=/tmp/sl-broken bun src/index.ts serve`; expected exit code 1 with the `migration failed` log line and `backups/pre-0.1.0.db` present. Delete the broken file and the journal entry afterwards; do not commit them. Record the observed output in TASK-239 notes.

- [ ] **Step 8: Commit**

```bash
git add apps/server/drizzle.config.ts apps/server/src/db apps/server/src/index.ts apps/server/src/app.ts apps/server/test pnpm-lock.yaml apps/server/package.json
git commit -m "feat(server): SQLite via Drizzle with pragmas, boot migrations behind a pre-migration backup, and the backup subcommand (TASK-239)"
```

Mark TASK-239 Done with the sha.

---

### Task 5: Authorization core — ProjectTx, matrix test, lint (TASK-240)

**Files:**
- Create: `apps/server/src/db/schema/auth.ts`, `apps/server/src/db/schema/projects.ts`, `apps/server/src/db/tx.ts`, `apps/server/src/authz/permissions.ts`, `apps/server/src/authz/middleware.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/src/routes/projects.ts`, `apps/server/eslint-rules/no-await-in-transaction.js`, `apps/server/eslint.config.js`, `apps/server/test/tx.test.ts`, `apps/server/test/route-matrix.test.ts`, `apps/server/test/lint-rule.test.ts`, `apps/server/test/types.test-d.ts`
- Modify: `apps/server/src/db/schema/index.ts`, `apps/server/src/app.ts`, `apps/server/test/harness.ts`, `apps/server/package.json` (eslint deps, `lint` script)
- Generated: `apps/server/src/db/migrations/0001_*.sql`

**Interfaces:**
- Consumes: `Db`, `makeTestDb()`, `HttpError`, `spec/fixtures/permissions.json`.
- Produces:
  ```ts
  // authz/permissions.ts
  export type Role = "anonymous" | "non-member" | "viewer" | "member" | "owner";
  export type MemberRole = Exclude<Role, "anonymous" | "non-member">;
  export type Action = keyof typeof fixture.actions;   // string literal union from the JSON
  export function expected(action: Action, role: Role): 200 | 401 | 403 | 404
  export function isWrite(action: Action): boolean      // !action.endsWith(":read")
  // db/tx.ts
  export type Actor = { kind: "anonymous" } | { kind: "user"; userId: string; isAdmin: boolean };
  export class ProjectTx { readonly projectId: string; readonly role: MemberRole; readonly actor: Actor; /* drizzle tx */ readonly tx: SQLiteTransaction; private constructor(...) }
  export function withProject<T>(db: Db, actor: Actor, projectId: string, action: Action, fn: (tx: ProjectTx) => T): T
  export function withTwoProjects<T>(db: Db, actor: Actor, from: string, to: string, action: Action, fn: (a: ProjectTx, b: ProjectTx) => T): T
  export function loadInProject<TTable extends ScopedTable>(tx: ProjectTx, table: TTable, id: string): TTable["$inferSelect"]
  export function reorder(tx: ProjectTx, table: OrderedTable, scope: SQL, orderedIds: string[]): void
  // authz/middleware.ts
  export function failClosed(): MiddlewareHandler       // sets c.var.authz = { done: false }; 500 if still false on a matched /api/projects/:id/** route
  export function markAuthorized(c: Context): void
  // authz/route-manifest.ts
  export const ROUTE_ACTIONS: Record<`${Method} ${string}`, Action | "public" | "self" | "admin" | "setup">
  ```

- [ ] **Step 1: Schema for users, projects, members + migration**

`src/db/schema/auth.ts`:

```ts
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    disabledAt: integer("disabled_at"),
  },
  (t) => [uniqueIndex("users_email_nocase").on(sql`${t.email} COLLATE NOCASE`)],
);
```

(Add `import { sql } from "drizzle-orm";`. If Drizzle Kit cannot express the `COLLATE NOCASE` index, generate the migration, then hand-edit the generated SQL to `CREATE UNIQUE INDEX users_email_nocase ON users(email COLLATE NOCASE);` before committing — this is allowed because the file has not shipped yet.)

`src/db/schema/projects.ts`:

```ts
import { sqliteTable, text, integer, primaryKey, unique, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: integer("created_at").notNull(),
  archivedAt: integer("archived_at"),
});

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "member", "viewer"] }).notNull(),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    check("project_members_role", sql`${t.role} in ('owner','member','viewer')`),
  ],
);

/** Every project-scoped table exposes these two columns so loadInProject can address it. */
export const scopedColumns = { id: text("id").primaryKey(), projectId: text("project_id").notNull() };

/** Scaffold table used by the tx tests; real domain tables replace it in phase 1. */
export const scopedItems = sqliteTable(
  "scoped_items",
  {
    ...scopedColumns,
    position: integer("position").notNull(),
    label: text("label").notNull(),
  },
  (t) => [unique("scoped_items_id_project").on(t.id, t.projectId), unique("scoped_items_position").on(t.projectId, t.position)],
);
```

Add `export * from "./auth"; export * from "./projects";` to `schema/index.ts`. Run `pnpm --filter @storylane/server db:generate` → `0001_*.sql`. Confirm `bun test` still passes.

- [ ] **Step 2: permissions.ts (fixture loader) + failing test**

`src/authz/permissions.ts`:

```ts
import fixture from "../../../../spec/fixtures/permissions.json";

export type Role = (typeof fixture.roles)[number];
export type MemberRole = "viewer" | "member" | "owner";
export type Action = keyof typeof fixture.actions;
export type Expect = 200 | 401 | 403 | 404;

const actions = fixture.actions as Record<Action, Record<Role, Expect>>;

export function expected(action: Action, role: Role): Expect {
  const row = actions[action];
  if (!row) throw new Error(`unknown action ${action}`);
  return row[role];
}

export function isWrite(action: Action): boolean {
  return !action.endsWith(":read");
}

export const ALL_ACTIONS = Object.keys(actions) as Action[];
export const ROLES = fixture.roles as readonly Role[];
```

Add `"resolveJsonModule": true` already set; Bun resolves the JSON import at runtime. In the Dockerfile (Task 3) `spec/fixtures` is copied for this reason.

- [ ] **Step 3: Failing tx tests**

`apps/server/test/tx.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { makeTestDb, seedProject, seedUser } from "./harness";
import { loadInProject, reorder, withProject, withTwoProjects, type Actor } from "../src/db/tx";
import { scopedItems } from "../src/db/schema";
import { HttpError } from "../src/http-error";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor, member: Actor, viewer: Actor, outsider: Actor;
const anon: Actor = { kind: "anonymous" };
let pA: string, pB: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  member = seedUser(db, "member@example.test");
  viewer = seedUser(db, "viewer@example.test");
  outsider = seedUser(db, "outsider@example.test");
  pA = seedProject(db, owner, [[member, "member"], [viewer, "viewer"]]);
  pB = seedProject(db, owner, [[member, "member"]]);
});

const status = (fn: () => unknown) => {
  try { fn(); return 200; } catch (e) { if (e instanceof HttpError) return e.status; throw e; }
};

describe("withProject", () => {
  it("maps roles to the fixture for a read action", () => {
    expect(status(() => withProject(db, owner, pA, "project:read", () => 1))).toBe(200);
    expect(status(() => withProject(db, viewer, pA, "project:read", () => 1))).toBe(200);
    expect(status(() => withProject(db, outsider, pA, "project:read", () => 1))).toBe(404);
    expect(status(() => withProject(db, anon, pA, "project:read", () => 1))).toBe(401);
  });
  it("maps roles to the fixture for a write action", () => {
    expect(status(() => withProject(db, member, pA, "story:write", () => 1))).toBe(200);
    expect(status(() => withProject(db, viewer, pA, "story:write", () => 1))).toBe(403);
    expect(status(() => withProject(db, member, pA, "story:delete", () => 1))).toBe(403);
    expect(status(() => withProject(db, owner, pA, "story:delete", () => 1))).toBe(200);
  });
  it("returns 404 for an unknown project even to an admin", () => {
    const admin: Actor = { kind: "user", userId: "u-admin", isAdmin: true };
    expect(status(() => withProject(db, admin, "nope", "project:read", () => 1))).toBe(404);
  });
  it("rejects writes to an archived project with 409", () => {
    db.run(sql`update projects set archived_at = 1 where id = ${pA}`);
    expect(status(() => withProject(db, owner, pA, "story:write", () => 1))).toBe(409);
    expect(status(() => withProject(db, owner, pA, "story:read", () => 1))).toBe(200);
    expect(status(() => withProject(db, owner, pA, "project:archive", () => 1))).toBe(200);
  });
  it("rolls back when fn throws", () => {
    expect(() =>
      withProject(db, owner, pA, "story:write", (tx) => {
        tx.tx.insert(scopedItems).values({ id: "i1", projectId: pA, position: 0, label: "x" }).run();
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.select().from(scopedItems).all()).toHaveLength(0);
  });
});

describe("withTwoProjects", () => {
  it("requires the action in both projects", () => {
    expect(status(() => withTwoProjects(db, member, pA, pB, "story:move-cross-project", () => 1))).toBe(200);
    expect(status(() => withTwoProjects(db, viewer, pA, pB, "story:move-cross-project", () => 1))).toBe(404); // viewer is not in pB → 404 wins
  });
});

describe("loadInProject", () => {
  it("returns the row inside the project and 404 for a row in another project", () => {
    withProject(db, owner, pA, "story:write", (tx) => {
      tx.tx.insert(scopedItems).values({ id: "a1", projectId: pA, position: 0, label: "A" }).run();
    });
    withProject(db, owner, pB, "story:write", (tx) => {
      tx.tx.insert(scopedItems).values({ id: "b1", projectId: pB, position: 0, label: "B" }).run();
    });
    withProject(db, owner, pA, "story:read", (tx) => {
      expect(loadInProject(tx, scopedItems, "a1").label).toBe("A");
      expect(status(() => loadInProject(tx, scopedItems, "b1"))).toBe(404);
      expect(status(() => loadInProject(tx, scopedItems, "zzz"))).toBe(404);
    });
  });
});

describe("reorder", () => {
  it("assigns 0..n-1 in the given order without UNIQUE violations, including a full reverse", () => {
    withProject(db, owner, pA, "story:write", (tx) => {
      for (let i = 0; i < 5; i++) tx.tx.insert(scopedItems).values({ id: `r${i}`, projectId: pA, position: i, label: "" }).run();
      reorder(tx, scopedItems, eq(scopedItems.projectId, pA), ["r4", "r3", "r2", "r1", "r0"]);
      const rows = tx.tx.select().from(scopedItems).where(eq(scopedItems.projectId, pA)).orderBy(scopedItems.position).all();
      expect(rows.map((r) => r.id)).toEqual(["r4", "r3", "r2", "r1", "r0"]);
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4]);
    });
  });
  it("rejects an id list that is not a permutation of the scope", () => {
    withProject(db, owner, pA, "story:write", (tx) => {
      tx.tx.insert(scopedItems).values({ id: "x1", projectId: pA, position: 0, label: "" }).run();
      expect(() => reorder(tx, scopedItems, eq(scopedItems.projectId, pA), ["x1", "ghost"])).toThrow(/permutation/);
    });
  });
});
```

Extend `test/harness.ts`:

```ts
import { users, projects, projectMembers } from "../src/db/schema";
import type { Actor } from "../src/db/tx";

export function seedUser(db: Db, email: string, isAdmin = false): Actor {
  const id = crypto.randomUUID();
  db.insert(users).values({ id, email, passwordHash: "x", displayName: email.split("@")[0]!, isAdmin, createdAt: Date.now() }).run();
  return { kind: "user", userId: id, isAdmin };
}

export function seedProject(db: Db, owner: Actor, others: Array<[Actor, "member" | "viewer"]> = []): string {
  if (owner.kind !== "user") throw new Error("owner must be a user");
  const id = crypto.randomUUID();
  db.insert(projects).values({ id, name: "P", createdBy: owner.userId, createdAt: Date.now() }).run();
  db.insert(projectMembers).values({ projectId: id, userId: owner.userId, role: "owner", joinedAt: Date.now() }).run();
  for (const [a, role] of others) {
    if (a.kind !== "user") continue;
    db.insert(projectMembers).values({ projectId: id, userId: a.userId, role, joinedAt: Date.now() }).run();
  }
  return id;
}
```

Run → FAIL (tx module missing).

- [ ] **Step 4: db/tx.ts**

```ts
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./client";
import { projectMembers, projects } from "./schema";
import { HttpError } from "../http-error";
import { expected, isWrite, type Action, type MemberRole, type Role } from "../authz/permissions";

export type Actor = { kind: "anonymous" } | { kind: "user"; userId: string; isAdmin: boolean };

/** Drizzle's synchronous transaction handle for bun-sqlite. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ScopedTable extends SQLiteTable {
  id: SQLiteTable["_"]["columns"][string];
  projectId: SQLiteTable["_"]["columns"][string];
}
export interface OrderedTable extends ScopedTable {
  position: SQLiteTable["_"]["columns"][string];
}

/** The only handle through which project data may be read or written. */
export class ProjectTx {
  private constructor(
    readonly tx: Tx,
    readonly projectId: string,
    readonly role: MemberRole,
    readonly actor: Actor,
  ) {}
  /** @internal — only withProject/withTwoProjects call this. */
  static _create(tx: Tx, projectId: string, role: MemberRole, actor: Actor): ProjectTx {
    return new ProjectTx(tx, projectId, role, actor);
  }
}

function resolveRole(tx: Tx, actor: Actor, projectId: string): { role: Role; archived: boolean } {
  const project = tx.select({ id: projects.id, archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new HttpError(404, "not_found");
  if (actor.kind === "anonymous") throw new HttpError(401, "unauthenticated");
  const m = tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.userId)))
    .get();
  return { role: (m?.role ?? "non-member") as Role, archived: project.archivedAt !== null };
}

function authorizeIn(tx: Tx, actor: Actor, projectId: string, action: Action): ProjectTx {
  if (actor.kind === "anonymous") {
    // Existence must not leak before authentication either; still 401 by the matrix.
    throw new HttpError(401, "unauthenticated");
  }
  const { role, archived } = resolveRole(tx, actor, projectId);
  const code = expected(action, role);
  if (code === 404) throw new HttpError(404, "not_found");
  if (code === 403) throw new HttpError(403, "forbidden");
  if (code === 401) throw new HttpError(401, "unauthenticated");
  if (archived && isWrite(action) && action !== "project:archive") throw new HttpError(409, "project_archived");
  return ProjectTx._create(tx, projectId, role as MemberRole, actor);
}

export function withProject<T>(db: Db, actor: Actor, projectId: string, action: Action, fn: (tx: ProjectTx) => T): T {
  const behavior = isWrite(action) ? "immediate" : "deferred";
  return db.transaction((tx) => fn(authorizeIn(tx, actor, projectId, action)), { behavior });
}

export function withTwoProjects<T>(
  db: Db, actor: Actor, fromId: string, toId: string, action: Action, fn: (from: ProjectTx, to: ProjectTx) => T,
): T {
  return db.transaction((tx) => fn(authorizeIn(tx, actor, fromId, action), authorizeIn(tx, actor, toId, action)), { behavior: "immediate" });
}

export function loadInProject<TTable extends ScopedTable>(tx: ProjectTx, table: TTable, id: string): TTable["$inferSelect"] {
  const row = tx.tx.select().from(table).where(and(eq(table.id, id), eq(table.projectId, tx.projectId))).get();
  if (!row) throw new HttpError(404, "not_found");
  return row as TTable["$inferSelect"];
}

/** Dense 0..n-1 renumbering in two steps because SQLite has no deferrable UNIQUE. */
export function reorder(tx: ProjectTx, table: OrderedTable, scope: SQL, orderedIds: string[]): void {
  const current = tx.tx.select({ id: table.id }).from(table).where(and(scope, eq(table.projectId, tx.projectId))).all() as { id: string }[];
  const have = new Set(current.map((r) => r.id));
  const want = new Set(orderedIds);
  if (have.size !== want.size || [...have].some((id) => !want.has(id))) {
    throw new Error("reorder: orderedIds is not a permutation of the scoped rows");
  }
  orderedIds.forEach((id, rank) => {
    tx.tx.update(table).set({ position: -rank - 1 } as never).where(and(eq(table.id, id), eq(table.projectId, tx.projectId))).run();
  });
  orderedIds.forEach((id, rank) => {
    tx.tx.update(table).set({ position: rank } as never).where(and(eq(table.id, id), eq(table.projectId, tx.projectId))).run();
  });
}
```

Notes for the implementer: if `db.transaction(cb, { behavior })` is not accepted by the installed drizzle version, check `node_modules/drizzle-orm/sqlite-core/db.d.ts` for `SQLiteTransactionConfig` — the option is named `behavior` there. The anonymous check runs before the project lookup so an anonymous caller sees 401 even for a missing project; the fixture says 401 for anonymous regardless. Run `bun test` → PASS.

- [ ] **Step 5: Middleware, manifest, scaffold route + failing route-matrix test**

`src/authz/middleware.ts`:

```ts
import type { Context, MiddlewareHandler } from "hono";

type AuthzVars = { Variables: { authzDone: boolean } };

export function markAuthorized(c: Context<AuthzVars>): void {
  c.set("authzDone", true);
}

/** Fail closed: a matched /api/projects/:id/** handler that never authorized answers 500. */
export function failClosed(): MiddlewareHandler<AuthzVars> {
  return async (c, next) => {
    c.set("authzDone", false);
    await next();
    if (c.res.status !== 404 && !c.get("authzDone")) {
      c.res = c.json({ error: "authorization_missing" }, 500);
    }
  };
}
```

`src/authz/route-manifest.ts`:

```ts
import type { Action } from "./permissions";

export type RouteRule = Action | "public" | "self" | "admin" | "setup";

/** Every registered route must appear here; the matrix test enforces it. */
export const ROUTE_ACTIONS: Record<string, RouteRule> = {
  "GET /healthz": "public",
  "GET /api/projects/:id": "project:read",
};
```

`src/routes/projects.ts`:

```ts
import { Hono } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { markAuthorized } from "../authz/middleware";

export function projectRoutes(db: Db, actorOf: (c: import("hono").Context) => Actor) {
  return new Hono<{ Variables: { authzDone: boolean } }>().get("/api/projects/:id", (c) => {
    const id = c.req.param("id");
    const row = withProject(db, actorOf(c), id, "project:read", (tx) => {
      markAuthorized(c);
      return tx.tx.select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt }).from(projects).where(eq(projects.id, tx.projectId)).get();
    });
    return c.json(row);
  });
}
```

`markAuthorized` is called inside `fn` so it only runs after `authorizeIn` succeeded. Wire in `app.ts`: `AppDeps` gains `db: Db` and `actorOf: (c) => Actor`; `createApp` adds `app.use("/api/projects/*", failClosed())` before `app.route("/", projectRoutes(deps.db, deps.actorOf))`. Until real sessions exist (phase 1) the default `actorOf` reads a test-only header `x-test-actor` (JSON of `Actor`) **only when** `deps.testActorHeader === true`; production passes `() => ({ kind: "anonymous" })`. Put `makeTestApp(db)` in the harness with `testActorHeader: true`.

`apps/server/test/route-matrix.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedProject, seedUser } from "./harness";
import { ROUTE_ACTIONS } from "../src/authz/route-manifest";
import { expected, ROLES, type Action, type Role } from "../src/authz/permissions";
import type { Actor } from "../src/db/tx";

const db = makeTestDb();
const { app } = makeTestApp(db);
const ownerA = seedUser(db, "o@example.test");
const memberA = seedUser(db, "m@example.test");
const viewerA = seedUser(db, "v@example.test");
const outsider = seedUser(db, "x@example.test");
const projectId = seedProject(db, ownerA, [[memberA, "member"], [viewerA, "viewer"]]);
const actors: Record<Role, Actor> = {
  anonymous: { kind: "anonymous" }, "non-member": outsider, viewer: viewerA, member: memberA, owner: ownerA,
};

const registered = app.routes
  .filter((r) => r.method !== "ALL" && !r.path.endsWith("/*"))
  .map((r) => `${r.method} ${r.path}`);

describe("route manifest", () => {
  it("covers every registered route", () => {
    const missing = registered.filter((k) => !(k in ROUTE_ACTIONS));
    expect(missing).toEqual([]);
  });
  it("has no stale entries", () => {
    const stale = Object.keys(ROUTE_ACTIONS).filter((k) => !registered.includes(k));
    expect(stale).toEqual([]);
  });
});

describe("permission matrix over project routes", () => {
  for (const [key, rule] of Object.entries(ROUTE_ACTIONS)) {
    if (!key.includes("/api/projects/:id")) continue;
    const [method, path] = key.split(" ") as [string, string];
    for (const role of ROLES) {
      it(`${key} as ${role} → ${expected(rule as Action, role)}`, async () => {
        const actor = actors[role];
        const res = await app.request(path.replace(":id", projectId), {
          method,
          headers: actor.kind === "anonymous" ? {} : { "x-test-actor": JSON.stringify(actor) },
        });
        const want = expected(rule as Action, role);
        if (want === 200) expect(res.status).toBeLessThan(300);
        else expect(res.status).toBe(want);
      });
    }
  }
});

describe("fail-closed middleware", () => {
  it("turns an unauthorized handler into 500", async () => {
    const { app: leaky } = makeTestApp(db, (a) => a.get("/api/projects/:id/leak", (c) => c.json({ ok: true })));
    const res = await leaky.request(`/api/projects/${projectId}/leak`, { headers: { "x-test-actor": JSON.stringify(ownerA) } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "authorization_missing" });
  });
});
```

`makeTestApp(db, extra?: (app: Hono) => void)` in the harness builds `createApp({ config: loadConfig({}), log: silent, health: () => true, db, actorOf, testActorHeader: true })` and applies `extra` **after** creation so the leak route sits under the fail-closed middleware. Run → FAIL, then implement the wiring until PASS. Also check that `app.routes` includes the method and path fields on the installed Hono version (`node_modules/hono/dist/types/hono-base.d.ts`, `routes: RouterRoute[]`).

- [ ] **Step 6: ESLint rule + failing rule test**

`apps/server/eslint-rules/no-await-in-transaction.js`:

```js
/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "bun:sqlite transactions are synchronous; an await inside db.transaction() silently breaks atomicity" },
    schema: [],
    messages: { noAwait: "Do not await inside a db.transaction() callback (bun:sqlite transactions are synchronous)." },
  },
  create(context) {
    const stack = [];
    const isTransactionCall = (node) =>
      node.type === "CallExpression" && node.callee.type === "MemberExpression" &&
      node.callee.property.type === "Identifier" && node.callee.property.name === "transaction";
    const enterFn = (node) => { stack.push(node.parent && isTransactionCall(node.parent)); };
    const exitFn = () => { stack.pop(); };
    return {
      ArrowFunctionExpression: enterFn, "ArrowFunctionExpression:exit": exitFn,
      FunctionExpression: enterFn, "FunctionExpression:exit": exitFn,
      FunctionDeclaration: enterFn, "FunctionDeclaration:exit": exitFn,
      AwaitExpression(node) {
        if (stack.length && stack[stack.length - 1]) context.report({ node, messageId: "noAwait" });
      },
    };
  },
};
```

`apps/server/eslint.config.js`:

```js
import tseslint from "typescript-eslint";
import noAwaitInTransaction from "./eslint-rules/no-await-in-transaction.js";

export default tseslint.config(
  { ignores: ["src/db/migrations/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    plugins: { local: { rules: { "no-await-in-transaction": noAwaitInTransaction } } },
    rules: { "local/no-await-in-transaction": "error" },
  },
);
```

`apps/server/test/lint-rule.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "../eslint-rules/no-await-in-transaction.js";

const linter = new Linter({ configType: "flat" });
const config = [{
  files: ["**/*.ts"],
  languageOptions: { parser: tsParser },
  plugins: { local: { rules: { "no-await-in-transaction": rule } } },
  rules: { "local/no-await-in-transaction": "error" },
}];
const lint = (code: string) => linter.verify(code, config, "x.ts");

describe("local/no-await-in-transaction", () => {
  it("flags await inside db.transaction(async () => …)", () => {
    const out = lint(`db.transaction(async (tx) => { await fetch("x"); tx.run(); });`);
    expect(out).toHaveLength(1);
    expect(out[0]!.messageId).toBe("noAwait");
  });
  it("flags await inside a nested block of the callback", () => {
    expect(lint(`db.transaction(async (tx) => { if (a) { for (const x of y) { await x; } } });`)).toHaveLength(1);
  });
  it("allows await outside", () => {
    expect(lint(`await db.transaction((tx) => { tx.run(); });`)).toHaveLength(0);
  });
  it("allows await in a function defined inside but not the callback itself", () => {
    expect(lint(`db.transaction((tx) => { const later = async () => { await x; }; tx.run(); });`)).toHaveLength(0);
  });
});
```

The fourth case passes because the inner arrow's parent is not a transaction call, so its own stack entry is `false`. Add `@typescript-eslint/parser` to devDependencies if `typescript-eslint` does not already expose it. Run `bun test test/lint-rule.test.ts` → PASS; run `pnpm --filter @storylane/server lint` → clean.

- [ ] **Step 7: Type-level test**

`apps/server/test/types.test-d.ts` (checked by `tsc --noEmit`, not executed):

```ts
import { scopedItems } from "../src/db/schema";
import { loadInProject, type ProjectTx } from "../src/db/tx";
import type { Db } from "../src/db/client";

declare const db: Db;
declare const tx: ProjectTx;

// OK: repository functions take a ProjectTx.
loadInProject(tx, scopedItems, "id");

// @ts-expect-error a raw Db is not a ProjectTx — services cannot bypass authorization.
loadInProject(db, scopedItems, "id");

// @ts-expect-error ProjectTx cannot be constructed outside tx.ts.
new ProjectTx();
```

Run `pnpm --filter @storylane/server typecheck` → passes (both `@ts-expect-error` lines must be errors, otherwise tsc reports "unused @ts-expect-error").

- [ ] **Step 8: Commit**

```bash
git add apps/server/src apps/server/test apps/server/eslint-rules apps/server/eslint.config.js apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): ProjectTx authorization core, permission matrix route test, fail-closed middleware and no-await-in-transaction lint (TASK-240)"
```

Ask the owner to run the `authz-reviewer` agent on this commit (or run it yourself if the session allows agents) and record the result in TASK-240 notes; mark Done.

---

### Task 6: apps/web skeleton (TASK-241)

**Files:**
- Create: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/src/App.test.tsx`, `apps/web/src/test-setup.ts`
- Modify: `apps/server/src/app.ts` (static serving), `apps/server/src/config.ts` (no change; static root derived from `import.meta.dir`), `apps/server/Dockerfile`, `apps/server/test/static.test.ts` (new)

**Interfaces:**
- Consumes: `/healthz`.
- Produces: `apps/web/dist/` served at `/` with SPA fallback; `/api/*` unaffected.

- [ ] **Step 1: Package**

`apps/web/package.json`:

```json
{
  "name": "@storylane/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src"
  },
  "dependencies": { "react": "^19", "react-dom": "^19" },
  "devDependencies": {
    "@tailwindcss/vite": "^4", "tailwindcss": "^4",
    "@testing-library/jest-dom": "^6", "@testing-library/react": "^16",
    "@types/react": "^19", "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^6", "jsdom": "^29",
    "typescript": "^5", "vite": "latest", "vitest": "^4",
    "eslint": "^9", "typescript-eslint": "latest", "eslint-plugin-react-hooks": "latest"
  }
}
```

Pin `latest` after `pnpm install` as in Task 3.

`apps/web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000", "/healthz": "http://localhost:3000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
```

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], globals: false },
});
```

`src/test-setup.ts`: `import "@testing-library/jest-dom/vitest";`

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Storylane</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Failing component test**

`src/App.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { App } from "./App";

afterEach(() => vi.restoreAllMocks());

describe("App shell", () => {
  it("shows the server status from /healthz", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/server: ok/i)).toBeInTheDocument());
  });
  it("shows unavailable when /healthz fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/server: unavailable/i)).toBeInTheDocument());
  });
});
```

Run `pnpm --filter @storylane/web test` → FAIL.

- [ ] **Step 3: App, main, css**

`src/App.tsx`:

```tsx
import { useEffect, useState } from "react";

type Health = "checking" | "ok" | "unavailable";

export function App() {
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    let cancelled = false;
    fetch("/healthz")
      .then((r) => r.json())
      .then((j: { status: string }) => { if (!cancelled) setHealth(j.status === "ok" ? "ok" : "unavailable"); })
      .catch(() => { if (!cancelled) setHealth("unavailable"); });
    return () => { cancelled = true; };
  }, []);
  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Storylane</h1>
      <p className="text-sm text-neutral-600">Self-hosted tracker — rewrite in progress.</p>
      <p data-testid="health" className="font-mono text-sm">server: {health}</p>
    </main>
  );
}
```

`src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
```

`src/index.css`: `@import "tailwindcss";`

`tsconfig.json`: standard Vite React TS config (`"jsx": "react-jsx"`, `"moduleResolution": "bundler"`, `"strict": true`, `"types": ["vite/client", "@testing-library/jest-dom"]`, include `src`).

Run tests → PASS. Run `pnpm --filter @storylane/web build` → `dist/index.html` exists.

- [ ] **Step 4: Static serving from the server + failing test**

`apps/server/test/static.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestApp, makeTestDb } from "./harness";

describe("static SPA serving", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>shell</title>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  const { app } = makeTestApp(makeTestDb(), undefined, { staticRoot: dir });

  it("serves index.html at /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
  });
  it("serves assets", async () => {
    const res = await app.request("/assets/app.js");
    expect(res.status).toBe(200);
  });
  it("falls back to index.html for unknown non-API paths", async () => {
    const res = await app.request("/projects/abc/board");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("shell");
  });
  it("keeps JSON 404 for unknown /api paths", async () => {
    const res = await app.request("/api/nothing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
```

In `app.ts`: `AppDeps.staticRoot?: string` (default `fileURLToPath(new URL("../../web/dist", import.meta.url))`). After the API routes:

```ts
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
// …
if (existsSync(deps.staticRoot)) {
  app.use("/*", serveStatic({ root: deps.staticRoot }));
  app.get("/*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
    return c.html(Bun.file(join(deps.staticRoot, "index.html")).text());
  });
}
```

`serveStatic({ root })` from `hono/bun` treats `root` relative to the process cwd on some versions — if the test fails with 404 on `/assets/app.js`, pass an absolute path through `rewriteRequestPath` or use `serveStatic({ root: relative(process.cwd(), deps.staticRoot) })`. `makeTestApp` gains a third parameter forwarded as `staticRoot`. Because `app.notFound` already answers JSON 404, the explicit `/api/` check inside the fallback keeps that behaviour when the static block is active. Update `ROUTE_ACTIONS` with `"GET /*": "public"` only if `app.routes` lists it (the matrix test tells you).

Run `bun test` → PASS.

- [ ] **Step 5: Dockerfile builds the SPA**

Add a `web` stage to `apps/server/Dockerfile` before `runtime`:

```dockerfile
FROM base AS web
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @storylane/web
COPY apps/web ./apps/web
RUN pnpm --filter @storylane/web build
```

and in `runtime`: `COPY --from=web /app/apps/web/dist ./apps/web/dist`. Rebuild, run, `curl -s localhost:3000/ | head -c 200` shows the shell HTML; size still under 250 MB.

- [ ] **Step 6: Commit**

```bash
git add apps/web apps/server/src/app.ts apps/server/test apps/server/Dockerfile pnpm-lock.yaml
git commit -m "feat(web): Vite + React shell served by the server with SPA fallback (TASK-241)"
```

Mark TASK-241 Done.

---

### Task 7: CI publishes the image (TASK-242)

**Files:**
- Create: `.github/workflows/publish.yml`
- Modify: `README.md`, `apps/server/Dockerfile` (labels)

- [ ] **Step 1: Workflow**

```yaml
name: publish

on:
  push:
    branches: [main, rewrite/self-hosted]
    tags: ["v*"]
  pull_request:

permissions:
  contents: read
  packages: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: oven-sh/setup-bun@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @storylane/core test
      - run: pnpm --filter @storylane/server lint
      - run: pnpm --filter @storylane/server typecheck
      - run: cd apps/server && bun test
      - run: pnpm --filter @storylane/web test
      - run: pnpm --filter @storylane/web build

  image:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/storylane
          tags: |
            type=raw,value=edge,enable=${{ github.ref == 'refs/heads/main' }}
            type=raw,value=rewrite,enable=${{ github.ref == 'refs/heads/rewrite/self-hosted' }}
            type=semver,pattern={{version}}
            type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}
          labels: |
            org.opencontainers.image.revision=${{ github.sha }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/server/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            GIT_SHA=${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

`ghcr.io/<owner>/storylane` is lower-cased by ghcr automatically; `github.repository_owner` is `l4l4dev`. Add to the Dockerfile `runtime` stage: `ARG GIT_SHA=dev` and `ENV STORYLANE_GIT_SHA=$GIT_SHA` (the settings page reads it in phase 1). The `rewrite` tag lets the owner pull a phase-0 image before the merge to `main`.

Validate: `pnpm dlx actionlint` (or `brew install actionlint; actionlint`) → no findings.

- [ ] **Step 2: README**

Under the one-liner from Task 1 add: "Images: `ghcr.io/l4l4dev/storylane:edge` (main), `:rewrite` (rewrite branch), `:latest` and `:<version>` (releases)." plus a badge-free "Build status: see Actions → publish".

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish.yml README.md apps/server/Dockerfile
git commit -m "ci: test and publish the multi-arch image to ghcr (TASK-242)"
```

The first real run needs the owner to push the branch; note in TASK-242: "push is owner-initiated; verify `docker manifest inspect ghcr.io/l4l4dev/storylane:rewrite` lists amd64 and arm64 after the first run, then set the package visibility to public in GitHub → Packages". Mark Done after the workflow file passes actionlint; the manifest check is the owner's acceptance step.

---

### Task 8: Distribution skeleton (TASK-243)

**Files:**
- Create: `docker-compose.yml`, `Caddyfile`, `.env.example`, `INSTALL.md`
- Modify: `README.md` (link INSTALL.md)

- [ ] **Step 1: compose + Caddy**

`docker-compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/l4l4dev/storylane:${STORYLANE_IMAGE_TAG:-latest}
    restart: unless-stopped
    environment:
      STORYLANE_PORT: "3000"
      STORYLANE_DATA_DIR: /data
      STORYLANE_BASE_URL: ${STORYLANE_BASE_URL:-}
      STORYLANE_TRUST_PROXY: ${STORYLANE_TRUST_PROXY:-false}
    volumes:
      - storylane-data:/data
    ports:
      - "${STORYLANE_HOST_PORT:-3000}:3000"

  caddy:
    image: caddy:2
    profiles: ["https"]
    restart: unless-stopped
    depends_on: [app]
    environment:
      DOMAIN: ${DOMAIN:?set DOMAIN in .env}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config

volumes:
  storylane-data:
  caddy-data:
  caddy-config:
```

`Caddyfile`:

```
{$DOMAIN} {
    encode zstd gzip
    reverse_proxy app:3000
}
```

`.env.example`:

```
# Copy to .env and edit. Every value is optional except DOMAIN when you use the https profile.

# Public hostname. Required for `docker compose --profile https up -d`.
DOMAIN=tracker.example.org

# Tell the app its public URL so cookies are marked Secure and links are absolute.
STORYLANE_BASE_URL=https://tracker.example.org

# Trust X-Forwarded-* from the reverse proxy (true when Caddy fronts the app).
STORYLANE_TRUST_PROXY=true

# Host port when running without the https profile (plain http on the LAN).
STORYLANE_HOST_PORT=3000

# Image tag: latest (releases), edge (main), or a version like 0.2.0.
STORYLANE_IMAGE_TAG=latest
```

Check: `docker compose config` renders; `docker compose up -d` (no profile) → `curl localhost:3000/healthz`; `docker compose --profile https config` requires `DOMAIN`.

- [ ] **Step 2: INSTALL.md**

Sections, each with the exact commands:

1. **Try it in 60 seconds** — the `docker run` one-liner, open `http://localhost:3000`, note that the setup page arrives in phase 1 (for now the shell shows server status).
2. **Run it for a team with HTTPS** — `curl -O` the compose file, Caddyfile and `.env.example`; `cp .env.example .env`; set `DOMAIN`, `STORYLANE_BASE_URL`, `STORYLANE_TRUST_PROXY=true`; `docker compose --profile https up -d`; DNS must point at the host before Caddy can get a certificate.
3. **Run it on a LAN without a domain** — no profile, `STORYLANE_HOST_PORT`, plain http; cookies are not marked Secure in this mode.
4. **Upgrade** — `docker compose pull`, `docker compose up -d`; the server writes `/data/backups/pre-<version>.db` before migrating; if the container exits with `migration failed`, restore that file (section 6) and report the issue.
5. **Back up** — `docker compose exec app bun src/index.ts backup /data/backups/manual-$(date +%F).db`; copy the file off the host; cron example `0 3 * * * cd /opt/storylane && docker compose exec -T app bun src/index.ts backup /data/backups/nightly-$(date +\%F).db`; keep 7.
6. **Restore** — stop the app, replace `storylane.db` inside the volume (`docker run --rm -v storylane-data:/data -v $PWD:/host alpine cp /host/backup.db /data/storylane.db`, and delete `storylane.db-wal` / `-shm` if present), start again.
7. **Rules** — one running server per data volume; never place `/data` on NFS/SMB; the four environment variables and their defaults.
8. **Uninstall** — `docker compose down -v` deletes the data volume; say so plainly.

Link `INSTALL.md` from `README.md`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml Caddyfile .env.example INSTALL.md README.md
git commit -m "docs: compose file with Caddy profile, env example and INSTALL guide (TASK-243)"
```

Mark TASK-243 Done. Phase 0 exit check: fresh clone of the branch, `docker build -f apps/server/Dockerfile -t storylane:p0 .`, `docker run --rm -d -p 3000:3000 -v p0:/data storylane:p0`, `curl -s localhost:3000/healthz` → `{"status":"ok"}`; `cd apps/server && bun test` → all green including the matrix test. Then ask the owner to run `/code-review high` on `rewrite/self-hosted` before merging to `main`.
