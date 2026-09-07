# Self-host rewrite — Phase 1 (Vertical slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `docker run` instance usable end to end by a stranger: first-run setup token → admin → project with its state columns → stories on a board that can be created, dragged and transitioned, with invite links, admin-minted reset links and SSE-driven refresh.

**Architecture:** Routes stay thin and call services; every service takes a `ProjectTx` obtained from `withProject(db, actor, projectId, action, fn)` and never a raw `db`. Authentication is hand-written (argon2id passwords, SHA-256-hashed session ids in an `HttpOnly` cookie); the fail-closed middleware now verifies that the request's own project id was authorized, and a lint rule keeps the drizzle handle (`.tx`) inside `src/db` and `src/services`. Mutating routes publish `{type:"project.changed", projectId}` on an in-process bus after the transaction commits; the SPA (Vite + React 19) refetches on that signal.

**Tech Stack:** Bun 1.4 (`bun test`, `Bun.password` argon2id, `Bun.randomUUIDv7()`, `bun:sqlite` synchronous transactions), Hono (incl. `hono/streaming` SSE), Drizzle ORM + Drizzle Kit (sqlite dialect), pnpm workspaces, Vite + React 19 + Tailwind v4, `wouter` (router), `@dnd-kit/core` + `@dnd-kit/sortable` (drag), native `EventSource` (SSE client), hand-written in-memory rate limiter.

**Spec:** `docs/design/2026-09-05-self-host-rewrite-design.md` (sections 3, 4, 5, 6, 7, 9) plus `spec/permissions.md`, `spec/data-model.md`, `spec/features.md` "Story Management", `spec/screens.md` "Board layout", `spec/ux-principles.md`. Backlog: TASK-245 … TASK-254 (milestone m-9). Predecessor plan: `docs/plans/2026-09-06-self-host-phase-0.md`; its rulings are recorded in `.superpowers/sdd/2026-09-06-self-host-phase-0/progress.md` and must not be contradicted.

## Global Constraints

- Branch: all work on `rewrite/phase-1` (HEAD `3f5177c`), which descends from `rewrite/self-hosted`. Phase 0 is **not** merged to `main` — never rebase onto or diff against `main`. Never push unless the owner asks.
- Repo rules: no `git add -A` / `git add .` (always list paths); never chain state-changing commands with `&&` (one command per line); Conventional Commits; every commit message ends with the two trailers
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01KvKK1V4572U45YqEeE1MPt
  ```
- This repository is public: no personal name or private email anywhere git-tracked. Test users are `@example.test` (`owner@example.test`, `member@example.test`, …); the owner is `@l4l4dev`.
- No `console.log` in committed code — use the injected `Logger` (`src/log.ts`).
- After any change under `apps/server/src/auth`, `apps/server/src/authz`, `apps/server/src/db/tx.ts` or `spec/permissions.md`, run the `authz-reviewer` agent and record the verdict in the Backlog task notes before marking it Done.
- Any task that changes user-facing UI ends with a fable-advisor design review against `spec/ux-principles.md` (`/advisor` skill), then the owner's manual browser verification.
- `bun:sqlite` transactions are synchronous: no `await` inside `db.transaction()` / `withProject()` / `withTwoProjects()` callbacks (`local/no-await-in-transaction` fails the build; `NotPromise<T>` rejects async callbacks at compile time). Hash passwords **before** opening a transaction and pass the hash in.
- Every writing transaction uses `behavior: "immediate"` (`withProject` picks it from `isWrite(action)`).
- Conventions: ids `text` UUIDv7 via `newId()`; instants `integer` UTC milliseconds; calendar dates `text` `YYYY-MM-DD`; booleans `integer` 0/1; enums `text` + CHECK with the value list in one TS module; JSON stored as `text`, never used in `WHERE`.
- Sequences (`stories.number`) are `MAX(x)+1` **inside** the transaction; dense reordering always goes through `reorder(tx, table, scope, orderedIds)` (two-step `-rank-1` then `rank`).
- Migrations are generated (`pnpm --filter @storylane/server db:generate`), forward-only, never edited once shipped. `0000` and `0001` are shipped. Drizzle Kit does not emit triggers — hand-append trigger SQL to the *newly generated, not yet committed* file, separated by `--> statement-breakpoint`.
- Response codes, precedence `401 (anon) → 401 (disabled) → 404 (missing / non-member) → 409 (archived write) → 403`: 401 unauthenticated, 403 member-level denial, 404 non-member or row outside the project, 409 `project_archived` / `setup_required` / `last_owner`, 500 `authorization_missing` when a project-scoped response was produced without authorizing that project.
- Environment variables (design §7), no other configuration source: `STORYLANE_PORT` (3000), `STORYLANE_DATA_DIR` (/data), `STORYLANE_BASE_URL` (optional), `STORYLANE_TRUST_PROXY` (false).
- Cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` **only** when the request is HTTPS (`STORYLANE_BASE_URL` is https, or `X-Forwarded-Proto: https` with `STORYLANE_TRUST_PROXY=true`) — a fixed `Secure` breaks login on `http://192.168.x.x:3000`.
- Every secret (session id, invite token, reset token, setup token) is stored **only** as its SHA-256 hex hash; clear text exists in the cookie, the link, or the boot log, never in a row. No SMTP; passkeys and PATs are out of phase-1 scope.
- Tests: server `bun test` from `apps/server`; web `vitest` from `apps/web`; core `vitest` from `packages/core`. A task is not done until its own tests pass, `pnpm --filter @storylane/server lint`, `pnpm --filter @storylane/server typecheck` and `pnpm --filter @storylane/web test` are green, and the commit is made.
- Every route registered in `app.ts` needs a `ROUTE_ACTIONS` entry (the matrix test fails otherwise) and, when it is project-scoped, a passing five-actor row.
- Preserve the `<!-- hook:end -->` marker in `ARCHITECTURE.md`.

---

## Permission fixture additions

`spec/permissions.md` and `spec/fixtures/permissions.json` must stay byte-equivalent (`packages/core/src/permissions.test.ts` parses the markdown table and compares). Phase 1 adds **one** project-scoped action row; everything else it needs already exists.

| action | anonymous | non-member | viewer | member | owner | why |
|---|---|---|---|---|---|---|
| `invite:read` | 401 | 404 | 403 | 403 | 200 | Listing a project's pending invitations (who was invited, with which role) is owner-only bookkeeping; `member:read` is 200 for viewers and must not carry it. The name ends in `:read` so `isWrite()` classifies it as a read and an archived project still serves it. |

Admin-plane actions (`fixture.adminActions`, unchanged list): phase 1 exercises **`user:reset-link`** only. `user:list`, `user:create`, `user:deactivate` and `instance:settings` stay declared and unrouted until phase 3. Admin routes carry the manifest rule `"admin"`: anonymous → 401, signed-in non-admin → 403, admin → 2xx. They are never matrix rows because they do not depend on project membership.

Reused rows (no change): `project:read`, `project:update`, `project:archive` (archive **and** un-archive), `project:delete`, `state:read`, `state:write`, `state:delete`, `story:read` (board + list), `story:write` (create, update, transition, move, reorder), `story:delete`, `member:read`, `member:invite` (mint **and** revoke — the same authority).

Routes outside the project net declare a manifest rule instead of an action, and `spec/permissions.md` gains a short section listing them: `"public"` = `POST /api/auth/login`, `GET|POST /api/invites/:token…`, `GET|POST /api/auth/reset/:token`; `"self"` = `GET /api/me`, `POST /api/me/password`, `POST /api/auth/logout`, `GET /api/projects`, `POST /api/projects` (any signed-in user may create a project — a create has no role in a project that does not exist yet, so it is not a matrix row); `"admin"` = `POST /api/admin/users/:userId/reset-link`; `"setup"` = `GET|POST /api/setup`.

Two consumers must be updated in the same commit as the fixture (Task 8):
- `spec/permissions.md` table + the new "Routes outside the matrix" section.
- `apps/server/test/permissions.test.ts` `READ_ACTIONS` — it pins the read/write split explicitly, so `"invite:read"` must be added there or the suite fails.

---

## File map after Phase 1

```
apps/server/
  eslint-rules/no-await-in-transaction.js         (phase 0)
  eslint-rules/no-project-tx-escape.js            Task 1  — bans `.tx` outside src/db, src/services
  eslint.config.js                                Task 1  — registers the new rule with its dir scope
  src/id.ts                                       Task 1  — newId() = Bun.randomUUIDv7()
  src/config.ts  src/log.ts  src/http-error.ts    (phase 0)
  src/app.ts                                      grows: bus, csrfGuard, setupGate, all route groups
  src/index.ts                                    grows: ensureSetupToken, EventBus, actorFromRequest
  src/authz/permissions.ts                        (phase 0; fixture gains invite:read)
  src/authz/context.ts                            Task 1  — authorized project-id set (was a counter)
  src/authz/middleware.ts                         Task 1  — failClosed checks c.req.param("id") ∈ set
  src/authz/route-manifest.ts                     grows one entry per route
  src/authz/admin.ts                              Task 8  — requireAdmin(actor)
  src/auth/password.ts                            Task 3a — Bun.password argon2id
  src/auth/tokens.ts                              Task 3a — newSecret / hashToken / tokensMatch
  src/auth/sessions.ts                            Task 3a — create / resolve / delete / revoke
  src/auth/cookies.ts                             Task 3a — Secure-when-HTTPS cookie writing
  src/auth/csrf.ts                                Task 3b — Origin / Sec-Fetch-Site + JSON guard
  src/auth/rate-limit.ts                          Task 3b — fixed-window limiter + clientIp
  src/auth/actor.ts                               Task 3b — cookie → Actor, idle-expiry refresh
  src/setup/setup-token.ts                        Task 4  — mint/consume the one-time setup token
  src/setup/gate.ts                               Task 4  — 409 setup_required while no user exists
  src/events/bus.ts                               Task 7  — EventBus (in-process, per project)
  src/events/emit.ts                              Task 7  — withProjectChange(): commit then publish
  src/db/tx.ts                                    Task 1  — nesting guard, UserActor, NotPromise export
  src/db/schema/{meta,auth,projects}.ts           (phase 0)
  src/db/schema/activity.ts                       Task 1  — activity_logs
  src/db/schema/sessions.ts                       Task 2  — sessions, invites, reset_tokens
  src/db/schema/board.ts                          Task 2  — project_states, stories
  src/db/migrations/0002_*.sql                    Task 1  — activity_logs
  src/db/migrations/0003_*.sql                    Task 2  — auth + board tables + guard triggers
  src/services/activity.ts                        Task 1  — recordActivity(scope, entry)
  src/services/projects.ts                        Task 1 (readProject) / Task 5 (create, list, patch)
  src/services/states.ts                          Task 5  — CRUD + seedDefaultStates + reorder
  src/services/stories.ts                         Task 6  — create/update/move/delete + readBoard
  src/services/setup.ts                           Task 4  — completeSetup
  src/services/invites.ts                         Task 8  — mint/list/revoke/preview/accept
  src/services/reset.ts                           Task 8  — mint/preview/consume reset token
  src/routes/healthz.ts                           (phase 0)
  src/routes/projects.ts                          Task 5  — projects + states routes
  src/routes/stories.ts                           Task 6  — stories + board routes
  src/routes/auth.ts                              Task 3b — login/logout/me/password
  src/routes/setup.ts                             Task 4  — GET/POST /api/setup
  src/routes/events.ts                            Task 7  — SSE stream
  src/routes/invites.ts                           Task 8  — project invites + token endpoints
  src/routes/admin.ts                             Task 8  — reset-link minting
  test/harness.ts                                 grows: bus, seedState/seedStory, login helpers
  test/matrix-fixtures.ts                         Task 1  — extra params / bodies / streaming flags
  test/*.test.ts                                  one per task
apps/web/
  src/main.tsx  src/index.css                     (phase 0; main.tsx gains the Router)
  src/app-routes.tsx                              Task 9a — wouter route table
  src/lib/api.ts                                  Task 9a — apiFetch + ApiError
  src/lib/use-resource.ts                         Task 9a — fetch/refetch hook
  src/lib/session.tsx                             Task 9a — SessionProvider + useSession
  src/lib/use-project-events.ts                   Task 9b — EventSource subscription
  src/lib/board-ordering.ts                       Task 9b — pure move/reorder computation
  src/pages/{SetupPage,LoginPage,InviteAcceptPage,ResetPage}.tsx      Task 9a
  src/pages/{ProjectsPage,BoardPage}.tsx                              Task 9b
  src/components/{BoardColumn,StoryCard,QuickAddCard}.tsx             Task 9b
  src/**/*.test.tsx(x)                            with each web task
packages/core/src/points.ts                       Task 6  — points/estimation gate helpers
spec/permissions.md  spec/fixtures/permissions.json                   Task 8 (invite:read)
spec/data-model.md                                Task 2 (SQLite wording) / Task 10 (prose sweep)
INSTALL.md  README.md                             Task 10
```

---

### Task 1a: Authz hardening — project-scoped store, nesting guard, `.tx` lint (TASK-245)

Phase 0's fail-closed store only counted authorizations, so a handler that authorized project A and then read project B through a raw `db` still answered 200. This half makes the store project-id-aware, forbids nesting, bans the drizzle handle outside `src/db` / `src/services`, and teaches the route matrix to build valid requests for parameterized routes. Task 1b adds the services layer on top; both halves belong to Backlog TASK-245.

**Files:**
- Create: `apps/server/eslint-rules/no-project-tx-escape.js`, `apps/server/test/matrix-fixtures.ts`, `apps/server/test/tx-nesting.test.ts`, `apps/server/test/tx-escape-lint.test.ts`
- Modify: `apps/server/src/authz/context.ts`, `apps/server/src/authz/middleware.ts`, `apps/server/src/db/tx.ts`, `apps/server/eslint.config.js`, `apps/server/test/route-matrix.test.ts`

**Interfaces:**
- Consumes: `Db`, `HttpError`, `withProject`, `withTwoProjects`, `ProjectTx`, `Actor`, `makeTestDb()`, `makeTestApp()`, `seedUser()`, `seedProject()` (all phase 0).
- Produces:
  ```ts
  // src/authz/context.ts
  export function noteAuthorized(projectId: string): void;
  export function runAuthzScope<T>(fn: () => Promise<T>): Promise<{ result: T; authorized: ReadonlySet<string> }>;
  // src/db/tx.ts (additions; withProject/withTwoProjects throw Error("withProject cannot be nested"))
  export type UserActor = Extract<Actor, { kind: "user" }>;
  export type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;
  // test/matrix-fixtures.ts
  export interface MatrixFixture { params?: Record<string, string>; body?: unknown; stream?: boolean }
  /** Grows one field per task as parameterized routes land (stateId, storyId, inviteId, userId). */
  export interface MatrixContext { projectId: string }
  export function matrixFixtures(ctx: MatrixContext): Record<string, MatrixFixture>;   // keyed "METHOD /path", exactly as ROUTE_ACTIONS
  ```

- [ ] **Step 1: Write the failing authz-store test**

Add to `apps/server/test/route-matrix.test.ts` (keep the existing describes):

```ts
describe("project-scoped fail-closed", () => {
  const asOwner = { "x-test-actor": JSON.stringify(ownerA) };

  it("turns a handler that authorized another project into 500", async () => {
    const other = seedProject(db, ownerA);
    const { app: crossed } = makeTestApp(db, (a) =>
      a.get("/api/projects/:id/crossed", (c) =>
        // Authorizes `other`, answers for c.req.param("id") — the phase-0 counter accepted this.
        c.json(withProject(db, ownerA, other, "project:read", (tx) => ({ id: tx.projectId }))),
      ),
    );
    const res = await crossed.request(`/api/projects/${projectId}/crossed`, { headers: asOwner });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "authorization_missing" });
  });

  it("accepts a handler that authorized the requested project", async () => {
    const { app: good } = makeTestApp(db, (a) =>
      a.get("/api/projects/:id/same", (c) =>
        c.json(withProject(db, ownerA, c.req.param("id"), "project:read", (tx) => ({ id: tx.projectId }))),
      ),
    );
    const res = await good.request(`/api/projects/${projectId}/same`, { headers: asOwner });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/server` then `bun test test/route-matrix.test.ts`
Expected: FAIL — "turns a handler that authorized another project into 500" gets 200 (the counter is 1).

- [ ] **Step 3: Make the store project-id-aware**

`src/authz/context.ts` — replace the counter with a set:

```ts
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The project ids authorized while serving one request. Only authorizeIn writes to it,
 * so a handler cannot assert its own innocence. Module-private: reachable only through
 * noteAuthorized / runAuthzScope.
 */
const authzScope = new AsyncLocalStorage<{ authorized: Set<string> }>();

/** No store (CLI, worker, a test calling withProject directly) → nothing to record. */
export function noteAuthorized(projectId: string): void {
  authzScope.getStore()?.authorized.add(projectId);
}

export async function runAuthzScope<T>(fn: () => Promise<T>): Promise<{ result: T; authorized: ReadonlySet<string> }> {
  const store = { authorized: new Set<string>() };
  const result = await authzScope.run(store, fn);
  return { result, authorized: store.authorized };
}
```

`src/authz/middleware.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import { runAuthzScope } from "./context";

/**
 * Fail closed: a successful response under /api/projects/:id/** must have authorized
 * *that* project id. Authorizing a different project (or none) answers 500.
 */
export function failClosed(): MiddlewareHandler {
  return async (c, next) => {
    const { authorized } = await runAuthzScope(() => next());
    const requested = c.req.param("id");
    // Only a success can leak data; the 401/403/404/409 authorizeIn raises never gets here authorized.
    if (c.res.status < 400 && (requested === undefined || !authorized.has(requested))) {
      c.res = c.json({ error: "authorization_missing" }, 500);
    }
  };
}
```

In `src/db/tx.ts`, `authorizeIn` becomes `noteAuthorized(projectId)` instead of `noteAuthorized()`.

- [ ] **Step 4: Run to verify both cases pass**

Run: `bun test test/route-matrix.test.ts`
Expected: PASS (all pre-existing cases plus the two new ones).

- [ ] **Step 5: Write the failing nesting test**

`apps/server/test/tx-nesting.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedProject, seedUser } from "./harness";
import { withProject, withTwoProjects, type Actor } from "../src/db/tx";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;
let pA: string;
let pB: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  pA = seedProject(db, owner);
  pB = seedProject(db, owner);
});

describe("withProject nesting", () => {
  it("throws a clear error when nested", () => {
    expect(() =>
      withProject(db, owner, pA, "project:read", () => withProject(db, owner, pB, "project:read", () => 1)),
    ).toThrow("withProject cannot be nested");
  });

  it("throws when withTwoProjects is nested inside withProject", () => {
    expect(() =>
      withProject(db, owner, pA, "project:read", () =>
        withTwoProjects(db, owner, pA, pB, "story:move-cross-project", () => 1),
      ),
    ).toThrow("withProject cannot be nested");
  });

  it("releases the guard after a callback throws, so the next call still works", () => {
    expect(() =>
      withProject(db, owner, pA, "story:write", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(withProject(db, owner, pA, "project:read", (tx) => tx.projectId)).toBe(pA);
  });

  it("releases the guard after an authorization failure", () => {
    const outsider = seedUser(db, "outsider@example.test");
    expect(() => withProject(db, outsider, pA, "project:read", () => 1)).toThrow();
    expect(withProject(db, owner, pA, "project:read", (tx) => tx.projectId)).toBe(pA);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test test/tx-nesting.test.ts`
Expected: FAIL — the nested call currently commits the outer transaction instead of throwing.

- [ ] **Step 7: Add the nesting guard**

In `src/db/tx.ts`, above `withProject`:

```ts
/**
 * bun:sqlite has no savepoints here, so an inner transaction would commit the outer one.
 * One withProject per request: services take the ProjectTx they are given and never open
 * their own (design §3, phase-0 carry-over item 3).
 */
let transactionOpen = false;

function openTransaction<T>(run: () => T): T {
  if (transactionOpen) throw new Error("withProject cannot be nested");
  transactionOpen = true;
  try {
    return run();
  } finally {
    transactionOpen = false;
  }
}
```

Wrap both entry points — `withProject`'s body becomes:

```ts
export function withProject<T>(
  db: Db,
  actor: Actor,
  projectId: string,
  action: Action,
  fn: (tx: ProjectTx) => NotPromise<T>,
): T {
  const behavior = isWrite(action) ? "immediate" : "deferred";
  let ptx: ProjectTx | undefined;
  return openTransaction(() => {
    try {
      return db.transaction((tx) => {
        ptx = authorizeIn(tx, actor, projectId, action);
        return rejectThenable(fn(ptx));
      }, { behavior }) as T;
    } finally {
      ptx?._invalidate(CREATE_TOKEN);
    }
  });
}
```

`withTwoProjects` gets the same `openTransaction(() => { … })` wrapper. Also export the two types later tasks need:

```ts
export type UserActor = Extract<Actor, { kind: "user" }>;
export type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;
```

(delete the now-duplicated local declarations of both).

- [ ] **Step 8: Run to verify it passes**

Run: `bun test test/tx-nesting.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Write the failing lint-rule test**

`apps/server/test/tx-escape-lint.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import rule from "../eslint-rules/no-project-tx-escape.js";

const linter = new Linter({ configType: "flat" });
const config = [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tsParser },
    plugins: { local: { rules: { "no-project-tx-escape": rule } } },
    rules: { "local/no-project-tx-escape": "error" },
  },
];
const lint = (code: string) => linter.verify(code, config, "x.ts");

describe("local/no-project-tx-escape", () => {
  it("flags tx.tx member access", () => {
    const out = lint(`export const r = (tx) => tx.tx.select().from(t).all();`);
    expect(out).toHaveLength(1);
    expect(out[0]!.messageId).toBe("noEscape");
  });

  it("flags a renamed handle", () => {
    expect(lint(`const ptx = get(); ptx.tx.run("x");`)).toHaveLength(1);
  });

  it("flags computed access spelled as a literal", () => {
    expect(lint(`const ptx = get(); ptx["tx"].run("x");`)).toHaveLength(1);
  });

  it("allows this.tx inside the class that owns the handle", () => {
    expect(lint(`class P { get tx() { return this.#tx; } }`)).toHaveLength(0);
  });

  it("allows an unrelated property named txId", () => {
    expect(lint(`const a = row.txId;`)).toHaveLength(0);
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `bun test test/tx-escape-lint.test.ts`
Expected: FAIL — `Cannot find module "../eslint-rules/no-project-tx-escape.js"`.

- [ ] **Step 11: Write the rule and scope it in the flat config**

`apps/server/eslint-rules/no-project-tx-escape.js`:

```js
/**
 * The drizzle handle behind a ProjectTx is an escape hatch: with it a route can query any
 * table in any project. Keep it in src/db (the helpers) and src/services (the code that
 * runs inside a transaction); routes must call a service instead. The eslint config, not
 * this rule, decides which directories are exempt.
 * @type {import("eslint").Rule.RuleModule}
 */
export default {
  meta: {
    type: "problem",
    docs: { description: "no direct access to a ProjectTx's drizzle handle outside src/db and src/services" },
    schema: [],
    messages: {
      noEscape: "Do not reach for `.tx` here — call a service in src/services that takes the ProjectTx.",
    },
  },
  create(context) {
    const isTxKey = (node) =>
      (!node.computed && node.property.type === "Identifier" && node.property.name === "tx") ||
      (node.computed && node.property.type === "Literal" && node.property.value === "tx");
    return {
      MemberExpression(node) {
        if (!isTxKey(node)) return;
        if (node.object.type === "ThisExpression") return; // the ProjectTx class's own getter
        context.report({ node, messageId: "noEscape" });
      },
    };
  },
};
```

`apps/server/eslint.config.js`:

```js
import tseslint from "typescript-eslint";
import noAwaitInTransaction from "./eslint-rules/no-await-in-transaction.js";
import noProjectTxEscape from "./eslint-rules/no-project-tx-escape.js";

const local = {
  rules: {
    "no-await-in-transaction": noAwaitInTransaction,
    "no-project-tx-escape": noProjectTxEscape,
  },
};

export default tseslint.config(
  { ignores: ["src/db/migrations/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "test/**/*.ts", "eslint-rules/**/*.js"],
    plugins: { local },
    rules: { "local/no-await-in-transaction": "error" },
  },
  {
    // Only the layers that legitimately hold the handle are exempt. Tests are exempt too:
    // test/tx.test.ts asserts the helpers' behaviour through it on purpose.
    files: ["src/**/*.ts"],
    ignores: ["src/db/**", "src/services/**"],
    plugins: { local },
    rules: { "local/no-project-tx-escape": "error" },
  },
);
```

- [ ] **Step 12: Run the rule test and prove the scoping with fixtures**

Run: `bun test test/tx-escape-lint.test.ts`
Expected: PASS (5 tests).

Now prove the directory scoping on the real config (acceptance criterion #2). Write a temporary route file that violates the rule:

```bash
cat > /tmp/route-probe.ts <<'TS'
import { projects } from "../db/schema";
export const leak = (tx: { tx: { select: () => unknown } }) => tx.tx.select();
TS
cp /tmp/route-probe.ts apps/server/src/routes/_probe.ts
```

Run: `pnpm --filter @storylane/server exec eslint src/routes/_probe.ts`
Expected: 1 error `local/no-project-tx-escape`.

```bash
mv apps/server/src/routes/_probe.ts apps/server/src/services/_probe.ts
```

Run: `pnpm --filter @storylane/server exec eslint src/services/_probe.ts`
Expected: 0 errors (the import path is now wrong for TS, but eslint's parse does not resolve it).

```bash
rm apps/server/src/services/_probe.ts
```

Run: `pnpm --filter @storylane/server lint`
Expected: clean — if `src/routes/projects.ts` still touched `.tx` this is where it fails; Step 13 already moved it to a service.

- [ ] **Step 13: Upgrade the route matrix for parameterized routes**

Later tasks register routes with extra params (`:stateId`, `:storyId`), request bodies, and one streaming route. `test/matrix-fixtures.ts`:

```ts
/**
 * Per-route data the matrix needs to make a *valid* request, so a 4xx it asserts comes from
 * authorization and not from a missing path param or body. Keys match ROUTE_ACTIONS exactly.
 */
export interface MatrixFixture {
  /** Values for path params other than :id (which is always the seeded project). */
  params?: Record<string, string>;
  /** JSON body for non-GET routes. */
  body?: unknown;
  /** Server-sent-events route: cancel the body once the status is known. */
  stream?: boolean;
}

/**
 * Ids the fixtures need are seeded per test run, so this is a function of them rather than a
 * constant. Each later task adds the field its routes need (stateId, storyId, inviteId, userId).
 */
export interface MatrixContext {
  projectId: string;
}

export function matrixFixtures(_ctx: MatrixContext): Record<string, MatrixFixture> {
  return {};
}
```

In `test/route-matrix.test.ts`, build the fixtures once next to the seeds and replace the request construction inside the matrix loop with:

```ts
import { matrixFixtures } from "./matrix-fixtures";

const FIXTURES = matrixFixtures({ projectId });

// …inside the per-role `it`:
const fixture = FIXTURES[key] ?? {};
let url = path.replace(":id", projectId);
for (const [name, value] of Object.entries(fixture.params ?? {})) url = url.replace(`:${name}`, value);
expect(url).not.toContain("/:"); // a param with no fixture would make every row meaningless
const headers: Record<string, string> = actor.kind === "anonymous" ? {} : { "x-test-actor": JSON.stringify(actor) };
if (fixture.body !== undefined) headers["content-type"] = "application/json";
const res = await app.request(url, {
  method,
  headers,
  ...(fixture.body === undefined ? {} : { body: JSON.stringify(fixture.body) }),
});
if (fixture.stream) await res.body?.cancel();
const want = expected(rule, role);
if (want === 200) expect(res.status).toBeLessThan(300);
else expect(res.status).toBe(want);
```

Run: `bun test test/route-matrix.test.ts`
Expected: PASS (unchanged behaviour — `GET /api/projects/:id` has no fixture and needs none).

- [ ] **Step 14: Full verification**

Run these one at a time:

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green (85 pre-existing tests plus the new ones).

- [ ] **Step 15: Commit**

```bash
git add apps/server/src/authz apps/server/src/db/tx.ts apps/server/eslint-rules apps/server/eslint.config.js apps/server/test
```
```bash
git commit -m "feat(server): project-scoped fail-closed store, withProject nesting guard and the .tx escape lint (TASK-245)"
```

---

### Task 1b: Services skeleton with recordActivity (TASK-245)

**Files:**
- Create: `apps/server/src/id.ts`, `apps/server/src/db/schema/activity.ts`, `apps/server/src/services/activity.ts`, `apps/server/src/services/projects.ts`, `apps/server/test/activity.test.ts`
- Modify: `apps/server/src/db/schema/index.ts`, `apps/server/src/routes/projects.ts`, `ARCHITECTURE.md` (both sides of the marker)
- Generated: `apps/server/src/db/migrations/0002_*.sql`

**Interfaces:**
- Consumes: `ProjectTx`, `Tx`, `Actor`, `withProject` (Task 1a), `MemberRole` from `src/authz/permissions.ts`.
- Produces:
  ```ts
  // src/id.ts
  export function newId(): string;                       // UUIDv7, time-ordered
  // src/db/schema/activity.ts
  export const activityLogs;   // id, projectId, storyId, actorId, action, payload, createdAt
  // src/services/activity.ts
  export const ACTIVITY_ACTIONS: readonly [...];         // exact list in Step 3
  export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];
  export interface ActivityEntry { action: ActivityAction; storyId?: string | null; payload?: Record<string, unknown> | null }
  export interface BootstrapScope { readonly tx: Tx; readonly projectId: string; readonly actor: Actor }
  export type ActivityScope = ProjectTx | BootstrapScope;
  export function bootstrapScope(tx: Tx, projectId: string, actor: Actor): BootstrapScope;
  export function recordActivity(scope: ActivityScope, entry: ActivityEntry): string;   // returns the row id
  // src/services/projects.ts
  export interface ProjectDetail { id: string; name: string; description: string | null; archivedAt: number | null; role: MemberRole }
  export function readProject(tx: ProjectTx): ProjectDetail;
  ```

- [ ] **Step 1: Write the failing activity test**

`apps/server/src/id.ts` first (it is needed by the test's expectations of id shape):

```ts
/** UUIDv7 so ids sort by creation time (design §5). */
export function newId(): string {
  return Bun.randomUUIDv7();
}
```

`apps/server/test/activity.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, seedProject, seedUser } from "./harness";
import { withProject, type Actor } from "../src/db/tx";
import { activityLogs, projects } from "../src/db/schema";
import { recordActivity } from "../src/services/activity";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;
let projectId: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = seedProject(db, owner);
});

const rows = () => db.select().from(activityLogs).all();

describe("recordActivity", () => {
  it("writes project id, actor, action and JSON payload", () => {
    withProject(db, owner, projectId, "project:update", (tx) => {
      db.$client.run("update projects set name = 'renamed' where id = ?", [tx.projectId]);
      recordActivity(tx, { action: "project.updated", payload: { name: { from: "P", to: "renamed" } } });
    });
    const [row] = rows();
    expect(row!.projectId).toBe(projectId);
    expect(row!.actorId).toBe(owner.kind === "user" ? owner.userId : null);
    expect(row!.action).toBe("project.updated");
    expect(JSON.parse(row!.payload!)).toEqual({ name: { from: "P", to: "renamed" } });
    expect(row!.storyId).toBeNull();
    expect(row!.createdAt).toBeGreaterThan(0);
  });

  it("commits the change and its activity row together", () => {
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) => {
        tx.tx.update(projects).set({ name: "half-written" }).where(eq(projects.id, tx.projectId)).run();
        recordActivity(tx, { action: "project.updated", payload: null });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(rows()).toHaveLength(0);
    expect(db.select().from(projects).where(eq(projects.id, projectId)).get()!.name).toBe("P");
  });

  it("rejects an action name that is not in the vocabulary", () => {
    withProject(db, owner, projectId, "project:read", (tx) => {
      // @ts-expect-error not an ActivityAction
      expect(() => recordActivity(tx, { action: "story.exploded" })).toThrow(/unknown activity action/);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/activity.test.ts`
Expected: FAIL — `Cannot find module "../src/services/activity"`.

- [ ] **Step 3: Schema, migration and the service**

`src/db/schema/activity.ts`:

```ts
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { projects } from "./projects";
import { users } from "./auth";

/**
 * Written only by services/activity.ts recordActivity(). story_id has no FK: this table
 * ships one migration before `stories` exists, so the composite (story_id, project_id)
 * guard is a trigger added in 0003 instead (a table rebuild is the only alternative under
 * forward-only migrations).
 */
export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id"),
    actorId: text("actor_id").references(() => users.id),
    action: text("action").notNull(),
    payload: text("payload"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("activity_logs_project_created").on(t.projectId, t.createdAt)],
);
```

Add `export * from "./activity";` to `src/db/schema/index.ts`, then generate:

```bash
pnpm --filter @storylane/server db:generate
```

Expected: `src/db/migrations/0002_<name>.sql` creating `activity_logs` + its index.

`src/services/activity.ts`:

```ts
import { activityLogs } from "../db/schema";
import { newId } from "../id";
import { ProjectTx, type Actor, type Tx } from "../db/tx";

export const ACTIVITY_ACTIONS = [
  "project.created",
  "project.updated",
  "project.archived",
  "project.unarchived",
  "member.joined",
  "state.created",
  "state.updated",
  "state.reordered",
  "state.deleted",
  "story.created",
  "story.updated",
  "story.state_changed",
  "story.moved",
  "story.deleted",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEntry {
  action: ActivityAction;
  storyId?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Project creation and invite acceptance write activity before the actor is a member, so
 * withProject cannot authorize them; they pass this instead. Every other caller passes a
 * ProjectTx. Both shapes carry tx/projectId/actor, which is all this module needs.
 */
export interface BootstrapScope {
  readonly tx: Tx;
  readonly projectId: string;
  readonly actor: Actor;
}

export type ActivityScope = ProjectTx | BootstrapScope;

export function bootstrapScope(tx: Tx, projectId: string, actor: Actor): BootstrapScope {
  return { tx, projectId, actor };
}

const KNOWN = new Set<string>(ACTIVITY_ACTIONS);

/** The only writer of activity_logs. Runs inside the caller's transaction, never its own. */
export function recordActivity(scope: ActivityScope, entry: ActivityEntry): string {
  if (!KNOWN.has(entry.action)) throw new Error(`unknown activity action: ${entry.action}`);
  const id = newId();
  scope.tx
    .insert(activityLogs)
    .values({
      id,
      projectId: scope.projectId,
      storyId: entry.storyId ?? null,
      actorId: scope.actor.kind === "user" ? scope.actor.userId : null,
      action: entry.action,
      payload: entry.payload == null ? null : JSON.stringify(entry.payload),
      createdAt: Date.now(),
    })
    .run();
  return id;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/activity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Move the example route onto a service**

`src/services/projects.ts`:

```ts
import { eq } from "drizzle-orm";
import { projects } from "../db/schema";
import type { ProjectTx } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";

export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  archivedAt: number | null;
  role: MemberRole;
}

export function readProject(tx: ProjectTx): ProjectDetail {
  const row = tx.tx
    .select({ id: projects.id, name: projects.name, archivedAt: projects.archivedAt })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  // `description` arrives with migration 0003 (Task 2); until then it is always null.
  return { id: row.id, name: row.name, description: null, archivedAt: row.archivedAt, role: tx.role };
}
```

`src/routes/projects.ts` becomes:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { readProject } from "../services/projects";

export function projectRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono().get("/api/projects/:id", (c) =>
    c.json(withProject(db, actorOf(c), c.req.param("id"), "project:read", (tx) => readProject(tx))),
  );
}
```

Run: `bun test`
Expected: PASS (the whole suite; the route's shape changed only by gaining `description` and `role`).

- [ ] **Step 6: Document the invariants**

In `ARCHITECTURE.md`, **below** the `<!-- hook:end -->` marker, add to "Where things are":

```markdown
| Services (all project writes) | `apps/server/src/services/` |
| Activity log | `apps/server/src/services/activity.ts` (`recordActivity`, only writer) |
```

and in the "Invariants" block above the marker, extend the fail-closed bullet to its new meaning:

```markdown
- **Fail closed, per project.** A successful `/api/projects/:id/**` response must have authorized *that* project id (`src/authz/context.ts`); anything else is turned into 500 in every environment. Non-members get 404, never 403.
- **One `withProject` per request.** Nesting throws — there are no savepoints; services take the `ProjectTx` they are handed. Routes never touch `.tx` (`local/no-project-tx-escape`).
```

- [ ] **Step 7: Full verification**

Run these one at a time:

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green. `lint` is the check that `src/routes/projects.ts` no longer touches `.tx`.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/id.ts apps/server/src/db/schema apps/server/src/db/migrations apps/server/src/services apps/server/src/routes/projects.ts apps/server/test/activity.test.ts ARCHITECTURE.md
```
```bash
git commit -m "feat(server): activity_logs with recordActivity as its only writer, services layer skeleton (TASK-245)"
```

- [ ] **Step 9: authz-reviewer pass**

Dispatch the `authz-reviewer` agent on both TASK-245 commits (paths: `src/authz`, `src/db/tx.ts`, `src/services`). The prompt must include "do not run any database reset and do not modify the database". Record the verdict:

```bash
backlog task edit TASK-245 --append-notes "authz-reviewer: <verdict + findings>. Commits <sha-1a>, <sha-1b>."
```

Fix High/Important findings before marking Done.

---

### Task 2: Phase-1 schema and guard triggers (TASK-246)

**Files:**
- Create: `apps/server/src/db/schema/sessions.ts`, `apps/server/src/db/schema/board.ts`, `apps/server/test/schema-constraints.test.ts`
- Modify: `apps/server/src/db/schema/projects.ts` (three new columns), `apps/server/src/db/schema/index.ts`, `apps/server/test/harness.ts`, `spec/data-model.md` ("Position ordering invariant" + the composite-FK paragraph)
- Generated: `apps/server/src/db/migrations/0003_*.sql` (hand-extended with the triggers, before it is committed)

**Interfaces:**
- Consumes: `users`, `projects`, `projectMembers`, `activityLogs`, `newId()`, `makeTestDb()`.
- Produces:
  ```ts
  // src/db/schema/sessions.ts
  export const sessions;      // id (sha256 hex), userId, createdAt, idleExpiresAt, absoluteExpiresAt
  export const invites;       // id, projectId, tokenHash, role, createdBy, createdAt, expiresAt, acceptedAt, acceptedBy, revokedAt
  export const resetTokens;   // id, userId, tokenHash, createdBy, createdAt, expiresAt, usedAt
  // src/db/schema/board.ts
  export const STATE_CATEGORIES: readonly ["unstarted", "in_progress", "done", "rejected"];
  export type StateCategory = (typeof STATE_CATEGORIES)[number];
  export const STORY_TYPES: readonly ["feature", "bug", "chore", "release"];
  export type StoryType = (typeof STORY_TYPES)[number];
  export const projectStates;  // id, projectId, name, actionLabel, category, position, createdAt
  export const stories;        // id, projectId, number, title, description, storyType, stateId, position,
                               // points, requesterId, assigneeId, completedAt, createdBy, createdAt, updatedAt
  // src/db/schema/projects.ts (additions)
  export const POINT_SCALES: readonly ["fibonacci", "linear", "custom"];
  export type PointScale = (typeof POINT_SCALES)[number];
  // projects gains: description (text|null), pointScale (PointScale, default "fibonacci"), customPoints (text|null, JSON array)
  // test/harness.ts (additions)
  export function seedState(db: Db, projectId: string, input: { name: string; category: StateCategory; position: number; actionLabel?: string | null }): string;
  export function seedStory(db: Db, projectId: string, input: { title?: string; stateId?: string | null; position?: number; points?: number | null; storyType?: StoryType }): string;
  ```

**Naming note:** the Backlog task calls the estimate column `estimate`; `spec/data-model.md` calls it `points` and `packages/core` already speaks of point scales (`pointScaleValues`). This plan uses **`points`** everywhere — same field, spec-canonical name.

**Deliberately not in this migration** (they arrive with phase 2, forward-only): `iterations`, `stories.iteration_id`, `parent_id` / `is_container` / `epic_pinned`, `labels`, `tasks`, `comments`, `backlog_dividers`, `my_work_*`. Do not add unused columns "for later".

- [ ] **Step 1: Write the failing constraint test**

`apps/server/test/schema-constraints.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedProject, seedState, seedStory, seedUser } from "./harness";
import { newId } from "../src/id";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let projectId: string;
let otherProjectId: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = seedProject(db, owner);
  otherProjectId = seedProject(db, owner);
});

const run = (sql: string, params: unknown[] = []) => db.$client.run(sql, params as never);

describe("project_states", () => {
  it("rejects an unknown category", () => {
    expect(() =>
      run("insert into project_states (id, project_id, name, category, position, created_at) values (?,?,?,?,?,?)", [
        newId(), projectId, "Weird", "wat", 0, Date.now(),
      ]),
    ).toThrow(/CHECK constraint failed/);
  });

  it("rejects two states at the same position in one project", () => {
    seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    expect(() => seedState(db, projectId, { name: "B", category: "done", position: 0 })).toThrow(/UNIQUE/);
  });

  it("allows the same position in a different project", () => {
    seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    expect(() => seedState(db, otherProjectId, { name: "A", category: "unstarted", position: 0 })).not.toThrow();
  });

  it("refuses to change a state's category (guard trigger)", () => {
    const stateId = seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    expect(() => run("update project_states set category = 'done' where id = ?", [stateId])).toThrow(
      /project_states.category is immutable/,
    );
  });

  it("allows renaming a state and changing its action label", () => {
    const stateId = seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    expect(() =>
      run("update project_states set name = 'Ready', action_label = 'Start' where id = ?", [stateId]),
    ).not.toThrow();
  });
});

describe("stories", () => {
  it("rejects a second story with the same number in one project", () => {
    seedStory(db, projectId, { title: "one" });
    expect(() =>
      run(
        "insert into stories (id, project_id, number, title, story_type, position, created_by, created_at, updated_at) values (?,?,?,?,?,?,?,?,?)",
        [newId(), projectId, 1, "dup", "feature", 5, (owner as { userId: string }).userId, Date.now(), Date.now()],
      ),
    ).toThrow(/UNIQUE/);
  });

  it("refuses to change a story's number (guard trigger)", () => {
    const storyId = seedStory(db, projectId, { title: "one" });
    expect(() => run("update stories set number = 42 where id = ?", [storyId])).toThrow(
      /stories.number is pinned/,
    );
  });

  it("refuses a state from another project (composite FK)", () => {
    const foreignState = seedState(db, otherProjectId, { name: "A", category: "unstarted", position: 0 });
    expect(() => seedStory(db, projectId, { stateId: foreignState })).toThrow(/FOREIGN KEY/);
  });

  it("refuses to delete a state while a story points at it (ON DELETE RESTRICT)", () => {
    const stateId = seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    seedStory(db, projectId, { stateId });
    expect(() => run("delete from project_states where id = ?", [stateId])).toThrow(/FOREIGN KEY/);
  });

  it("rejects a negative point value and an unknown story type", () => {
    expect(() => seedStory(db, projectId, { points: -1 })).toThrow(/CHECK constraint failed/);
    expect(() => seedStory(db, projectId, { storyType: "epic" as never })).toThrow(/CHECK constraint failed/);
  });

  it("deletes its stories and states when the project goes (cascade)", () => {
    const stateId = seedState(db, projectId, { name: "A", category: "unstarted", position: 0 });
    seedStory(db, projectId, { stateId });
    run("delete from stories where project_id = ?", [projectId]);
    run("delete from projects where id = ?", [projectId]);
    expect(db.$client.query("select count(*) as c from project_states").get()).toEqual({ c: 0 });
  });
});

describe("activity_logs story guard", () => {
  it("rejects a story_id that belongs to another project (trigger)", () => {
    const foreign = seedStory(db, otherProjectId, { title: "elsewhere" });
    expect(() =>
      run("insert into activity_logs (id, project_id, story_id, action, created_at) values (?,?,?,?,?)", [
        newId(), projectId, foreign, "story.updated", Date.now(),
      ]),
    ).toThrow(/activity_logs.story_id must belong to the same project/);
  });

  it("accepts a story_id in the same project and a null story_id", () => {
    const own = seedStory(db, projectId, { title: "mine" });
    expect(() =>
      run("insert into activity_logs (id, project_id, story_id, action, created_at) values (?,?,?,?,?)", [
        newId(), projectId, own, "story.updated", Date.now(),
      ]),
    ).not.toThrow();
    expect(() =>
      run("insert into activity_logs (id, project_id, story_id, action, created_at) values (?,?,?,?,?)", [
        newId(), projectId, null, "project.updated", Date.now(),
      ]),
    ).not.toThrow();
  });
});

describe("sessions, invites, reset_tokens", () => {
  it("keeps session ids unique and cascades on user delete", () => {
    const userId = (seedUser(db, "s@example.test") as { userId: string }).userId;
    const now = Date.now();
    run("insert into sessions (id, user_id, created_at, idle_expires_at, absolute_expires_at) values (?,?,?,?,?)", [
      "hash-1", userId, now, now + 1000, now + 2000,
    ]);
    expect(() =>
      run("insert into sessions (id, user_id, created_at, idle_expires_at, absolute_expires_at) values (?,?,?,?,?)", [
        "hash-1", userId, now, now + 1000, now + 2000,
      ]),
    ).toThrow(/UNIQUE/);
    run("delete from users where id = ?", [userId]);
    expect(db.$client.query("select count(*) as c from sessions").get()).toEqual({ c: 0 });
  });

  it("keeps invite token hashes unique and restricts the role", () => {
    const createdBy = (owner as { userId: string }).userId;
    const now = Date.now();
    const insert = (role: string, hash: string) =>
      run(
        "insert into invites (id, project_id, token_hash, role, created_by, created_at, expires_at) values (?,?,?,?,?,?,?)",
        [newId(), projectId, hash, role, createdBy, now, now + 1000],
      );
    insert("member", "invite-1");
    expect(() => insert("viewer", "invite-1")).toThrow(/UNIQUE/);
    expect(() => insert("admin", "invite-2")).toThrow(/CHECK constraint failed/);
  });

  it("keeps reset token hashes unique", () => {
    const userId = (owner as { userId: string }).userId;
    const now = Date.now();
    const insert = (hash: string) =>
      run("insert into reset_tokens (id, user_id, token_hash, created_by, created_at, expires_at) values (?,?,?,?,?,?)", [
        newId(), userId, hash, userId, now, now + 1000,
      ]);
    insert("reset-1");
    expect(() => insert("reset-1")).toThrow(/UNIQUE/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server` then `bun test test/schema-constraints.test.ts`
Expected: FAIL — `seedState` / `seedStory` are not exported and none of the tables exist.

- [ ] **Step 3: Write the schema modules**

`src/db/schema/sessions.ts`:

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projects } from "./projects";

/** id is the SHA-256 hex of the session secret; the clear value lives only in the cookie. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    idleExpiresAt: integer("idle_expires_at").notNull(),
    absoluteExpiresAt: integer("absolute_expires_at").notNull(),
  },
  (t) => [index("sessions_user").on(t.userId), index("sessions_absolute").on(t.absoluteExpiresAt)],
);

export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    role: text("role", { enum: ["owner", "member", "viewer"] }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    acceptedAt: integer("accepted_at"),
    acceptedBy: text("accepted_by").references(() => users.id),
    revokedAt: integer("revoked_at"),
  },
  (t) => [
    uniqueIndex("invites_token_hash").on(t.tokenHash),
    // loadInProject addresses rows by (id, project_id); every project-scoped table carries it.
    uniqueIndex("invites_id_project").on(t.id, t.projectId),
    index("invites_project").on(t.projectId),
    check("invites_role", sql`${t.role} in ('owner','member','viewer')`),
  ],
);

export const resetTokens = sqliteTable(
  "reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
  },
  (t) => [uniqueIndex("reset_tokens_token_hash").on(t.tokenHash), index("reset_tokens_user").on(t.userId)],
);
```

`src/db/schema/board.ts`:

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projects } from "./projects";

/** The four system categories. Semantics attach to the category, never to a state's name. */
export const STATE_CATEGORIES = ["unstarted", "in_progress", "done", "rejected"] as const;
export type StateCategory = (typeof STATE_CATEGORIES)[number];

export const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

export const projectStates = sqliteTable(
  "project_states",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Advance-button verb; null = this state offers no advance button. */
    actionLabel: text("action_label"),
    category: text("category", { enum: STATE_CATEGORIES }).notNull(),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("project_states_id_project").on(t.id, t.projectId),
    uniqueIndex("project_states_position").on(t.projectId, t.position),
    check("project_states_category", sql`${t.category} in ('unstarted','in_progress','done','rejected')`),
  ],
);

export const stories = sqliteTable(
  "stories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Per-project sequence, MAX+1 inside the transaction, pinned by a trigger afterwards. */
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    storyType: text("story_type", { enum: STORY_TYPES }).notNull().default("feature"),
    /** null = Icebox. The category behind the state drives completed_at and zone semantics. */
    stateId: text("state_id"),
    position: integer("position").notNull(),
    points: integer("points"),
    requesterId: text("requester_id").references(() => users.id),
    assigneeId: text("assignee_id").references(() => users.id),
    completedAt: integer("completed_at"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("stories_id_project").on(t.id, t.projectId),
    uniqueIndex("stories_project_number").on(t.projectId, t.number),
    index("stories_project_state_position").on(t.projectId, t.stateId, t.position),
    check("stories_story_type", sql`${t.storyType} in ('feature','bug','chore','release')`),
    check("stories_points", sql`${t.points} is null or ${t.points} >= 0`),
    // A story can never point at another project's state, and a state in use cannot be deleted.
    foreignKey({
      columns: [t.stateId, t.projectId],
      foreignColumns: [projectStates.id, projectStates.projectId],
      name: "stories_state_project_fk",
    }).onDelete("restrict"),
  ],
);
```

`src/db/schema/projects.ts` — add the three columns and the scale vocabulary:

```ts
export const POINT_SCALES = ["fibonacci", "linear", "custom"] as const;
export type PointScale = (typeof POINT_SCALES)[number];
```

and inside `projects`:

```ts
  description: text("description"),
  pointScale: text("point_scale", { enum: POINT_SCALES }).notNull().default("fibonacci"),
  /** JSON array of numbers, only read when pointScale === "custom" (never used in WHERE). */
  customPoints: text("custom_points"),
```

Add `export * from "./sessions"; export * from "./board";` to `src/db/schema/index.ts`.

- [ ] **Step 4: Generate migration 0003 and append the guard triggers**

```bash
pnpm --filter @storylane/server db:generate
```

Expected: `src/db/migrations/0003_<name>.sql` with `CREATE TABLE` for `sessions`, `invites`, `reset_tokens`, `project_states`, `stories`, their indexes, and three `ALTER TABLE projects ADD ...` statements.

Drizzle Kit cannot express triggers, so append them to the freshly generated file (it has not shipped yet, so extending it is allowed — never touch `0000`–`0002`). Each statement is separated by the breakpoint comment Drizzle uses:

```sql
--> statement-breakpoint
CREATE TRIGGER stories_number_pinned
BEFORE UPDATE OF number ON stories
WHEN new.number <> old.number
BEGIN
  SELECT RAISE(ABORT, 'stories.number is pinned after insert');
END;
--> statement-breakpoint
CREATE TRIGGER project_states_category_immutable
BEFORE UPDATE OF category ON project_states
WHEN new.category <> old.category
BEGIN
  SELECT RAISE(ABORT, 'project_states.category is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER activity_logs_story_in_project_insert
BEFORE INSERT ON activity_logs
WHEN new.story_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stories WHERE id = new.story_id AND project_id = new.project_id)
BEGIN
  SELECT RAISE(ABORT, 'activity_logs.story_id must belong to the same project');
END;
--> statement-breakpoint
CREATE TRIGGER activity_logs_story_in_project_update
BEFORE UPDATE OF story_id ON activity_logs
WHEN new.story_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stories WHERE id = new.story_id AND project_id = new.project_id)
BEGIN
  SELECT RAISE(ABORT, 'activity_logs.story_id must belong to the same project');
END;
```

Why triggers and not a composite FK on `activity_logs`: the table shipped in `0002`, one migration before `stories` existed, and SQLite cannot add a constraint to an existing table without a full rebuild. The trigger enforces the same in-project rule; the "log survives, story_id nulled" behaviour on story deletion is explicit code in `deleteStory` (Task 6), matching design §5's "behaviour moves out of the database".

- [ ] **Step 5: Extend the harness**

Append to `apps/server/test/harness.ts`:

```ts
import { projectStates, stories, type StateCategory, type StoryType } from "../src/db/schema";
import { newId } from "../src/id";
import { sql } from "drizzle-orm";

export function seedState(
  db: Db,
  projectId: string,
  input: { name: string; category: StateCategory; position: number; actionLabel?: string | null },
): string {
  const id = newId();
  db.insert(projectStates)
    .values({
      id,
      projectId,
      name: input.name,
      category: input.category,
      actionLabel: input.actionLabel ?? null,
      position: input.position,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

/** Seeds one story with the next free number; `stateId: undefined` means Icebox. */
export function seedStory(
  db: Db,
  projectId: string,
  input: {
    title?: string;
    stateId?: string | null;
    position?: number;
    points?: number | null;
    storyType?: StoryType;
  } = {},
): string {
  const id = newId();
  const next = db
    .select({ n: sql<number>`coalesce(max(${stories.number}), 0) + 1` })
    .from(stories)
    .where(sql`${stories.projectId} = ${projectId}`)
    .get();
  const createdBy = db.$client.query("select id from users limit 1").get() as { id: string };
  db.insert(stories)
    .values({
      id,
      projectId,
      number: next?.n ?? 1,
      title: input.title ?? "story",
      storyType: input.storyType ?? "feature",
      stateId: input.stateId ?? null,
      position: input.position ?? 0,
      points: input.points ?? null,
      createdBy: createdBy.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `bun test test/schema-constraints.test.ts`
Expected: PASS (17 tests).

Then the whole suite, one command at a time:

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green.

- [ ] **Step 7: Confirm the migration applies to an existing file database**

The migration must work on a v0.1.0 database that already has `0000`–`0002`, not only on `:memory:`:

```bash
cd apps/server
```
```bash
STORYLANE_DATA_DIR=/tmp/sl-migrate-check bun src/index.ts backup /tmp/sl-throwaway.db || true
```
```bash
rm -rf /tmp/sl-migrate-check /tmp/sl-throwaway.db
```
```bash
STORYLANE_DATA_DIR=/tmp/sl-migrate-check bun -e 'import { openDatabase } from "./src/db/client"; import { runMigrations } from "./src/db/migrate"; const db = openDatabase("/tmp/sl-migrate-check/storylane.db"); runMigrations(db); runMigrations(db); console.error(db.$client.query("select name from sqlite_master where type=\"trigger\" order by name").all());'
```
Expected: the second `runMigrations` is a no-op (journal already applied) and the four trigger names are listed. Then:

```bash
rm -rf /tmp/sl-migrate-check
```

- [ ] **Step 8: Update spec/data-model.md to the SQLite wording**

Two edits (acceptance criterion #3), both surgical — the full Supabase-era prose sweep is Task 10:

1. In "Position ordering invariant", replace the paragraph starting `DB-enforced where the scope is flat:` with:

```markdown
DB-enforced where the scope is flat: `UNIQUE(project_id, position)` on
project_states and `UNIQUE(story_id, position)` on tasks. SQLite has no
`DEFERRABLE INITIALLY DEFERRED`, so a dense rewrite cannot rely on
end-of-statement reconciliation: every renumbering goes through
`reorder(tx, table, scope, orderedIds)`
(`apps/server/src/db/tx.ts`), which writes `position = -rank - 1` for the whole
scope and then `position = rank`, so no intermediate state collides. `stories`
and `backlog_dividers` stay unconstrained: their position is scoped by zone,
not by a single column.
```

2. In the `project_states` and `stories` blocks, replace the sentence about composite FKs being "the same RLS pattern" with a pointer to the new mechanism:

```markdown
Project scoping is `UNIQUE (id, project_id)` plus composite foreign keys
(`stories.(state_id, project_id) → project_states(id, project_id)`), read
through `loadInProject(tx, table, id)`; authorization itself is
`spec/permissions.md` / `withProject`, not RLS.
```

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/db/schema apps/server/src/db/migrations apps/server/test/harness.ts apps/server/test/schema-constraints.test.ts spec/data-model.md
```
```bash
git commit -m "feat(server): phase-1 schema (sessions, invites, reset_tokens, project_states, stories) with RAISE(ABORT) guard triggers (TASK-246)"
```

---

### Task 3a: Authentication core — passwords, hashed tokens, sessions, cookies (TASK-247)

**Files:**
- Create: `apps/server/src/auth/password.ts`, `apps/server/src/auth/tokens.ts`, `apps/server/src/auth/sessions.ts`, `apps/server/src/auth/cookies.ts`, `apps/server/test/auth-password.test.ts`, `apps/server/test/auth-sessions.test.ts`, `apps/server/test/auth-cookies.test.ts`
- Modify: `apps/server/test/harness.ts` (a user with a real password hash)

**Interfaces:**
- Consumes: `Db`, `users`, `sessions`, `newId()`, `Config`, `makeTestDb()`, `seedUser()`.
- Produces:
  ```ts
  // src/auth/password.ts
  export interface Argon2Params { algorithm: "argon2id"; memoryCost: number; timeCost: number }
  export const ARGON2_PARAMS: Argon2Params;            // { argon2id, 65536 KiB, 3 }
  export const MIN_PASSWORD_LENGTH = 12;
  export async function hashPassword(plain: string, params?: Argon2Params): Promise<string>;
  export async function verifyPassword(hash: string, plain: string): Promise<boolean>;
  export function assertPasswordAcceptable(plain: string): void;   // throws HttpError(400, "password_too_short")
  // src/auth/tokens.ts
  export function newSecret(bytes?: number): string;    // 32 random bytes, base64url, no padding
  export function hashToken(secret: string): string;    // sha256 hex
  export function tokensMatch(aHex: string, bHex: string): boolean;   // constant time
  // src/auth/sessions.ts
  export const SESSION_COOKIE = "storylane_session";
  export const SESSION_ABSOLUTE_MS: number;             // 30 days
  export const SESSION_IDLE_MS: number;                 // 14 days
  export const SESSION_TOUCH_MS: number;                // 60_000 — write-amplification floor
  export interface SessionUser { userId: string; isAdmin: boolean }
  export function createSession(db: Db, userId: string, now?: number): { secret: string; absoluteExpiresAt: number };
  export function resolveSession(db: Db, secret: string, now?: number): SessionUser | null;
  export function deleteSession(db: Db, secret: string): void;
  export function revokeUserSessions(db: Db, userId: string): number;
  export function purgeExpiredSessions(db: Db, now?: number): number;
  // src/auth/cookies.ts
  export function isSecureRequest(c: Context, config: Config): boolean;
  export function setSessionCookie(c: Context, config: Config, secret: string, absoluteExpiresAt: number): void;
  export function clearSessionCookie(c: Context, config: Config): void;
  export function readSessionCookie(c: Context): string | null;
  ```

- [ ] **Step 1: Write the failing password test**

`apps/server/test/auth-password.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { ARGON2_PARAMS, assertPasswordAcceptable, hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "../src/auth/password";
import { HttpError } from "../src/http-error";

// Argon2id at the production cost takes ~100 ms per call; the tests that only care about
// round-tripping use a cheap parameter set. verifyPassword reads the cost from the hash.
const CHEAP = { algorithm: "argon2id", memoryCost: 1024, timeCost: 1 } as const;

describe("password hashing", () => {
  it("produces an argon2id hash that verifies", async () => {
    const hash = await hashPassword("correct horse battery", CHEAP);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong horse battery")).toBe(false);
  });

  it("salts: the same password hashes differently every time", async () => {
    const a = await hashPassword("correct horse battery", CHEAP);
    const b = await hashPassword("correct horse battery", CHEAP);
    expect(a).not.toBe(b);
  });

  it("uses the documented production parameters by default", () => {
    expect(ARGON2_PARAMS).toEqual({ algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
  });

  it("returns false instead of throwing on a corrupt hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });

  it("enforces a minimum length and nothing else", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12);
    expect(() => assertPasswordAcceptable("x".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
    try {
      assertPasswordAcceptable("short");
      throw new Error("expected a throw");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).code).toBe("password_too_short");
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/server` then `bun test test/auth-password.test.ts`
Expected: FAIL — `Cannot find module "../src/auth/password"`.

- [ ] **Step 3: Implement password.ts and tokens.ts**

`src/auth/password.ts`:

```ts
import { HttpError } from "../http-error";

export interface Argon2Params {
  algorithm: "argon2id";
  /** KiB — design §4 asks for 64 MiB. */
  memoryCost: number;
  timeCost: number;
}

/**
 * Bun.password exposes memoryCost and timeCost only; argon2id's parallelism is fixed by the
 * implementation, so design §4's "parallelism 1" is not a knob we can set here.
 */
export const ARGON2_PARAMS: Argon2Params = { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 };

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(plain: string, params: Argon2Params = ARGON2_PARAMS): Promise<string> {
  return Bun.password.hash(plain, params);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    // A malformed stored hash must read as "wrong password", not as a 500.
    return false;
  }
}

/** Length only — no composition rules (design §4). */
export function assertPasswordAcceptable(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, "password_too_short");
}
```

`src/auth/tokens.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

/** 256 bits of randomness, URL-safe: session ids, invite tokens, reset tokens, setup token. */
export function newSecret(bytes = 32): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return Buffer.from(raw).toString("base64url");
}

/** Secrets are stored only as this. Unsalted SHA-256 is right here: the input is 256-bit random. */
export function hashToken(secret: string): string {
  return new Bun.CryptoHasher("sha256").update(secret).digest("hex");
}

export function tokensMatch(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/auth-password.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing session test**

`apps/server/test/auth-sessions.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, disableUser, seedUser } from "./harness";
import { hashToken } from "../src/auth/tokens";
import {
  createSession,
  deleteSession,
  purgeExpiredSessions,
  resolveSession,
  revokeUserSessions,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
} from "../src/auth/sessions";
import { sessions } from "../src/db/schema";
import type { Db } from "../src/db/client";

let db: Db;
let userId: string;

beforeEach(() => {
  db = makeTestDb();
  const actor = seedUser(db, "user@example.test");
  userId = (actor as { userId: string }).userId;
});

describe("createSession", () => {
  it("stores the hash, never the secret", () => {
    const { secret } = createSession(db, userId);
    const rows = db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(hashToken(secret));
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("sets both expiries from the given clock", () => {
    const now = 1_700_000_000_000;
    createSession(db, userId, now);
    const row = db.select().from(sessions).all()[0]!;
    expect(row.createdAt).toBe(now);
    expect(row.absoluteExpiresAt).toBe(now + SESSION_ABSOLUTE_MS);
    expect(row.idleExpiresAt).toBe(now + SESSION_IDLE_MS);
  });

  it("issues a different id every time (new id on login)", () => {
    const a = createSession(db, userId).secret;
    const b = createSession(db, userId).secret;
    expect(a).not.toBe(b);
    expect(db.select().from(sessions).all()).toHaveLength(2);
  });
});

describe("resolveSession", () => {
  it("returns the user and admin flag", () => {
    const admin = seedUser(db, "admin@example.test", true);
    const { secret } = createSession(db, (admin as { userId: string }).userId);
    expect(resolveSession(db, secret)).toEqual({ userId: (admin as { userId: string }).userId, isAdmin: true });
  });

  it("returns null for an unknown, idle-expired or absolutely-expired secret", () => {
    const now = 1_700_000_000_000;
    const { secret } = createSession(db, userId, now);
    expect(resolveSession(db, "nonsense", now)).toBeNull();
    expect(resolveSession(db, secret, now + SESSION_IDLE_MS + 1)).toBeNull();
    db.update(sessions)
      .set({ idleExpiresAt: now + SESSION_ABSOLUTE_MS * 2 })
      .where(eq(sessions.id, hashToken(secret)))
      .run();
    expect(resolveSession(db, secret, now + SESSION_ABSOLUTE_MS + 1)).toBeNull();
  });

  it("returns null for a disabled user", () => {
    const actor = seedUser(db, "gone@example.test");
    const { secret } = createSession(db, (actor as { userId: string }).userId);
    disableUser(db, actor);
    expect(resolveSession(db, secret)).toBeNull();
  });

  it("slides the idle expiry forward, but not more often than SESSION_TOUCH_MS", () => {
    const now = 1_700_000_000_000;
    const { secret } = createSession(db, userId, now);
    const idAt = () => db.select().from(sessions).all()[0]!.idleExpiresAt;
    resolveSession(db, secret, now + 1_000);
    expect(idAt()).toBe(now + SESSION_IDLE_MS); // below the touch floor: no write
    resolveSession(db, secret, now + 120_000);
    expect(idAt()).toBe(now + 120_000 + SESSION_IDLE_MS);
  });

  it("never slides the idle expiry past the absolute expiry", () => {
    const now = 1_700_000_000_000;
    const { secret } = createSession(db, userId, now);
    const late = now + SESSION_ABSOLUTE_MS - 1_000;
    resolveSession(db, secret, late);
    expect(db.select().from(sessions).all()[0]!.idleExpiresAt).toBe(now + SESSION_ABSOLUTE_MS);
  });
});

describe("deleteSession / revokeUserSessions / purgeExpiredSessions", () => {
  it("logout removes exactly that session server-side", () => {
    const a = createSession(db, userId).secret;
    const b = createSession(db, userId).secret;
    deleteSession(db, a);
    expect(resolveSession(db, a)).toBeNull();
    expect(resolveSession(db, b)).not.toBeNull();
  });

  it("revoking removes every session of that user only", () => {
    const other = seedUser(db, "other@example.test");
    const mine = createSession(db, userId).secret;
    const theirs = createSession(db, (other as { userId: string }).userId).secret;
    expect(revokeUserSessions(db, userId)).toBe(1);
    expect(resolveSession(db, mine)).toBeNull();
    expect(resolveSession(db, theirs)).not.toBeNull();
  });

  it("purges rows whose absolute expiry has passed", () => {
    const now = 1_700_000_000_000;
    createSession(db, userId, now);
    expect(purgeExpiredSessions(db, now + SESSION_ABSOLUTE_MS + 1)).toBe(1);
    expect(db.select().from(sessions).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test test/auth-sessions.test.ts`
Expected: FAIL — `Cannot find module "../src/auth/sessions"`.

- [ ] **Step 7: Implement sessions.ts**

```ts
import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, users } from "../db/schema";
import { hashToken, newSecret } from "./tokens";

export const SESSION_COOKIE = "storylane_session";
/** Design §4 asks for absolute + idle expiry; the numbers are this project's choice. */
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000;
/** Do not rewrite the idle expiry on every request — once a minute is plenty. */
export const SESSION_TOUCH_MS = 60_000;

export interface SessionUser {
  userId: string;
  isAdmin: boolean;
}

export function createSession(db: Db, userId: string, now = Date.now()): { secret: string; absoluteExpiresAt: number } {
  const secret = newSecret();
  const absoluteExpiresAt = now + SESSION_ABSOLUTE_MS;
  db.insert(sessions)
    .values({
      id: hashToken(secret),
      userId,
      createdAt: now,
      idleExpiresAt: now + SESSION_IDLE_MS,
      absoluteExpiresAt,
    })
    .run();
  return { secret, absoluteExpiresAt };
}

export function resolveSession(db: Db, secret: string, now = Date.now()): SessionUser | null {
  const id = hashToken(secret);
  const row = db
    .select({
      userId: sessions.userId,
      idleExpiresAt: sessions.idleExpiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      isAdmin: users.isAdmin,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  if (now >= row.absoluteExpiresAt || now >= row.idleExpiresAt) return null;
  if (row.disabledAt !== null) return null;
  const slid = Math.min(now + SESSION_IDLE_MS, row.absoluteExpiresAt);
  if (slid - row.idleExpiresAt >= SESSION_TOUCH_MS || slid < row.idleExpiresAt) {
    db.update(sessions).set({ idleExpiresAt: slid }).where(eq(sessions.id, id)).run();
  }
  return { userId: row.userId, isAdmin: row.isAdmin };
}

export function deleteSession(db: Db, secret: string): void {
  db.delete(sessions).where(eq(sessions.id, hashToken(secret))).run();
}

/** Password change and admin reset revoke every session of that user (design §4). */
export function revokeUserSessions(db: Db, userId: string): number {
  const doomed = db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
  return doomed.length;
}

export function purgeExpiredSessions(db: Db, now = Date.now()): number {
  const doomed = db.select({ id: sessions.id }).from(sessions).where(lt(sessions.absoluteExpiresAt, now)).all();
  db.delete(sessions).where(lt(sessions.absoluteExpiresAt, now)).run();
  return doomed.length;
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test test/auth-sessions.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 9: Write the failing cookie test**

`apps/server/test/auth-cookies.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { clearSessionCookie, isSecureRequest, readSessionCookie, setSessionCookie } from "../src/auth/cookies";
import { SESSION_COOKIE } from "../src/auth/sessions";

function appWith(env: Record<string, string>) {
  const config = loadConfig(env);
  return new Hono()
    .get("/set", (c) => {
      setSessionCookie(c, config, "secret-value", Date.parse("2027-01-01T00:00:00Z"));
      return c.json({ secure: isSecureRequest(c, config) });
    })
    .get("/clear", (c) => {
      clearSessionCookie(c, config);
      return c.body(null, 204);
    })
    .get("/read", (c) => c.json({ secret: readSessionCookie(c) }));
}

describe("session cookie", () => {
  it("omits Secure on plain http (the LAN case)", async () => {
    const res = await appWith({}).request("http://192.168.1.5:3000/set");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=secret-value`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    expect(await res.json()).toEqual({ secure: false });
  });

  it("sets Secure when STORYLANE_BASE_URL is https", async () => {
    const res = await appWith({ STORYLANE_BASE_URL: "https://tracker.example.test" }).request("http://127.0.0.1/set");
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("sets Secure behind a trusted proxy that reports https", async () => {
    const res = await appWith({ STORYLANE_TRUST_PROXY: "true" }).request("http://127.0.0.1/set", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("ignores X-Forwarded-Proto when the proxy is not trusted", async () => {
    const res = await appWith({}).request("http://127.0.0.1/set", { headers: { "x-forwarded-proto": "https" } });
    expect(res.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("clears with Max-Age=0 and reads back a cookie", async () => {
    const cleared = await appWith({}).request("http://127.0.0.1/clear");
    expect(cleared.headers.get("set-cookie")).toContain("Max-Age=0");
    const read = await appWith({}).request("http://127.0.0.1/read", {
      headers: { cookie: `${SESSION_COOKIE}=abc; other=1` },
    });
    expect(await read.json()).toEqual({ secret: "abc" });
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `bun test test/auth-cookies.test.ts`
Expected: FAIL — `Cannot find module "../src/auth/cookies"`.

- [ ] **Step 11: Implement cookies.ts**

```ts
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "../config";
import { SESSION_COOKIE } from "./sessions";

/**
 * A fixed `Secure` flag breaks login on http://192.168.x.x:3000, which is the home-server
 * case this project targets (design §4), so it is decided per request.
 */
export function isSecureRequest(c: Context, config: Config): boolean {
  if (config.baseUrl?.protocol === "https:") return true;
  if (config.trustProxy && c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() === "https") return true;
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookie(c: Context, config: Config, secret: string, absoluteExpiresAt: number): void {
  setCookie(c, SESSION_COOKIE, secret, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isSecureRequest(c, config),
    expires: new Date(absoluteExpiresAt),
  });
}

export function clearSessionCookie(c: Context, config: Config): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecureRequest(c, config), sameSite: "Lax" });
}

export function readSessionCookie(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `bun test test/auth-cookies.test.ts`
Expected: PASS (5 tests). If `deleteCookie` emits `Max-Age=0` under another spelling, assert on `expires=Thu, 01 Jan 1970` instead — check `node_modules/hono/dist/types/helper/cookie/index.d.ts` before changing the test.

- [ ] **Step 13: Give the harness a user with a real password**

Append to `apps/server/test/harness.ts`:

```ts
import { hashPassword } from "../src/auth/password";

/** Cheap argon2id parameters: these tests assert behaviour, not cost. */
const TEST_ARGON2 = { algorithm: "argon2id", memoryCost: 1024, timeCost: 1 } as const;

export async function seedUserWithPassword(
  db: Db,
  email: string,
  password: string,
  opts: { isAdmin?: boolean } = {},
): Promise<Actor> {
  const actor = seedUser(db, email, opts.isAdmin ?? false);
  if (actor.kind !== "user") throw new Error("unreachable");
  db.update(users)
    .set({ passwordHash: await hashPassword(password, TEST_ARGON2) })
    .where(eq(users.id, actor.userId))
    .run();
  return actor;
}
```

- [ ] **Step 14: Full verification**

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green.

- [ ] **Step 15: Commit**

```bash
git add apps/server/src/auth apps/server/test/auth-password.test.ts apps/server/test/auth-sessions.test.ts apps/server/test/auth-cookies.test.ts apps/server/test/harness.ts
```
```bash
git commit -m "feat(server): argon2id passwords, hashed session store and Secure-when-HTTPS cookies (TASK-247)"
```

---

### Task 3b: Auth routes, CSRF guard, rate limits (TASK-247)

**Files:**
- Create: `apps/server/src/auth/csrf.ts`, `apps/server/src/auth/rate-limit.ts`, `apps/server/src/auth/actor.ts`, `apps/server/src/routes/auth.ts`, `apps/server/test/auth-csrf.test.ts`, `apps/server/test/auth-rate-limit.test.ts`, `apps/server/test/auth-routes.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/harness.ts`, `apps/server/test/route-matrix.test.ts`

**Interfaces:**
- Consumes: everything from Task 3a, `Config`, `Db`, `Actor`, `HttpError`, `Logger`.
- Produces:
  ```ts
  // src/auth/rate-limit.ts
  export interface RateLimiter { check(key: string): boolean; hits(key: string): number; reset(key?: string): void }
  export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter;
  export function clientIp(c: Context, config: Config): string;
  export const LOGIN_LIMITS: { perIp: { limit: 20; windowMs: number }; perEmail: { limit: 5; windowMs: number } };
  // src/auth/csrf.ts
  export function csrfGuard(config: Config): MiddlewareHandler;    // 403 csrf_check_failed
  export function instanceOrigins(c: Context, config: Config): string[];
  // src/auth/actor.ts
  export function actorFromRequest(db: Db): (c: Context) => Actor;
  // src/routes/auth.ts
  export interface AuthDeps { db: Db; config: Config; limiters?: { ip: RateLimiter; email: RateLimiter } }
  export function authRoutes(deps: AuthDeps, actorOf: (c: Context) => Actor): Hono;
  // src/app.ts (AppDeps additions)
  //   limiters?: { ip: RateLimiter; email: RateLimiter }   — tests inject a fake clock
  ```
- ROUTE_ACTIONS additions: `"POST /api/auth/login": "public"`, `"POST /api/auth/logout": "self"`, `"GET /api/me": "self"`, `"POST /api/me/password": "self"`.

- [ ] **Step 1: Write the failing rate-limiter test**

`apps/server/test/auth-rate-limit.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { clientIp, createRateLimiter } from "../src/auth/rate-limit";

describe("createRateLimiter", () => {
  it("allows `limit` attempts per window, then blocks", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => clock });
    expect([limiter.check("a"), limiter.check("a"), limiter.check("a")]).toEqual([true, true, true]);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(true);
  });

  it("forgets a key once its window rolls over", () => {
    let clock = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => clock });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    clock = 1001;
    expect(limiter.check("a")).toBe(true);
  });

  it("reset clears one key or everything", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.check("a");
    limiter.reset("a");
    expect(limiter.check("a")).toBe(true);
    limiter.check("a");
    limiter.reset();
    expect(limiter.check("a")).toBe(true);
  });
});

describe("clientIp", () => {
  const ipOf = (env: Record<string, string>, headers: Record<string, string>) => {
    const config = loadConfig(env);
    const app = new Hono().get("/ip", (c) => c.text(clientIp(c, config)));
    return app.request("http://127.0.0.1/ip", { headers }).then((r) => r.text());
  };

  it("ignores X-Forwarded-For unless the proxy is trusted", async () => {
    expect(await ipOf({}, { "x-forwarded-for": "203.0.113.9" })).not.toBe("203.0.113.9");
  });

  it("uses the left-most X-Forwarded-For entry when trusted", async () => {
    expect(await ipOf({ STORYLANE_TRUST_PROXY: "true" }, { "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe(
      "203.0.113.9",
    );
  });

  it("falls back to a stable placeholder when no address is available", async () => {
    // app.request() has no socket, so this documents the fallback rather than a real address.
    expect(await ipOf({}, {})).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/auth-rate-limit.test.ts`
Expected: FAIL — `Cannot find module "../src/auth/rate-limit"`.

- [ ] **Step 3: Implement rate-limit.ts**

```ts
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import type { Config } from "../config";

export interface RateLimiter {
  /** Records an attempt; false means the caller is over the limit for this window. */
  check(key: string): boolean;
  hits(key: string): number;
  reset(key?: string): void;
}

/**
 * Fixed window, in memory. Hand-written rather than a dependency: one process, no shared
 * state to coordinate, and the limiter needs an injectable clock for the tests.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const buckets = new Map<string, { start: number; count: number }>();
  const current = (key: string) => {
    const t = now();
    const bucket = buckets.get(key);
    if (!bucket || t - bucket.start >= opts.windowMs) {
      const fresh = { start: t, count: 0 };
      buckets.set(key, fresh);
      return fresh;
    }
    return bucket;
  };
  return {
    check(key) {
      const bucket = current(key);
      bucket.count += 1;
      // Keep the map from growing without bound on a busy instance.
      if (buckets.size > 10_000) {
        const t = now();
        for (const [k, b] of buckets) if (t - b.start >= opts.windowMs) buckets.delete(k);
      }
      return bucket.count <= opts.limit;
    },
    hits: (key) => buckets.get(key)?.count ?? 0,
    reset(key) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };
}

export const LOGIN_LIMITS = {
  perIp: { limit: 20, windowMs: 15 * 60 * 1000 },
  perEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const;

/** X-Forwarded-For is honoured only with STORYLANE_TRUST_PROXY=true (design §4). */
export function clientIp(c: Context, config: Config): string {
  if (config.trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // app.request() in tests has no socket.
    return "unknown";
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/auth-rate-limit.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing CSRF test**

`apps/server/test/auth-csrf.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { loadConfig } from "../src/config";
import { csrfGuard } from "../src/auth/csrf";
import { SESSION_COOKIE } from "../src/auth/sessions";

function appWith(env: Record<string, string> = {}) {
  const config = loadConfig(env);
  const app = new Hono();
  app.use("/api/*", csrfGuard(config));
  app.post("/api/thing", (c) => c.json({ ok: true }));
  app.get("/api/thing", (c) => c.json({ ok: true }));
  return app;
}

const withCookie = { cookie: `${SESSION_COOKIE}=abc` };
const json = { "content-type": "application/json" };

describe("csrfGuard", () => {
  it("accepts a same-origin JSON POST from a cookie session", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, origin: "http://tracker.example.test" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("rejects a foreign Origin", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, origin: "http://evil.example.test" },
      body: "{}",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "csrf_check_failed" });
  });

  it("rejects a cookie POST with a form content type", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, "content-type": "application/x-www-form-urlencoded", origin: "http://tracker.example.test" },
      body: "a=1",
    });
    expect(res.status).toBe(403);
  });

  it("accepts Sec-Fetch-Site: same-origin when Origin is absent", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, "sec-fetch-site": "same-origin" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("rejects a cookie POST with neither Origin nor Sec-Fetch-Site", async () => {
    const res = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });

  it("leaves GET and cookie-less requests alone", async () => {
    const get = await appWith().request("http://tracker.example.test/api/thing", {
      headers: { ...withCookie, origin: "http://evil.example.test" },
    });
    expect(get.status).toBe(200);
    const anonymous = await appWith().request("http://tracker.example.test/api/thing", {
      method: "POST",
      headers: { ...json },
      body: "{}",
    });
    expect(anonymous.status).toBe(200);
  });

  it("compares against STORYLANE_BASE_URL when it is set", async () => {
    const app = appWith({ STORYLANE_BASE_URL: "https://tracker.example.test" });
    const good = await app.request("http://10.0.0.5:3000/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, origin: "https://tracker.example.test" },
      body: "{}",
    });
    expect(good.status).toBe(200);
    const bad = await app.request("http://10.0.0.5:3000/api/thing", {
      method: "POST",
      headers: { ...withCookie, ...json, origin: "http://10.0.0.5:3000" },
      body: "{}",
    });
    expect(bad.status).toBe(403);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test test/auth-csrf.test.ts`
Expected: FAIL — `Cannot find module "../src/auth/csrf"`.

- [ ] **Step 7: Implement csrf.ts**

```ts
import type { Context, MiddlewareHandler } from "hono";
import type { Config } from "../config";
import { HttpError } from "../http-error";
import { readSessionCookie } from "./cookies";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * With STORYLANE_BASE_URL set, that is the only accepted origin. Without it the instance is
 * reached by bare IP or hostname, so the request's own origin is the best available answer
 * (a cross-site attacker cannot forge Origin, only omit it — which this guard also rejects).
 */
export function instanceOrigins(c: Context, config: Config): string[] {
  if (config.baseUrl) return [config.baseUrl.origin];
  return [new URL(c.req.url).origin];
}

/**
 * Cookie-authenticated non-GET requests must prove they came from our own page. Bearer-token
 * requests (PATs, phase 3) carry no cookie and are exempt by construction.
 */
export function csrfGuard(config: Config): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || readSessionCookie(c) === null) return next();
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.split(";")[0]?.trim().toLowerCase().startsWith("application/json")) {
      throw new HttpError(403, "csrf_check_failed");
    }
    const origin = c.req.header("origin");
    if (origin) {
      if (!instanceOrigins(c, config).includes(origin)) throw new HttpError(403, "csrf_check_failed");
      return next();
    }
    if (c.req.header("sec-fetch-site") === "same-origin") return next();
    throw new HttpError(403, "csrf_check_failed");
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test test/auth-csrf.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 9: Write the failing auth-routes test**

`apps/server/test/auth-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUserWithPassword, disableUser } from "./harness";
import { SESSION_COOKIE } from "../src/auth/sessions";
import { sessions } from "../src/db/schema";
import type { Db } from "../src/db/client";

let db: Db;
const PASSWORD = "correct horse battery";
const ORIGIN = "http://127.0.0.1";

const post = (app: { request: typeof fetch }, path: string, body: unknown, cookie?: string) =>
  (app.request as never as (p: string, i: RequestInit) => Promise<Response>)(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

const cookieFrom = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

beforeEach(async () => {
  db = makeTestDb();
  await seedUserWithPassword(db, "owner@example.test", PASSWORD);
});

describe("POST /api/auth/login", () => {
  it("sets a session cookie and returns the user", async () => {
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "owner@example.test", displayName: "owner", isAdmin: false });
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    expect(db.select().from(sessions).all()).toHaveLength(1);
  });

  it("matches the email case-insensitively", async () => {
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/auth/login", { email: "OWNER@Example.TEST", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("answers one uniform message for a wrong password, an unknown email and a disabled user", async () => {
    const disabled = await seedUserWithPassword(db, "gone@example.test", PASSWORD);
    disableUser(db, disabled);
    const { app } = makeTestApp(db);
    const wrong = await post(app, "/api/auth/login", { email: "owner@example.test", password: "nope nope nope" });
    const unknown = await post(app, "/api/auth/login", { email: "nobody@example.test", password: PASSWORD });
    const off = await post(app, "/api/auth/login", { email: "gone@example.test", password: PASSWORD });
    for (const res of [wrong, unknown, off]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_credentials" });
    }
  });

  it("blocks after LOGIN_LIMITS.perEmail failures and keeps another email working", async () => {
    await seedUserWithPassword(db, "second@example.test", PASSWORD);
    const { app } = makeTestApp(db);
    for (let i = 0; i < 5; i++) await post(app, "/api/auth/login", { email: "owner@example.test", password: "bad" });
    const blocked = await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_requests" });
    const other = await post(app, "/api/auth/login", { email: "second@example.test", password: PASSWORD });
    expect(other.status).toBe(200);
  });

  it("blocks per IP once the IP limit is reached regardless of the email", async () => {
    const { app } = makeTestApp(db);
    for (let i = 0; i < 20; i++) {
      await post(app, "/api/auth/login", { email: `probe${i}@example.test`, password: "bad" });
    }
    const blocked = await post(app, "/api/auth/login", { email: "fresh@example.test", password: "bad" });
    expect(blocked.status).toBe(429);
  });
});

describe("GET /api/me and logout", () => {
  it("401s without a session, returns the user with one, and 401s again after logout", async () => {
    const { app } = makeTestApp(db);
    const anonymous = await app.request(`${ORIGIN}/api/me`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });

    const login = await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD });
    const cookie = cookieFrom(login);

    const me = await app.request(`${ORIGIN}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: "owner@example.test" });

    const out = await post(app, "/api/auth/logout", {}, cookie);
    expect(out.status).toBe(204);
    expect(db.select().from(sessions).all()).toHaveLength(0);

    const after = await app.request(`${ORIGIN}/api/me`, { headers: { cookie } });
    expect(after.status).toBe(401);
  });
});

describe("POST /api/me/password", () => {
  it("changes the password, revokes every old session and issues a new one", async () => {
    const { app } = makeTestApp(db);
    const first = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));
    const second = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));

    const changed = await post(
      app,
      "/api/me/password",
      { currentPassword: PASSWORD, newPassword: "a much longer secret" },
      second,
    );
    expect(changed.status).toBe(200);
    const fresh = cookieFrom(changed);
    expect(fresh).not.toBe(second);

    expect((await app.request(`${ORIGIN}/api/me`, { headers: { cookie: first } })).status).toBe(401);
    expect((await app.request(`${ORIGIN}/api/me`, { headers: { cookie: second } })).status).toBe(401);
    expect((await app.request(`${ORIGIN}/api/me`, { headers: { cookie: fresh } })).status).toBe(200);

    const relogin = await post(app, "/api/auth/login", {
      email: "owner@example.test",
      password: "a much longer secret",
    });
    expect(relogin.status).toBe(200);
  });

  it("rejects a wrong current password and a too-short new one", async () => {
    const { app } = makeTestApp(db);
    const cookie = cookieFrom(await post(app, "/api/auth/login", { email: "owner@example.test", password: PASSWORD }));
    const wrong = await post(app, "/api/me/password", { currentPassword: "nope", newPassword: "long enough here" }, cookie);
    expect(wrong.status).toBe(401);
    const short = await post(app, "/api/me/password", { currentPassword: PASSWORD, newPassword: "short" }, cookie);
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "password_too_short" });
  });
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `bun test test/auth-routes.test.ts`
Expected: FAIL — no `/api/auth/login` route (404).

- [ ] **Step 11: Implement actor.ts and the auth routes**

`src/auth/actor.ts`:

```ts
import type { Context } from "hono";
import type { Db } from "../db/client";
import type { Actor } from "../db/tx";
import { readSessionCookie } from "./cookies";
import { resolveSession } from "./sessions";

const ANONYMOUS: Actor = { kind: "anonymous" };

/** Cookie → Actor. An expired, revoked or disabled session reads as anonymous (→ 401). */
export function actorFromRequest(db: Db): (c: Context) => Actor {
  return (c) => {
    const secret = readSessionCookie(c);
    if (!secret) return ANONYMOUS;
    const session = resolveSession(db, secret);
    if (!session) return ANONYMOUS;
    return { kind: "user", userId: session.userId, isAdmin: session.isAdmin };
  };
}
```

`src/routes/auth.ts`:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Config } from "../config";
import type { Actor } from "../db/tx";
import { users } from "../db/schema";
import { HttpError } from "../http-error";
import { assertPasswordAcceptable, hashPassword, verifyPassword } from "../auth/password";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../auth/cookies";
import { createSession, deleteSession, revokeUserSessions } from "../auth/sessions";
import { createRateLimiter, clientIp, LOGIN_LIMITS, type RateLimiter } from "../auth/rate-limit";

export interface AuthDeps {
  db: Db;
  config: Config;
  limiters?: { ip: RateLimiter; email: RateLimiter };
}

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `${field}_required`);
  return value;
}

function requireUser(actor: Actor): { userId: string; isAdmin: boolean } {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return actor;
}

export function authRoutes(deps: AuthDeps, actorOf: (c: Context) => Actor) {
  const limiters = deps.limiters ?? {
    ip: createRateLimiter(LOGIN_LIMITS.perIp),
    email: createRateLimiter(LOGIN_LIMITS.perEmail),
  };

  /** The users.email index is COLLATE NOCASE; the lookup must use the same collation. */
  const findByEmail = (email: string) =>
    deps.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        isAdmin: users.isAdmin,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .where(sql`${users.email} = ${email} collate nocase`)
      .get();

  return new Hono()
    .post("/api/auth/login", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as LoginBody;
      const email = requireString(body.email, "email");
      const password = requireString(body.password, "password");
      const ip = clientIp(c, deps.config);
      if (!limiters.ip.check(ip) || !limiters.email.check(email.toLowerCase())) {
        throw new HttpError(429, "too_many_requests");
      }
      const user = findByEmail(email);
      // One uniform answer for wrong password / unknown email / disabled account (design §4).
      const ok = user !== undefined && user.disabledAt === null && (await verifyPassword(user.passwordHash, password));
      if (!ok || !user) throw new HttpError(401, "invalid_credentials");
      limiters.email.reset(email.toLowerCase());
      const { secret, absoluteExpiresAt } = createSession(deps.db, user.id);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      return c.json({ id: user.id, email: user.email, displayName: user.displayName, isAdmin: user.isAdmin });
    })
    .post("/api/auth/logout", (c) => {
      const secret = readSessionCookie(c);
      if (secret) deleteSession(deps.db, secret);
      clearSessionCookie(c, deps.config);
      return c.body(null, 204);
    })
    .get("/api/me", (c) => {
      const actor = requireUser(actorOf(c));
      const user = deps.db
        .select({ id: users.id, email: users.email, displayName: users.displayName, isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, actor.userId))
        .get();
      if (!user) throw new HttpError(401, "unauthenticated");
      return c.json(user);
    })
    .post("/api/me/password", async (c) => {
      const actor = requireUser(actorOf(c));
      const body = (await c.req.json().catch(() => ({}))) as { currentPassword?: unknown; newPassword?: unknown };
      const currentPassword = requireString(body.currentPassword, "current_password");
      const newPassword = requireString(body.newPassword, "new_password");
      const user = deps.db
        .select({ id: users.id, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, actor.userId))
        .get();
      if (!user) throw new HttpError(401, "unauthenticated");
      if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new HttpError(401, "invalid_credentials");
      assertPasswordAcceptable(newPassword);
      // Hash before any transaction: bun:sqlite transactions cannot await.
      const passwordHash = await hashPassword(newPassword);
      deps.db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
      revokeUserSessions(deps.db, user.id);
      const { secret, absoluteExpiresAt } = createSession(deps.db, user.id);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      return c.json({ ok: true });
    });
}
```

- [ ] **Step 12: Wire it into the app and the manifest**

`src/authz/route-manifest.ts` — add:

```ts
  "POST /api/auth/login": "public",
  "POST /api/auth/logout": "self",
  "GET /api/me": "self",
  "POST /api/me/password": "self",
```

`src/app.ts` — extend `AppDeps` and `createApp`:

```ts
export interface AppDeps {
  config: Config;
  log: Logger;
  health: () => boolean;
  db: Db;
  actorOf?: (c: Context) => Actor;
  limiters?: { ip: RateLimiter; email: RateLimiter };
  testActorHeader?: boolean;
  staticRoot?: string;
}
```

and inside `createApp`, before the route groups:

```ts
  app.use("/api/*", csrfGuard(deps.config));
  app.use("/api/projects/:id/*", failClosed());
  app.route("/", healthzRoute(deps.health));
  app.route("/", authRoutes({ db: deps.db, config: deps.config, ...(deps.limiters ? { limiters: deps.limiters } : {}) }, actorOf));
  app.route("/", projectRoutes(deps.db, actorOf));
```

Order matters: `csrfGuard` runs before `failClosed`, so a rejected CSRF request never reaches the authorization scope. The `...(deps.limiters ? … : {})` spread is required by `exactOptionalPropertyTypes`.

`src/index.ts` — the production app now resolves real actors:

```ts
  const app = createApp({
    config,
    log,
    db,
    testActorHeader: false,
    actorOf: actorFromRequest(db),
    health: () => { /* unchanged */ },
  });
```

Also drop the `x-test-actor` fallback for production by leaving `testActorHeader: false` as it is. In `test/harness.ts`, `makeTestApp` keeps `testActorHeader: true` **and** gains the real cookie actor so both paths work in tests:

```ts
  const app = createApp({
    config: loadConfig({}),
    log: createLogger((l) => lines.push(l)),
    health: () => true,
    db,
    testActorHeader: true,
    actorOf: (c) => {
      const header = c.req.header("x-test-actor");
      if (header) {
        const parsed = JSON.parse(header) as Actor;
        if (parsed.kind === "user") return { kind: "user", userId: parsed.userId, isAdmin: parsed.isAdmin === true };
      }
      return actorFromRequest(db)(c);
    },
    staticRoot,
  });
```

- [ ] **Step 13: Extend the route matrix for non-action rules**

Append to `test/route-matrix.test.ts`:

```ts
describe("self and admin rules reject anonymous callers", () => {
  for (const [key, rule] of Object.entries(ROUTE_ACTIONS)) {
    if (rule !== "self" && rule !== "admin") continue;
    const [method, path] = key.split(" ") as [string, string];
    it(`${key} as anonymous → 401`, async () => {
      const fixture = FIXTURES[key] ?? {};
      let url = path.replace(":id", projectId);
      for (const [name, value] of Object.entries(fixture.params ?? {})) url = url.replace(`:${name}`, value);
      expect(url).not.toContain("/:");
      const res = await app.request(url, {
        method,
        headers: fixture.body === undefined ? {} : { "content-type": "application/json" },
        ...(fixture.body === undefined ? {} : { body: JSON.stringify(fixture.body) }),
      });
      expect(res.status).toBe(401);
    });
  }
});
```

Add the fixtures those routes need to `test/matrix-fixtures.ts`:

```ts
export function matrixFixtures(_ctx: MatrixContext): Record<string, MatrixFixture> {
  return {
    "POST /api/me/password": { body: { currentPassword: "x", newPassword: "y" } },
  };
}
```

- [ ] **Step 14: Run to verify everything passes**

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green. The manifest test is the one that fails first if a route was added without an entry.

- [ ] **Step 15: Commit**

```bash
git add apps/server/src/auth apps/server/src/routes/auth.ts apps/server/src/app.ts apps/server/src/index.ts apps/server/src/authz/route-manifest.ts apps/server/test
```
```bash
git commit -m "feat(server): login/logout/me routes with CSRF origin guard and per-IP/per-email login limits (TASK-247)"
```

- [ ] **Step 16: authz-reviewer pass**

Dispatch `authz-reviewer` on the two TASK-247 commits (paths `src/auth`, `src/app.ts`, `src/authz/route-manifest.ts`), with "do not modify the database" in the prompt. Record:

```bash
backlog task edit TASK-247 --append-notes "authz-reviewer: <verdict + findings>. Commits <sha-3a>, <sha-3b>."
```

---

### Task 4: First-run setup — token, gate, admin creation (TASK-248)

The `/setup` **page** is built in Task 9a with the other auth screens; this task delivers the server contract it consumes (`GET /api/setup`, `POST /api/setup`, and `409 setup_required` everywhere else).

**Files:**
- Create: `apps/server/src/setup/setup-token.ts`, `apps/server/src/setup/gate.ts`, `apps/server/src/services/setup.ts`, `apps/server/src/routes/setup.ts`, `apps/server/test/setup.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/authz/route-manifest.ts`

**Interfaces:**
- Consumes: `instanceMeta`, `users`, `projectMembers`, `newId()`, `hashToken`, `newSecret`, `tokensMatch`, `hashPassword`, `assertPasswordAcceptable`, `createSession`, `setSessionCookie`, `createRateLimiter`, `clientIp`, `Logger`.
- Produces:
  ```ts
  // src/setup/setup-token.ts
  export const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;
  export const SETUP_TOKEN_HASH_KEY = "setup_token_hash";
  export const SETUP_TOKEN_EXPIRES_KEY = "setup_token_expires_at";
  export function hasAnyUser(db: Db): boolean;
  /** Mints and logs a token while no user exists; clears the stored token otherwise. */
  export function ensureSetupToken(db: Db, log: Logger, now?: number): string | null;
  export function setupTokenMatches(tx: Tx, token: string, now: number): boolean;
  export function clearSetupToken(tx: Tx): void;
  // src/setup/gate.ts
  export function setupGate(db: Db): MiddlewareHandler;   // 409 setup_required
  // src/services/setup.ts
  export interface SetupInput { token: string; email: string; displayName: string; passwordHash: string }
  export function completeSetup(db: Db, input: SetupInput, now?: number): { userId: string };
  // src/routes/setup.ts
  export function setupRoutes(deps: { db: Db; config: Config; limiter?: RateLimiter }): Hono;
  ```
- ROUTE_ACTIONS additions: `"GET /api/setup": "setup"`, `"POST /api/setup": "setup"`.

- [ ] **Step 1: Write the failing setup test**

`apps/server/test/setup.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestApp, makeTestDb, seedProject, seedUser } from "./harness";
import { createLogger } from "../src/log";
import { ensureSetupToken, hasAnyUser, SETUP_TOKEN_TTL_MS } from "../src/setup/setup-token";
import { instanceMeta, users } from "../src/db/schema";
import { SESSION_COOKIE } from "../src/auth/sessions";
import type { Db } from "../src/db/client";

let db: Db;
const ORIGIN = "http://127.0.0.1";

const post = (app: { request: (p: string, i?: RequestInit) => Promise<Response> }, path: string, body: unknown) =>
  app.request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db = makeTestDb();
});

describe("ensureSetupToken", () => {
  it("mints and logs exactly one token while no user exists", () => {
    const lines: string[] = [];
    const token = ensureSetupToken(db, createLogger((l) => lines.push(l)));
    expect(token).toBeString();
    const tokenLines = lines.filter((l) => JSON.parse(l).msg === "setup token");
    expect(tokenLines).toHaveLength(1);
    expect(JSON.parse(tokenLines[0]!).token).toBe(token);
    expect(db.select().from(instanceMeta).all().map((r) => r.key).sort()).toEqual([
      "setup_token_expires_at",
      "setup_token_hash",
    ]);
    // Only the hash is stored.
    expect(JSON.stringify(db.select().from(instanceMeta).all())).not.toContain(token!);
  });

  it("mints a different token on every boot while no admin exists", () => {
    const silent = createLogger(() => {});
    expect(ensureSetupToken(db, silent)).not.toBe(ensureSetupToken(db, silent));
  });

  it("logs nothing and clears the stored token once a user exists", () => {
    const lines: string[] = [];
    ensureSetupToken(db, createLogger(() => {}));
    seedUser(db, "admin@example.test", true);
    expect(ensureSetupToken(db, createLogger((l) => lines.push(l)))).toBeNull();
    expect(lines.filter((l) => JSON.parse(l).msg === "setup token")).toHaveLength(0);
    expect(db.select().from(instanceMeta).all()).toHaveLength(0);
    expect(hasAnyUser(db)).toBe(true);
  });
});

describe("setup gate", () => {
  it("answers 409 setup_required on a project route while no user exists", async () => {
    const { app } = makeTestApp(db);
    const res = await app.request(`${ORIGIN}/api/projects/whatever`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "setup_required" });
  });

  it("does not gate /healthz or /api/setup", async () => {
    const { app } = makeTestApp(db);
    ensureSetupToken(db, createLogger(() => {}));
    expect((await app.request(`${ORIGIN}/healthz`)).status).toBe(200);
    expect((await app.request(`${ORIGIN}/api/setup`)).status).toBe(200);
  });

  it("stops gating once a user exists", async () => {
    const owner = seedUser(db, "owner@example.test");
    const projectId = seedProject(db, owner);
    const { app } = makeTestApp(db);
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}`, {
      headers: { "x-test-actor": JSON.stringify(owner) },
    });
    expect(res.status).toBe(200);
  });
});

describe("POST /api/setup", () => {
  const body = (token: string) => ({
    token,
    email: "admin@example.test",
    displayName: "Admin",
    password: "correct horse battery",
  });

  it("creates the admin, logs them in and closes /api/setup", async () => {
    const token = ensureSetupToken(db, createLogger(() => {}))!;
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/setup", body(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    const row = db.select().from(users).all()[0]!;
    expect(row.email).toBe("admin@example.test");
    expect(row.isAdmin).toBe(true);
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect((await app.request(`${ORIGIN}/api/setup`)).status).toBe(404);
    expect((await post(app, "/api/setup", body(token))).status).toBe(404);
  });

  it("rejects a wrong token and an expired one with the same message", async () => {
    ensureSetupToken(db, createLogger(() => {}));
    const { app } = makeTestApp(db);
    const wrong = await post(app, "/api/setup", body("not-the-token"));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "setup_token_invalid" });

    db.update(instanceMeta)
      .set({ value: String(Date.now() - SETUP_TOKEN_TTL_MS - 1), updatedAt: Date.now() })
      .where(eq(instanceMeta.key, "setup_token_expires_at"))
      .run();
    const expired = await post(app, "/api/setup", body("anything"));
    expect(expired.status).toBe(403);
    expect(await expired.json()).toEqual({ error: "setup_token_invalid" });
    expect(db.select().from(users).all()).toHaveLength(0);
  });

  it("creates exactly one admin under two concurrent submissions", async () => {
    const token = ensureSetupToken(db, createLogger(() => {}))!;
    const { app } = makeTestApp(db);
    const [a, b] = await Promise.all([post(app, "/api/setup", body(token)), post(app, "/api/setup", body(token))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([403, 404]).toContain(statuses[1]);
    expect(db.select().from(users).all()).toHaveLength(1);
  });

  it("rejects a short password before touching the database", async () => {
    const token = ensureSetupToken(db, createLogger(() => {}))!;
    const { app } = makeTestApp(db);
    const res = await post(app, "/api/setup", { ...body(token), password: "short" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "password_too_short" });
    expect(db.select().from(users).all()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/setup.test.ts`
Expected: FAIL — `Cannot find module "../src/setup/setup-token"`.

- [ ] **Step 3: Implement the token module**

`src/setup/setup-token.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import type { Tx } from "../db/tx";
import { instanceMeta, users } from "../db/schema";
import { hashToken, newSecret, tokensMatch } from "../auth/tokens";
import type { Logger } from "../log";

export const SETUP_TOKEN_TTL_MS = 30 * 60 * 1000;
export const SETUP_TOKEN_HASH_KEY = "setup_token_hash";
export const SETUP_TOKEN_EXPIRES_KEY = "setup_token_expires_at";

export function hasAnyUser(db: Db): boolean {
  return db.select({ id: users.id }).from(users).limit(1).get() !== undefined;
}

/**
 * Called once per boot. While the instance has no user it prints a fresh single-use token to
 * stdout (the operator reads it from `docker logs`); a token from a previous boot is replaced,
 * so a log line an attacker saw an hour ago is worthless.
 */
export function ensureSetupToken(db: Db, log: Logger, now = Date.now()): string | null {
  if (hasAnyUser(db)) {
    db.delete(instanceMeta)
      .where(inArray(instanceMeta.key, [SETUP_TOKEN_HASH_KEY, SETUP_TOKEN_EXPIRES_KEY]))
      .run();
    return null;
  }
  const token = newSecret();
  const expiresAt = now + SETUP_TOKEN_TTL_MS;
  const put = (key: string, value: string) =>
    db
      .insert(instanceMeta)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: instanceMeta.key, set: { value, updatedAt: now } })
      .run();
  put(SETUP_TOKEN_HASH_KEY, hashToken(token));
  put(SETUP_TOKEN_EXPIRES_KEY, String(expiresAt));
  log.info("setup token", { token, expires_at: new Date(expiresAt).toISOString() });
  return token;
}

export function setupTokenMatches(tx: Tx, token: string, now: number): boolean {
  const read = (key: string) => tx.select({ value: instanceMeta.value }).from(instanceMeta).where(eq(instanceMeta.key, key)).get()?.value;
  const stored = read(SETUP_TOKEN_HASH_KEY);
  const expiresAt = Number(read(SETUP_TOKEN_EXPIRES_KEY) ?? "0");
  if (!stored || !Number.isFinite(expiresAt) || now >= expiresAt) return false;
  return tokensMatch(stored, hashToken(token));
}

export function clearSetupToken(tx: Tx): void {
  tx.delete(instanceMeta).where(inArray(instanceMeta.key, [SETUP_TOKEN_HASH_KEY, SETUP_TOKEN_EXPIRES_KEY])).run();
}
```

- [ ] **Step 4: Implement the gate**

`src/setup/gate.ts`:

```ts
import type { MiddlewareHandler } from "hono";
import type { Db } from "../db/client";
import { HttpError } from "../http-error";
import { hasAnyUser } from "./setup-token";

/** /api/setup must stay reachable, or the instance could never be set up. */
const EXEMPT = (path: string) => path === "/api/setup" || path.startsWith("/api/setup/");

/**
 * While the instance has no user, API calls answer 409 setup_required as JSON (never a
 * redirect — the SPA decides to show /setup, design §7 step 2). Latched: once a user exists
 * the check is a no-op, so the common case costs nothing.
 */
export function setupGate(db: Db): MiddlewareHandler {
  let ready = false;
  return async (c, next) => {
    if (!ready) {
      if (hasAnyUser(db)) ready = true;
      else if (!EXEMPT(c.req.path)) throw new HttpError(409, "setup_required");
    }
    return next();
  };
}
```

- [ ] **Step 5: Implement completeSetup and the routes**

`src/services/setup.ts`:

```ts
import type { Db } from "../db/client";
import { users } from "../db/schema";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { clearSetupToken, setupTokenMatches } from "../setup/setup-token";

export interface SetupInput {
  token: string;
  email: string;
  displayName: string;
  /** Already hashed by the route: a transaction cannot await (design §5). */
  passwordHash: string;
}

/**
 * BEGIN IMMEDIATE plus a "no users yet" check inside the same transaction: SQLite has one
 * writer, so the second of two concurrent submissions sees the first admin and is refused.
 */
export function completeSetup(db: Db, input: SetupInput, now = Date.now()): { userId: string } {
  return db.transaction(
    (tx) => {
      const existing = tx.select({ id: users.id }).from(users).limit(1).get();
      if (existing) throw new HttpError(404, "not_found");
      if (!setupTokenMatches(tx, input.token, now)) throw new HttpError(403, "setup_token_invalid");
      const userId = newId();
      tx.insert(users)
        .values({
          id: userId,
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
          isAdmin: true,
          createdAt: now,
        })
        .run();
      clearSetupToken(tx);
      return { userId };
    },
    { behavior: "immediate" },
  );
}
```

`src/routes/setup.ts`:

```ts
import { Hono } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { HttpError } from "../http-error";
import { assertPasswordAcceptable, hashPassword } from "../auth/password";
import { setSessionCookie } from "../auth/cookies";
import { createSession } from "../auth/sessions";
import { clientIp, createRateLimiter, type RateLimiter } from "../auth/rate-limit";
import { hasAnyUser } from "../setup/setup-token";
import { completeSetup } from "../services/setup";

const SETUP_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `${field}_required`);
  return value;
}

export function setupRoutes(deps: { db: Db; config: Config; limiter?: RateLimiter }) {
  const limiter = deps.limiter ?? createRateLimiter(SETUP_LIMIT);
  return new Hono()
    .get("/api/setup", (c) => {
      if (hasAnyUser(deps.db)) throw new HttpError(404, "not_found");
      return c.json({ required: true });
    })
    .post("/api/setup", async (c) => {
      if (hasAnyUser(deps.db)) throw new HttpError(404, "not_found");
      if (!limiter.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const token = requireString(body.token, "token");
      const email = requireString(body.email, "email");
      const displayName = requireString(body.displayName, "display_name");
      const password = requireString(body.password, "password");
      assertPasswordAcceptable(password);
      const passwordHash = await hashPassword(password);
      const { userId } = completeSetup(deps.db, { token, email, displayName, passwordHash });
      const { secret, absoluteExpiresAt } = createSession(deps.db, userId);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      return c.json({ id: userId, email, displayName, isAdmin: true });
    });
}
```

- [ ] **Step 6: Wire the gate, the routes and the boot-time token**

`src/app.ts` — inside `createApp`, the `/api/*` middleware order becomes:

```ts
  app.use("/api/*", setupGate(deps.db));
  app.use("/api/*", csrfGuard(deps.config));
  app.use("/api/projects/:id/*", failClosed());
  app.route("/", healthzRoute(deps.health));
  app.route("/", setupRoutes({ db: deps.db, config: deps.config }));
  app.route("/", authRoutes(/* … */, actorOf));
  app.route("/", projectRoutes(deps.db, actorOf));
```

The gate runs first: while the instance is empty, even a CSRF-invalid call gets the honest `setup_required`.

`src/authz/route-manifest.ts` — add `"GET /api/setup": "setup"`, `"POST /api/setup": "setup"`.

`src/index.ts` — after `backupThenMigrate`, before `Bun.serve`:

```ts
  ensureSetupToken(db, log);
```

- [ ] **Step 7: Run to verify it passes**

Run: `bun test test/setup.test.ts`
Expected: PASS (10 tests). The concurrency case relies on the immediate transaction; if both requests answer 200 the check-then-insert is outside the transaction — fix the service, not the test.

Then:
```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green.

- [ ] **Step 8: Verify the boot log by hand**

```bash
cd apps/server
```
```bash
STORYLANE_DATA_DIR=/tmp/sl-setup STORYLANE_PORT=3999 bun src/index.ts serve
```
Expected: one `{"…","msg":"setup token","token":"…"}` line, then `listening`. Stop with Ctrl-C, then:

```bash
rm -rf /tmp/sl-setup
```

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/setup apps/server/src/services/setup.ts apps/server/src/routes/setup.ts apps/server/src/app.ts apps/server/src/index.ts apps/server/src/authz/route-manifest.ts apps/server/test/setup.test.ts
```
```bash
git commit -m "feat(server): first-run setup token, setup_required gate and single-admin creation (TASK-248)"
```

---

### Task 5a: Project and state services (TASK-249)

Services first, routes in Task 5b — both halves are Backlog TASK-249.

**Files:**
- Create: `apps/server/src/services/states.ts`, `apps/server/test/states.test.ts`
- Modify: `apps/server/src/services/projects.ts`

**Interfaces:**
- Consumes: `withProject`, `loadInProject`, `reorder`, `ProjectTx`, `Actor`, `recordActivity`, `bootstrapScope`, `newId()`, `projects`, `projectMembers`, `projectStates`, `stories`, `StateCategory`, `PointScale`, `spec/fixtures/state-templates.json`.
- Produces:
  ```ts
  // src/services/projects.ts (readProject gains the new columns)
  export interface ProjectDetail { id: string; name: string; description: string | null; archivedAt: number | null; role: MemberRole; pointScale: PointScale; customPoints: number[] | null }
  export interface ProjectSummary { id: string; name: string; archivedAt: number | null; role: MemberRole }
  export type ProjectTemplate = "classic" | "minimal";
  export function createProject(db: Db, actor: Actor, input: { name: string; template?: ProjectTemplate }): ProjectDetail;
  export function listProjects(db: Db, actor: Actor): ProjectSummary[];
  export function readProject(tx: ProjectTx): ProjectDetail;
  export function updateProject(tx: ProjectTx, patch: { name?: string; description?: string | null; pointScale?: PointScale; customPoints?: number[] | null }): ProjectDetail;
  export function setArchived(tx: ProjectTx, archived: boolean): ProjectDetail;
  export function deleteProject(tx: ProjectTx): void;
  // src/services/states.ts
  export interface StateRow { id: string; name: string; category: StateCategory; actionLabel: string | null; position: number }
  export function listStates(tx: ProjectTx): StateRow[];
  export function seedTemplateStates(scope: ActivityScope, template: ProjectTemplate): StateRow[];
  export function createState(tx: ProjectTx, input: { name: string; category: StateCategory; actionLabel?: string | null }): StateRow;
  export function updateState(tx: ProjectTx, stateId: string, patch: { name?: string; actionLabel?: string | null; category?: StateCategory }): StateRow;
  export function reorderStates(tx: ProjectTx, orderedIds: string[]): StateRow[];
  export function deleteState(tx: ProjectTx, stateId: string): void;
  ```

- [ ] **Step 1: Write the failing states-service test**

`apps/server/test/states.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import templates from "../../../spec/fixtures/state-templates.json";
import { makeTestDb, seedProject, seedStory, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { createState, deleteState, listStates, reorderStates, updateState } from "../src/services/states";
import { withProject, type Actor } from "../src/db/tx";
import { activityLogs } from "../src/db/schema";
import { HttpError } from "../src/http-error";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;
let member: Actor;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  member = seedUser(db, "member@example.test");
});

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
};

describe("createProject", () => {
  it("makes the creator the owner and seeds the classic template byte for byte", () => {
    const project = createProject(db, owner, { name: "Storylane" });
    expect(project.role).toBe("owner");
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(states.map((s) => ({ name: s.name, category: s.category, position: s.position, actionLabel: s.actionLabel }))).toEqual(
      templates.classic.states,
    );
  });

  it("can seed the minimal template instead", () => {
    const project = createProject(db, owner, { name: "Small", template: "minimal" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(states.map((s) => ({ name: s.name, category: s.category, position: s.position, actionLabel: s.actionLabel }))).toEqual(
      templates.minimal.states,
    );
  });

  it("logs project.created and one state.created per state in the same transaction", () => {
    const project = createProject(db, owner, { name: "Storylane" });
    const rows = db.select().from(activityLogs).all().filter((r) => r.projectId === project.id);
    expect(rows.filter((r) => r.action === "project.created")).toHaveLength(1);
    expect(rows.filter((r) => r.action === "state.created")).toHaveLength(templates.classic.states.length);
    expect(rows.every((r) => r.actorId === (owner as { userId: string }).userId)).toBe(true);
  });
});

describe("state writes", () => {
  it("appends a new state after the last position", () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const created = withProject(db, owner, project.id, "state:write", (tx) =>
      createState(tx, { name: "Blocked", category: "in_progress", actionLabel: "Unblock" }),
    );
    expect(created.position).toBe(templates.minimal.states.length);
  });

  it("renames and relabels but refuses a category change with 409", () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const [first] = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const renamed = withProject(db, owner, project.id, "state:write", (tx) =>
      updateState(tx, first!.id, { name: "Ready", actionLabel: "Begin" }),
    );
    expect(renamed).toMatchObject({ name: "Ready", actionLabel: "Begin", category: "unstarted" });
    expect(
      status(() => withProject(db, owner, project.id, "state:write", (tx) => updateState(tx, first!.id, { category: "done" }))),
    ).toBe(409);
  });

  it("reorders to a full reverse and leaves positions 0..n-1", () => {
    const project = createProject(db, owner, { name: "P" });
    const before = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const reversed = [...before].reverse().map((s) => s.id);
    const after = withProject(db, owner, project.id, "state:write", (tx) => reorderStates(tx, reversed));
    expect(after.map((s) => s.id)).toEqual(reversed);
    expect(after.map((s) => s.position)).toEqual(before.map((_, i) => i));
  });

  it("rejects a reorder that is not a permutation", () => {
    const project = createProject(db, owner, { name: "P" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(() =>
      withProject(db, owner, project.id, "state:write", (tx) => reorderStates(tx, [states[0]!.id])),
    ).toThrow(/permutation/);
  });
});

describe("deleteState", () => {
  it("refuses to remove the last unstarted or the last done state", () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const todo = states.find((s) => s.category === "unstarted")!;
    const done = states.find((s) => s.category === "done")!;
    for (const id of [todo.id, done.id]) {
      expect(status(() => withProject(db, owner, project.id, "state:delete", (tx) => deleteState(tx, id)))).toBe(409);
    }
  });

  it("refuses to remove a state that still holds stories", () => {
    const project = createProject(db, owner, { name: "P" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const spare = states.find((s) => s.category === "in_progress")!;
    seedStory(db, project.id, { stateId: spare.id });
    expect(status(() => withProject(db, owner, project.id, "state:delete", (tx) => deleteState(tx, spare.id)))).toBe(409);
  });

  it("removes an unused spare state and renumbers the rest densely", () => {
    const project = createProject(db, owner, { name: "P" });
    const states = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    const spare = states.find((s) => s.category === "in_progress")!;
    withProject(db, owner, project.id, "state:delete", (tx) => deleteState(tx, spare.id));
    const after = withProject(db, owner, project.id, "state:read", (tx) => listStates(tx));
    expect(after.map((s) => s.id)).not.toContain(spare.id);
    expect(after.map((s) => s.position)).toEqual(after.map((_, i) => i));
  });

  it("returns 404 for a state in another project", () => {
    const mine = createProject(db, owner, { name: "Mine" });
    const theirs = createProject(db, owner, { name: "Theirs" });
    const foreign = withProject(db, owner, theirs.id, "state:read", (tx) => listStates(tx))[0]!;
    expect(status(() => withProject(db, owner, mine.id, "state:delete", (tx) => deleteState(tx, foreign.id)))).toBe(404);
  });
});
```

Archived-project behaviour is asserted through the routes in Task 5b's `projects-routes.test.ts`, where `setArchived` is reachable without touching `.tx` in a test.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/states.test.ts`
Expected: FAIL — `Cannot find module "../src/services/states"`.

- [ ] **Step 3: Implement the states service**

`src/services/states.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import templates from "../../../../spec/fixtures/state-templates.json";
import { projectStates, stories, type StateCategory } from "../db/schema";
import { loadInProject, reorder, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity, type ActivityScope } from "./activity";

export interface StateRow {
  id: string;
  name: string;
  category: StateCategory;
  actionLabel: string | null;
  position: number;
}

export type ProjectTemplate = "classic" | "minimal";

const COLUMNS = {
  id: projectStates.id,
  name: projectStates.name,
  category: projectStates.category,
  actionLabel: projectStates.actionLabel,
  position: projectStates.position,
};

function readAll(scope: ActivityScope): StateRow[] {
  return scope.tx
    .select(COLUMNS)
    .from(projectStates)
    .where(eq(projectStates.projectId, scope.projectId))
    .orderBy(projectStates.position)
    .all();
}

export function listStates(tx: ProjectTx): StateRow[] {
  return readAll(tx);
}

/** Project creation runs before the creator is a member, so this takes an ActivityScope. */
export function seedTemplateStates(scope: ActivityScope, template: ProjectTemplate): StateRow[] {
  const now = Date.now();
  for (const state of templates[template].states) {
    const id = newId();
    scope.tx
      .insert(projectStates)
      .values({
        id,
        projectId: scope.projectId,
        name: state.name,
        category: state.category as StateCategory,
        actionLabel: state.actionLabel,
        position: state.position,
        createdAt: now,
      })
      .run();
    recordActivity(scope, { action: "state.created", payload: { name: state.name, category: state.category } });
  }
  return readAll(scope);
}

export function createState(
  tx: ProjectTx,
  input: { name: string; category: StateCategory; actionLabel?: string | null },
): StateRow {
  const next = tx.tx
    .select({ p: sql<number>`coalesce(max(${projectStates.position}), -1) + 1` })
    .from(projectStates)
    .where(eq(projectStates.projectId, tx.projectId))
    .get();
  const id = newId();
  tx.tx
    .insert(projectStates)
    .values({
      id,
      projectId: tx.projectId,
      name: input.name,
      category: input.category,
      actionLabel: input.actionLabel ?? null,
      position: next?.p ?? 0,
      createdAt: Date.now(),
    })
    .run();
  recordActivity(tx, { action: "state.created", payload: { name: input.name, category: input.category } });
  return readAll(tx).find((s) => s.id === id)!;
}

export function updateState(
  tx: ProjectTx,
  stateId: string,
  patch: { name?: string; actionLabel?: string | null; category?: StateCategory },
): StateRow {
  const current = loadInProject(tx, projectStates, stateId);
  // The DB trigger is the backstop; refusing here gives the client a code it can show.
  if (patch.category !== undefined && patch.category !== current.category) {
    throw new HttpError(409, "state_category_immutable");
  }
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.actionLabel !== undefined) set.actionLabel = patch.actionLabel;
  if (Object.keys(set).length > 0) {
    tx.tx.update(projectStates).set(set as never).where(eq(projectStates.id, stateId)).run();
    recordActivity(tx, { action: "state.updated", payload: { stateId, ...set } });
  }
  return readAll(tx).find((s) => s.id === stateId)!;
}

export function reorderStates(tx: ProjectTx, orderedIds: string[]): StateRow[] {
  reorder(tx, projectStates, eq(projectStates.projectId, tx.projectId), orderedIds);
  recordActivity(tx, { action: "state.reordered", payload: { orderedIds } });
  return readAll(tx);
}

/**
 * A project must always be able to receive and complete work, so at least one `unstarted`
 * and one `done` state survive every delete (spec/data-model.md "Integrity rules").
 */
export function deleteState(tx: ProjectTx, stateId: string): void {
  const state = loadInProject(tx, projectStates, stateId);
  const all = readAll(tx);
  if ((state.category === "unstarted" || state.category === "done") &&
      all.filter((s) => s.category === state.category).length === 1) {
    throw new HttpError(409, "state_last_of_category");
  }
  const inUse = tx.tx
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.stateId, stateId)))
    .limit(1)
    .get();
  if (inUse) throw new HttpError(409, "state_in_use");
  tx.tx.delete(projectStates).where(eq(projectStates.id, stateId)).run();
  reorder(
    tx,
    projectStates,
    eq(projectStates.projectId, tx.projectId),
    all.filter((s) => s.id !== stateId).map((s) => s.id),
  );
  recordActivity(tx, { action: "state.deleted", payload: { stateId, name: state.name } });
}
```

- [ ] **Step 4: Implement the project service additions**

Append to `src/services/projects.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { projectMembers, projects, type PointScale } from "../db/schema";
import { newId } from "../id";
import { bootstrapScope, recordActivity } from "./activity";
import { seedTemplateStates, type ProjectTemplate } from "./states";
import type { Actor, ProjectTx } from "../db/tx";

export interface ProjectSummary {
  id: string;
  name: string;
  archivedAt: number | null;
  role: MemberRole;
}

/**
 * Not project-scoped: there is no project to authorize against yet, so this opens its own
 * immediate transaction and writes its activity rows through bootstrapScope. Any signed-in
 * user may create a project (`"self"` rule in the route manifest).
 */
export function createProject(
  db: Db,
  actor: Actor,
  input: { name: string; template?: ProjectTemplate },
): ProjectDetail {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  if (input.name.trim().length === 0) throw new HttpError(400, "name_required");
  const now = Date.now();
  const id = newId();
  return db.transaction(
    (tx) => {
      tx.insert(projects).values({ id, name: input.name.trim(), createdBy: actor.userId, createdAt: now }).run();
      tx.insert(projectMembers).values({ projectId: id, userId: actor.userId, role: "owner", joinedAt: now }).run();
      const scope = bootstrapScope(tx, id, actor);
      recordActivity(scope, { action: "project.created", payload: { name: input.name.trim() } });
      seedTemplateStates(scope, input.template ?? "classic");
      return { id, name: input.name.trim(), description: null, archivedAt: null, role: "owner" as MemberRole };
    },
    { behavior: "immediate" },
  );
}

/** Archived projects come last (spec/ux-principles.md principle 9 — never interleaved). */
export function listProjects(db: Db, actor: Actor): ProjectSummary[] {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  return db
    .select({
      id: projects.id,
      name: projects.name,
      archivedAt: projects.archivedAt,
      role: projectMembers.role,
    })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)))
    .orderBy(projects.archivedAt, desc(projects.createdAt))
    .all() as ProjectSummary[];
}

export function updateProject(
  tx: ProjectTx,
  patch: { name?: string; description?: string | null; pointScale?: PointScale; customPoints?: number[] | null },
): ProjectDetail {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    if (patch.name.trim().length === 0) throw new HttpError(400, "name_required");
    set.name = patch.name.trim();
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.pointScale !== undefined) set.pointScale = patch.pointScale;
  if (patch.customPoints !== undefined) {
    set.customPoints = patch.customPoints === null ? null : JSON.stringify(patch.customPoints);
  }
  if (Object.keys(set).length > 0) {
    tx.tx.update(projects).set(set as never).where(eq(projects.id, tx.projectId)).run();
    recordActivity(tx, { action: "project.updated", payload: set });
  }
  return readProject(tx);
}

export function setArchived(tx: ProjectTx, archived: boolean): ProjectDetail {
  tx.tx
    .update(projects)
    .set({ archivedAt: archived ? Date.now() : null })
    .where(eq(projects.id, tx.projectId))
    .run();
  recordActivity(tx, { action: archived ? "project.archived" : "project.unarchived", payload: null });
  return readProject(tx);
}

export function deleteProject(tx: ProjectTx): void {
  // Members, states, stories and activity rows all cascade from projects.id.
  tx.tx.delete(projects).where(eq(projects.id, tx.projectId)).run();
}
```

Also extend `readProject` to return the real `description`, `pointScale` and `customPoints` now that migration 0003 added them:

```ts
export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  archivedAt: number | null;
  role: MemberRole;
  pointScale: PointScale;
  customPoints: number[] | null;
}

export function readProject(tx: ProjectTx): ProjectDetail {
  const row = tx.tx
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      archivedAt: projects.archivedAt,
      pointScale: projects.pointScale,
      customPoints: projects.customPoints,
    })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return {
    ...row,
    customPoints: row.customPoints === null ? null : (JSON.parse(row.customPoints) as number[]),
    role: tx.role,
  };
}
```

`createProject`'s return value must be built with the same shape (`pointScale: "fibonacci"`, `customPoints: null`).

- [ ] **Step 5: Run the service tests**

Run: `bun test test/states.test.ts`
Expected: PASS (11 tests).

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/services/projects.ts apps/server/src/services/states.ts apps/server/test/states.test.ts
```
```bash
git commit -m "feat(server): project lifecycle and project_states services with template seeding and two-step reorder (TASK-249)"
```

---

### Task 5b: Project and state routes (TASK-249)

**Files:**
- Create: `apps/server/test/projects-routes.test.ts`
- Modify: `apps/server/src/routes/projects.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`, `apps/server/test/route-matrix.test.ts`

**Interfaces:**
- Consumes: every export of Task 5a, `withProject`, `HttpError`, `STATE_CATEGORIES`.
- Produces: no new module exports; the contract is the route table.
- ROUTE_ACTIONS additions:
  ```ts
  "GET /api/projects": "self",
  "POST /api/projects": "self",
  "PATCH /api/projects/:id": "project:update",
  "DELETE /api/projects/:id": "project:delete",
  "POST /api/projects/:id/archive": "project:archive",
  "POST /api/projects/:id/unarchive": "project:archive",
  "GET /api/projects/:id/states": "state:read",
  "POST /api/projects/:id/states": "state:write",
  "POST /api/projects/:id/states/reorder": "state:write",
  "PATCH /api/projects/:id/states/:stateId": "state:write",
  "DELETE /api/projects/:id/states/:stateId": "state:delete",
  ```
- `MatrixContext` gains `stateId: string` (a spare state, safe to PATCH/DELETE) and `stateIds: string[]` (the project's states, for the reorder body).

- [ ] **Step 1: Write the failing route test**

`apps/server/test/projects-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let viewer: Actor;
let app: { request: (p: string, i?: RequestInit) => Promise<Response> };
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor: Actor) => ({ ...as(actor), "content-type": "application/json", origin: ORIGIN });

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  viewer = seedUser(db, "viewer@example.test");
  app = makeTestApp(db).app;
});

describe("POST /api/projects", () => {
  it("creates a project owned by the caller with seeded states", async () => {
    const res = await app.request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Storylane" }),
    });
    expect(res.status).toBe(201);
    const project = (await res.json()) as { id: string; role: string };
    expect(project.role).toBe("owner");
    const states = await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json();
    expect((states as unknown[]).length).toBe(6);
  });

  it("401s for an anonymous caller and 400s on an empty name", async () => {
    const anon = await app.request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ name: "x" }),
    });
    expect(anon.status).toBe(401);
    const empty = await app.request(`${ORIGIN}/api/projects`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "   " }),
    });
    expect(empty.status).toBe(400);
  });
});

describe("GET /api/projects", () => {
  it("lists only the caller's projects, archived ones last", async () => {
    const mine = createProject(db, owner, { name: "Mine" });
    const archived = createProject(db, owner, { name: "Old" });
    createProject(db, viewer, { name: "Theirs" });
    await app.request(`${ORIGIN}/api/projects/${archived.id}/archive`, { method: "POST", headers: jsonAs(owner), body: "{}" });

    const res = await app.request(`${ORIGIN}/api/projects`, { headers: as(owner) });
    const rows = (await res.json()) as Array<{ id: string; name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["Mine", "Old"]);
    expect(rows[0]!.id).toBe(mine.id);
  });
});

describe("archive and unarchive", () => {
  it("closes writes with 409 while archived and reopens them after unarchive", async () => {
    const project = createProject(db, owner, { name: "P" });
    await app.request(`${ORIGIN}/api/projects/${project.id}/archive`, { method: "POST", headers: jsonAs(owner), body: "{}" });

    const read = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) });
    expect(read.status).toBe(200);

    const write = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Blocked", category: "in_progress" }),
    });
    expect(write.status).toBe(409);
    expect(await write.json()).toEqual({ error: "project_archived" });

    const reopen = await app.request(`${ORIGIN}/api/projects/${project.id}/unarchive`, {
      method: "POST",
      headers: jsonAs(owner),
      body: "{}",
    });
    expect(reopen.status).toBe(200);
    const writeAgain = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Blocked", category: "in_progress" }),
    });
    expect(writeAgain.status).toBe(201);
  });
});

describe("state routes", () => {
  it("lets a member write states and a viewer only read them", async () => {
    const project = createProject(db, owner, { name: "P" });
    db.$client.run("insert into project_members (project_id, user_id, role, joined_at) values (?,?,?,?)", [
      project.id,
      (viewer as { userId: string }).userId,
      "viewer",
      Date.now(),
    ]);
    const read = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(viewer) });
    expect(read.status).toBe(200);
    const write = await app.request(`${ORIGIN}/api/projects/${project.id}/states`, {
      method: "POST",
      headers: jsonAs(viewer),
      body: JSON.stringify({ name: "Nope", category: "in_progress" }),
    });
    expect(write.status).toBe(403);
  });

  it("reorders through the route and answers with the new order", async () => {
    const project = createProject(db, owner, { name: "P", template: "minimal" });
    const states = (await (await app.request(`${ORIGIN}/api/projects/${project.id}/states`, { headers: as(owner) })).json()) as Array<{ id: string }>;
    const reversed = [...states].reverse().map((s) => s.id);
    const res = await app.request(`${ORIGIN}/api/projects/${project.id}/states/reorder`, {
      method: "POST",
      headers: jsonAs(owner),
      body: JSON.stringify({ orderedIds: reversed }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Array<{ id: string }>).map((s) => s.id)).toEqual(reversed);
  });

  it("404s for a state id from another project", async () => {
    const mine = createProject(db, owner, { name: "Mine" });
    const theirs = createProject(db, owner, { name: "Theirs" });
    const foreign = ((await (await app.request(`${ORIGIN}/api/projects/${theirs.id}/states`, { headers: as(owner) })).json()) as Array<{ id: string }>)[0]!;
    const res = await app.request(`${ORIGIN}/api/projects/${mine.id}/states/${foreign.id}`, {
      method: "PATCH",
      headers: jsonAs(owner),
      body: JSON.stringify({ name: "Hijack" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/projects-routes.test.ts`
Expected: FAIL — 404 for every new route.

- [ ] **Step 3: Implement the routes**

`src/routes/projects.ts` (replacing the single-route version):

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { HttpError } from "../http-error";
import {
  createProject,
  deleteProject,
  listProjects,
  readProject,
  setArchived,
  updateProject,
  type ProjectTemplate,
} from "../services/projects";
import { createState, deleteState, listStates, reorderStates, updateState } from "../services/states";
import { STATE_CATEGORIES, type StateCategory } from "../db/schema";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function requireCategory(value: unknown): StateCategory {
  if (typeof value !== "string" || !(STATE_CATEGORIES as readonly string[]).includes(value)) {
    throw new HttpError(400, "category_invalid");
  }
  return value as StateCategory;
}

function requireIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new HttpError(400, "ordered_ids_invalid");
  return value as string[];
}

export function projectRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono()
    .get("/api/projects", (c) => c.json(listProjects(db, actorOf(c))))
    .post("/api/projects", async (c) => {
      const input = await body(c);
      const template = input.template === "minimal" ? ("minimal" as ProjectTemplate) : ("classic" as ProjectTemplate);
      if (typeof input.name !== "string") throw new HttpError(400, "name_required");
      return c.json(createProject(db, actorOf(c), { name: input.name, template }), 201);
    })
    .get("/api/projects/:id", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "project:read", (tx) => readProject(tx))),
    )
    .patch("/api/projects/:id", async (c) => {
      const patch = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "project:update", (tx) => updateProject(tx, patch as never)),
      );
    })
    .delete("/api/projects/:id", (c) => {
      withProject(db, actorOf(c), c.req.param("id"), "project:delete", (tx) => deleteProject(tx));
      return c.body(null, 204);
    })
    .post("/api/projects/:id/archive", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "project:archive", (tx) => setArchived(tx, true))),
    )
    .post("/api/projects/:id/unarchive", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "project:archive", (tx) => setArchived(tx, false))),
    )
    .get("/api/projects/:id/states", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "state:read", (tx) => listStates(tx))),
    )
    .post("/api/projects/:id/states", async (c) => {
      const input = await body(c);
      if (typeof input.name !== "string" || input.name.length === 0) throw new HttpError(400, "name_required");
      const category = requireCategory(input.category);
      const actionLabel = typeof input.actionLabel === "string" ? input.actionLabel : null;
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) =>
          createState(tx, { name: input.name as string, category, actionLabel }),
        ),
        201,
      );
    })
    .post("/api/projects/:id/states/reorder", async (c) => {
      const orderedIds = requireIdList((await body(c)).orderedIds);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) => reorderStates(tx, orderedIds)),
      );
    })
    .patch("/api/projects/:id/states/:stateId", async (c) => {
      const patch = await body(c);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "state:write", (tx) =>
          updateState(tx, c.req.param("stateId"), patch as never),
        ),
      );
    })
    .delete("/api/projects/:id/states/:stateId", (c) => {
      withProject(db, actorOf(c), c.req.param("id"), "state:delete", (tx) => deleteState(tx, c.req.param("stateId")));
      return c.body(null, 204);
    });
}
```

`reorder` must be registered **before** `:stateId` only for the same method; here `POST /states/reorder` and `PATCH /states/:stateId` differ in method, so no shadowing is possible. Keep the order above anyway so the intent is visible.

- [ ] **Step 4: Extend the manifest and matrix fixtures**

Add every route above to `ROUTE_ACTIONS` with the rules listed in this task's Interfaces block. Then in `test/matrix-fixtures.ts`:

```ts
export interface MatrixContext {
  projectId: string;
  /** A spare state the matrix may PATCH and DELETE without breaking the category minimum. */
  stateId: string;
}

export function matrixFixtures(ctx: MatrixContext): Record<string, MatrixFixture> {
  return {
    "POST /api/me/password": { body: { currentPassword: "x", newPassword: "y" } },
    "PATCH /api/projects/:id": { body: { name: "renamed by the matrix" } },
    "POST /api/projects/:id/archive": { body: {} },
    "POST /api/projects/:id/unarchive": { body: {} },
    "POST /api/projects/:id/states": { body: { name: "Matrix", category: "in_progress" } },
    "POST /api/projects/:id/states/reorder": { body: { orderedIds: [] } },
    "PATCH /api/projects/:id/states/:stateId": { params: { stateId: ctx.stateId }, body: { name: "Matrix" } },
    "DELETE /api/projects/:id/states/:stateId": { params: { stateId: ctx.stateId } },
  };
}
```

Two matrix mechanics need care in `route-matrix.test.ts`:

1. `POST /api/projects/:id/states/reorder` with `orderedIds: []` throws `reorder: orderedIds is not a permutation` for the roles that *are* allowed. Give the reorder fixture the project's real state ids instead: `MatrixContext` gains `stateIds: string[]` and the fixture body becomes `{ orderedIds: ctx.stateIds }`.
2. The destructive rows (`DELETE /api/projects/:id`, `DELETE …/states/:stateId`, archive) mutate the shared seeded project, and the matrix iterates roles in a fixed order (anonymous, non-member, viewer, member, owner) — the owner row runs last, so an earlier role never sees a deleted project. Add a comment saying so, and seed a **fresh project per destructive key**:

```ts
// Destructive rows get their own project so the rest of the matrix keeps a live one.
const DESTRUCTIVE = new Set(["DELETE /api/projects/:id", "DELETE /api/projects/:id/states/:stateId"]);
```

In the loop, when `DESTRUCTIVE.has(key)`, seed a new project (with the same three memberships) and its spare state for **each role** and use those ids. Implement with a helper in the test file:

```ts
function freshProject() {
  const id = seedProject(db, ownerA, [
    [memberA, "member"],
    [viewerA, "viewer"],
  ]);
  const stateId = seedState(db, id, { name: "Spare", category: "in_progress", position: 0 });
  seedState(db, id, { name: "Todo", category: "unstarted", position: 1 });
  seedState(db, id, { name: "Done", category: "done", position: 2 });
  return { id, stateId };
}
```

- [ ] **Step 5: Run to verify everything passes**

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green, including 5 roles × 11 project/state routes in the matrix.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/projects.ts apps/server/src/authz/route-manifest.ts apps/server/test/projects-routes.test.ts apps/server/test/matrix-fixtures.ts apps/server/test/route-matrix.test.ts
```
```bash
git commit -m "feat(server): project and state routes with five-actor matrix coverage (TASK-249)"
```

---

### Task 6a: Story logic in `packages/core` and the stories service (TASK-250)

**Files:**
- Create: `packages/core/src/points.ts`, `packages/core/src/points.test.ts`, `apps/server/src/services/stories.ts`, `apps/server/test/stories.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/server/package.json` (add the workspace dependency `"@storylane/core": "workspace:*"`)

**Interfaces:**
- Consumes: `ProjectTx`, `loadInProject`, `reorder`, `recordActivity`, `newId()`, `stories`, `projectStates`, `projects`, `StateCategory`, `StoryType`, `pointScaleValues` (already in `packages/core/src/story-types.ts`).
- Produces:
  ```ts
  // packages/core/src/points.ts
  export function isAllowedPointValue(points: number | null, allowed: readonly number[]): boolean;
  /** spec/features.md "Estimation gate": an unestimated feature may only sit in Icebox or unstarted. */
  export function estimationGateBlocks(input: { storyType: StoryType; points: number | null; targetCategory: StateCategory | null }): boolean;
  /** completed_at is derived from the target state's category (design §5). */
  export function nextCompletedAt(targetCategory: StateCategory | null, currentCompletedAt: number | null, now: number): number | null;
  // apps/server/src/services/stories.ts
  export interface StoryRow {
    id: string; number: number; title: string; description: string | null; storyType: StoryType;
    stateId: string | null; position: number; points: number | null;
    requesterId: string | null; assigneeId: string | null; completedAt: number | null;
  }
  export interface BoardColumn { stateId: string | null; stories: StoryRow[] }
  export interface BoardView { states: StateRow[]; columns: BoardColumn[] }
  export function readBoard(tx: ProjectTx): BoardView;
  export function listStories(tx: ProjectTx): StoryRow[];
  export function createStory(tx: ProjectTx, input: { title: string; description?: string | null; storyType?: StoryType; stateId?: string | null; points?: number | null; assigneeId?: string | null }): StoryRow;
  export function updateStory(tx: ProjectTx, storyId: string, patch: { title?: string; description?: string | null; storyType?: StoryType; points?: number | null; assigneeId?: string | null }): StoryRow;
  export function moveStory(tx: ProjectTx, storyId: string, target: { stateId: string | null; orderedIds: string[] }): StoryRow;
  export function deleteStory(tx: ProjectTx, storyId: string): void;
  ```

- [ ] **Step 1: Write the failing core test**

`packages/core/src/points.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimationGateBlocks, isAllowedPointValue, nextCompletedAt } from "./points";
import { pointScaleValues } from "./story-types";

describe("isAllowedPointValue", () => {
  it("accepts null and any value on the scale, rejects anything else", () => {
    const fib = pointScaleValues("fibonacci", null);
    expect(isAllowedPointValue(null, fib)).toBe(true);
    expect(isAllowedPointValue(8, fib)).toBe(true);
    expect(isAllowedPointValue(4, fib)).toBe(false);
    expect(isAllowedPointValue(2, pointScaleValues("custom", [2, 4, 6]))).toBe(true);
    expect(isAllowedPointValue(3, pointScaleValues("custom", [2, 4, 6]))).toBe(false);
  });
});

describe("estimationGateBlocks", () => {
  it("blocks an unestimated feature outside Icebox and unstarted", () => {
    const unestimated = { storyType: "feature" as const, points: null };
    expect(estimationGateBlocks({ ...unestimated, targetCategory: null })).toBe(false);
    expect(estimationGateBlocks({ ...unestimated, targetCategory: "unstarted" })).toBe(false);
    expect(estimationGateBlocks({ ...unestimated, targetCategory: "in_progress" })).toBe(true);
    expect(estimationGateBlocks({ ...unestimated, targetCategory: "done" })).toBe(true);
    expect(estimationGateBlocks({ ...unestimated, targetCategory: "rejected" })).toBe(true);
  });

  it("never blocks an estimated feature, a chore, a bug without points or a release", () => {
    expect(estimationGateBlocks({ storyType: "feature", points: 3, targetCategory: "done" })).toBe(false);
    expect(estimationGateBlocks({ storyType: "chore", points: null, targetCategory: "done" })).toBe(false);
    expect(estimationGateBlocks({ storyType: "bug", points: null, targetCategory: "in_progress" })).toBe(false);
    expect(estimationGateBlocks({ storyType: "release", points: null, targetCategory: "done" })).toBe(false);
  });
});

describe("nextCompletedAt", () => {
  it("stamps on entering done, keeps the stamp while it stays done, clears on leaving", () => {
    expect(nextCompletedAt("done", null, 1_000)).toBe(1_000);
    expect(nextCompletedAt("done", 500, 1_000)).toBe(500);
    expect(nextCompletedAt("in_progress", 500, 1_000)).toBeNull();
    expect(nextCompletedAt(null, 500, 1_000)).toBeNull();
    expect(nextCompletedAt("rejected", 500, 1_000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @storylane/core exec vitest run src/points.test.ts`
Expected: FAIL — cannot resolve `./points`.

- [ ] **Step 3: Implement `packages/core/src/points.ts`**

```ts
import type { StateCategory } from "./story-state";
import type { StoryType } from "./story-types";

/** Points are chosen from the project's scale, never free numeric input (spec/features.md). */
export function isAllowedPointValue(points: number | null, allowed: readonly number[]): boolean {
  if (points === null) return true;
  return allowed.includes(points);
}

/**
 * spec/features.md "Estimation gate": an unestimated `feature` may only sit in the Icebox
 * (`targetCategory === null`) or an `unstarted`-category state. Other types are never gated —
 * chore/release carry no points at all, and a bug's points are optional.
 */
export function estimationGateBlocks(input: {
  storyType: StoryType;
  points: number | null;
  targetCategory: StateCategory | null;
}): boolean {
  if (input.storyType !== "feature" || input.points !== null) return false;
  return input.targetCategory !== null && input.targetCategory !== "unstarted";
}

/**
 * `completed_at` follows the target state's *category*, never its name: set when the story
 * enters a `done` state, preserved while it stays there, cleared whenever it leaves.
 */
export function nextCompletedAt(
  targetCategory: StateCategory | null,
  currentCompletedAt: number | null,
  now: number,
): number | null {
  if (targetCategory !== "done") return null;
  return currentCompletedAt ?? now;
}
```

Add `export * from "./points";` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @storylane/core test`
Expected: PASS (the new file plus the existing core suites).

- [ ] **Step 5: Write the failing stories-service test**

`apps/server/test/stories.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { listStates } from "../src/services/states";
import { createStory, deleteStory, moveStory, readBoard, updateStory } from "../src/services/stories";
import { withProject, type Actor } from "../src/db/tx";
import { activityLogs, stories } from "../src/db/schema";
import { HttpError } from "../src/http-error";
import type { Db } from "../src/db/client";
import type { StateRow } from "../src/services/states";

let db: Db;
let owner: Actor;
let projectId: string;
let states: StateRow[];

const at = (category: string) => states.find((s) => s.category === category)!;

const write = <T>(fn: (tx: Parameters<Parameters<typeof withProject>[4]>[0]) => T): T =>
  withProject(db, owner, projectId, "story:write", fn) as T;
const read = <T>(fn: (tx: Parameters<Parameters<typeof withProject>[4]>[0]) => T): T =>
  withProject(db, owner, projectId, "story:read", fn) as T;

const status = (fn: () => unknown) => {
  try {
    fn();
    return 200;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
};

const activityFor = (action: string) => db.select().from(activityLogs).all().filter((r) => r.action === action);

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = createProject(db, owner, { name: "P" }).id;
  states = withProject(db, owner, projectId, "state:read", (tx) => listStates(tx));
});

describe("createStory", () => {
  it("lands in the Icebox with number 1 and position 0", () => {
    const story = write((tx) => createStory(tx, { title: "First" }));
    expect(story).toMatchObject({ number: 1, position: 0, stateId: null, storyType: "feature", points: null });
  });

  it("gives consecutive numbers across separate transactions and per project", () => {
    write((tx) => createStory(tx, { title: "a" }));
    write((tx) => createStory(tx, { title: "b" }));
    const third = write((tx) => createStory(tx, { title: "c" }));
    expect(third.number).toBe(3);
    const other = createProject(db, owner, { name: "Other" }).id;
    const elsewhere = withProject(db, owner, other, "story:write", (tx) => createStory(tx, { title: "a" }));
    expect(elsewhere.number).toBe(1);
  });

  it("appends at the end of its column", () => {
    const stateId = at("unstarted").id;
    write((tx) => createStory(tx, { title: "a", stateId, points: 1 }));
    const second = write((tx) => createStory(tx, { title: "b", stateId, points: 1 }));
    expect(second.position).toBe(1);
  });

  it("refuses a point value that is not on the project's scale", () => {
    expect(status(() => write((tx) => createStory(tx, { title: "a", points: 4 })))).toBe(400);
  });

  it("applies the estimation gate", () => {
    expect(status(() => write((tx) => createStory(tx, { title: "a", stateId: at("in_progress").id })))).toBe(409);
    expect(status(() => write((tx) => createStory(tx, { title: "a", stateId: at("unstarted").id })))).toBe(200);
  });

  it("refuses a state from another project with 404", () => {
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreign = withProject(db, owner, other, "state:read", (tx) => listStates(tx))[0]!;
    expect(status(() => write((tx) => createStory(tx, { title: "a", stateId: foreign.id })))).toBe(404);
  });

  it("writes exactly one story.created row and rolls both back together", () => {
    write((tx) => createStory(tx, { title: "a" }));
    expect(activityFor("story.created")).toHaveLength(1);
    expect(() =>
      write((tx) => {
        createStory(tx, { title: "doomed" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(activityFor("story.created")).toHaveLength(1);
    expect(db.select().from(stories).all()).toHaveLength(1);
  });
});

describe("updateStory", () => {
  it("changes fields, bumps updated_at and logs one story.updated row", () => {
    const story = write((tx) => createStory(tx, { title: "a" }));
    const updated = write((tx) => updateStory(tx, story.id, { title: "b", points: 3, storyType: "bug" }));
    expect(updated).toMatchObject({ title: "b", points: 3, storyType: "bug" });
    expect(activityFor("story.updated")).toHaveLength(1);
  });

  it("cannot change the story's number (no such field) and the trigger backs it up", () => {
    const story = write((tx) => createStory(tx, { title: "a" }));
    expect(() => db.$client.run("update stories set number = 99 where id = ?", [story.id])).toThrow(
      /stories.number is pinned/,
    );
  });

  it("refuses to remove the estimate from a feature that sits past unstarted", () => {
    const story = write((tx) => createStory(tx, { title: "a", stateId: at("unstarted").id, points: 3 }));
    write((tx) => moveStory(tx, story.id, { stateId: at("in_progress").id, orderedIds: [story.id] }));
    expect(status(() => write((tx) => updateStory(tx, story.id, { points: null })))).toBe(409);
  });
});

describe("moveStory", () => {
  it("sets completed_at when entering a done state and clears it when leaving", () => {
    const story = write((tx) => createStory(tx, { title: "a", stateId: at("unstarted").id, points: 2 }));
    const done = write((tx) => moveStory(tx, story.id, { stateId: at("done").id, orderedIds: [story.id] }));
    expect(done.completedAt).toBeGreaterThan(0);
    const back = write((tx) => moveStory(tx, story.id, { stateId: at("in_progress").id, orderedIds: [story.id] }));
    expect(back.completedAt).toBeNull();
  });

  it("moving to the Icebox clears state and completed_at", () => {
    const story = write((tx) => createStory(tx, { title: "a", stateId: at("done").id, points: 2 }));
    const iced = write((tx) => moveStory(tx, story.id, { stateId: null, orderedIds: [story.id] }));
    expect(iced.stateId).toBeNull();
    expect(iced.completedAt).toBeNull();
  });

  it("reorders within a column to a full reverse, positions 0..n-1", () => {
    const stateId = at("unstarted").id;
    const ids = [0, 1, 2, 3].map((i) => write((tx) => createStory(tx, { title: `s${i}`, stateId, points: 1 })).id);
    const reversed = [...ids].reverse();
    write((tx) => moveStory(tx, reversed[0]!, { stateId, orderedIds: reversed }));
    const board = read((tx) => readBoard(tx));
    const column = board.columns.find((col) => col.stateId === stateId)!;
    expect(column.stories.map((s) => s.id)).toEqual(reversed);
    expect(column.stories.map((s) => s.position)).toEqual([0, 1, 2, 3]);
  });

  it("logs story.state_changed on a state change and story.moved on a pure reorder", () => {
    const stateId = at("unstarted").id;
    const a = write((tx) => createStory(tx, { title: "a", stateId, points: 1 })).id;
    const b = write((tx) => createStory(tx, { title: "b", stateId, points: 1 })).id;
    write((tx) => moveStory(tx, a, { stateId, orderedIds: [b, a] }));
    expect(activityFor("story.moved")).toHaveLength(1);
    expect(activityFor("story.state_changed")).toHaveLength(0);
    write((tx) => moveStory(tx, a, { stateId: at("in_progress").id, orderedIds: [a] }));
    expect(activityFor("story.state_changed")).toHaveLength(1);
  });

  it("rejects an orderedIds list that is not the target column after the move", () => {
    const stateId = at("unstarted").id;
    const a = write((tx) => createStory(tx, { title: "a", stateId, points: 1 })).id;
    write((tx) => createStory(tx, { title: "b", stateId, points: 1 }));
    expect(() => write((tx) => moveStory(tx, a, { stateId, orderedIds: [a] }))).toThrow(/permutation/);
  });

  it("applies the estimation gate on the move path too", () => {
    const story = write((tx) => createStory(tx, { title: "a" }));
    expect(
      status(() => write((tx) => moveStory(tx, story.id, { stateId: at("in_progress").id, orderedIds: [story.id] }))),
    ).toBe(409);
  });
});

describe("deleteStory", () => {
  it("keeps the activity trail with story_id nulled and logs story.deleted", () => {
    const story = write((tx) => createStory(tx, { title: "a" }));
    withProject(db, owner, projectId, "story:delete", (tx) => deleteStory(tx, story.id));
    expect(db.select().from(stories).all()).toHaveLength(0);
    const rows = db.select().from(activityLogs).all();
    expect(rows.every((r) => r.storyId === null)).toBe(true);
    expect(activityFor("story.deleted")).toHaveLength(1);
    expect(JSON.parse(activityFor("story.deleted")[0]!.payload!)).toMatchObject({ number: 1, title: "a" });
  });

  it("404s for a story in another project", () => {
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreign = withProject(db, owner, other, "story:write", (tx) => createStory(tx, { title: "x" }));
    expect(
      status(() => withProject(db, owner, projectId, "story:delete", (tx) => deleteStory(tx, foreign.id))),
    ).toBe(404);
  });
});

describe("readBoard", () => {
  it("returns the states in position order and one column per state plus the Icebox", () => {
    write((tx) => createStory(tx, { title: "iced" }));
    write((tx) => createStory(tx, { title: "todo", stateId: at("unstarted").id, points: 1 }));
    const board = read((tx) => readBoard(tx));
    expect(board.states.map((s) => s.position)).toEqual(board.states.map((_, i) => i));
    expect(board.columns[0]!.stateId).toBeNull();
    expect(board.columns[0]!.stories.map((s) => s.title)).toEqual(["iced"]);
    expect(board.columns.length).toBe(board.states.length + 1);
    // Every story in the project appears exactly once.
    const seen = board.columns.flatMap((col) => col.stories.map((s) => s.id));
    expect(new Set(seen).size).toBe(2);
  });
});
```

Add `import { eq } from "drizzle-orm";` only if the final file uses it; drop the import otherwise (`noUnusedLocals`).

- [ ] **Step 6: Run to verify it fails**

Run: `cd apps/server` then `bun test test/stories.test.ts`
Expected: FAIL — `Cannot find module "../src/services/stories"`.

- [ ] **Step 7: Implement the stories service**

Add the workspace dependency first:

```bash
pnpm --filter @storylane/server add @storylane/core@workspace:*
```

`src/services/stories.ts`:

```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { estimationGateBlocks, isAllowedPointValue, nextCompletedAt, pointScaleValues } from "@storylane/core";
import { activityLogs, projects, projectStates, stories, type StateCategory, type StoryType } from "../db/schema";
import { loadInProject, reorder, type ProjectTx } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { recordActivity } from "./activity";
import { listStates, type StateRow } from "./states";

export interface StoryRow {
  id: string;
  number: number;
  title: string;
  description: string | null;
  storyType: StoryType;
  stateId: string | null;
  position: number;
  points: number | null;
  requesterId: string | null;
  assigneeId: string | null;
  completedAt: number | null;
}

export interface BoardColumn {
  stateId: string | null;
  stories: StoryRow[];
}

export interface BoardView {
  states: StateRow[];
  columns: BoardColumn[];
}

const COLUMNS = {
  id: stories.id,
  number: stories.number,
  title: stories.title,
  description: stories.description,
  storyType: stories.storyType,
  stateId: stories.stateId,
  position: stories.position,
  points: stories.points,
  requesterId: stories.requesterId,
  assigneeId: stories.assigneeId,
  completedAt: stories.completedAt,
};

/** Scope for `reorder` and for MAX(position): one column of the board. */
const columnScope = (stateId: string | null) =>
  stateId === null ? isNull(stories.stateId) : eq(stories.stateId, stateId);

function allowedPoints(tx: ProjectTx): number[] {
  const project = tx.tx
    .select({ pointScale: projects.pointScale, customPoints: projects.customPoints })
    .from(projects)
    .where(eq(projects.id, tx.projectId))
    .get();
  if (!project) throw new HttpError(404, "not_found");
  return pointScaleValues(project.pointScale, project.customPoints === null ? null : (JSON.parse(project.customPoints) as number[]));
}

/** null stateId = Icebox, which has no category. Any other id must live in this project. */
function categoryOf(tx: ProjectTx, stateId: string | null): StateCategory | null {
  if (stateId === null) return null;
  return loadInProject(tx, projectStates, stateId).category;
}

function readOne(tx: ProjectTx, storyId: string): StoryRow {
  const row = tx.tx
    .select(COLUMNS)
    .from(stories)
    .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  return row as StoryRow;
}

export function listStories(tx: ProjectTx): StoryRow[] {
  return tx.tx
    .select(COLUMNS)
    .from(stories)
    .where(eq(stories.projectId, tx.projectId))
    .orderBy(stories.position, stories.number)
    .all() as StoryRow[];
}

export function readBoard(tx: ProjectTx): BoardView {
  const states = listStates(tx);
  const all = listStories(tx);
  // The Icebox column comes first: it is where new stories land (spec/features.md).
  const columns: BoardColumn[] = [{ stateId: null, stories: [] }, ...states.map((s) => ({ stateId: s.id, stories: [] as StoryRow[] }))];
  const byState = new Map(columns.map((col) => [col.stateId, col]));
  for (const story of all) byState.get(story.stateId)?.stories.push(story);
  for (const col of columns) col.stories.sort((a, b) => a.position - b.position || a.number - b.number);
  return { states, columns };
}

function assertPlaceable(tx: ProjectTx, story: { storyType: StoryType; points: number | null }, stateId: string | null): StateCategory | null {
  const targetCategory = categoryOf(tx, stateId);
  if (estimationGateBlocks({ storyType: story.storyType, points: story.points, targetCategory })) {
    throw new HttpError(409, "estimate_required");
  }
  return targetCategory;
}

export function createStory(
  tx: ProjectTx,
  input: {
    title: string;
    description?: string | null;
    storyType?: StoryType;
    stateId?: string | null;
    points?: number | null;
    assigneeId?: string | null;
  },
): StoryRow {
  if (input.title.trim().length === 0) throw new HttpError(400, "title_required");
  const storyType = input.storyType ?? "feature";
  const points = input.points ?? null;
  if (!isAllowedPointValue(points, allowedPoints(tx))) throw new HttpError(400, "points_off_scale");
  const stateId = input.stateId ?? null;
  const targetCategory = assertPlaceable(tx, { storyType, points }, stateId);
  const now = Date.now();
  // MAX+1 inside this transaction; safe under SQLite's single writer (design §5).
  const nextNumber = tx.tx
    .select({ n: sql<number>`coalesce(max(${stories.number}), 0) + 1` })
    .from(stories)
    .where(eq(stories.projectId, tx.projectId))
    .get();
  const nextPosition = tx.tx
    .select({ p: sql<number>`coalesce(max(${stories.position}), -1) + 1` })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), columnScope(stateId)))
    .get();
  const id = newId();
  tx.tx
    .insert(stories)
    .values({
      id,
      projectId: tx.projectId,
      number: nextNumber?.n ?? 1,
      title: input.title.trim(),
      description: input.description ?? null,
      storyType,
      stateId,
      position: nextPosition?.p ?? 0,
      points,
      requesterId: tx.actor.kind === "user" ? tx.actor.userId : null,
      assigneeId: input.assigneeId ?? null,
      completedAt: nextCompletedAt(targetCategory, null, now),
      createdBy: tx.actor.kind === "user" ? tx.actor.userId : (() => { throw new HttpError(401, "unauthenticated"); })(),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  recordActivity(tx, { action: "story.created", storyId: id, payload: { title: input.title.trim(), stateId } });
  return readOne(tx, id);
}

export function updateStory(
  tx: ProjectTx,
  storyId: string,
  patch: {
    title?: string;
    description?: string | null;
    storyType?: StoryType;
    points?: number | null;
    assigneeId?: string | null;
  },
): StoryRow {
  const current = readOne(tx, storyId);
  const storyType = patch.storyType ?? current.storyType;
  const points = patch.points === undefined ? current.points : patch.points;
  if (!isAllowedPointValue(points, allowedPoints(tx))) throw new HttpError(400, "points_off_scale");
  // Removing an estimate must not leave the story parked past the gate.
  assertPlaceable(tx, { storyType, points }, current.stateId);
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.title !== undefined) {
    if (patch.title.trim().length === 0) throw new HttpError(400, "title_required");
    set.title = patch.title.trim();
  }
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.storyType !== undefined) set.storyType = patch.storyType;
  if (patch.points !== undefined) set.points = patch.points;
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
  tx.tx.update(stories).set(set as never).where(eq(stories.id, storyId)).run();
  recordActivity(tx, { action: "story.updated", storyId, payload: set });
  return readOne(tx, storyId);
}

/**
 * One call does both jobs the board's drag produces: the target state (which decides
 * completed_at) and the new order of the target column. `orderedIds` must be exactly the
 * target column's stories *after* the move, so the client sends what it drew.
 */
export function moveStory(
  tx: ProjectTx,
  storyId: string,
  target: { stateId: string | null; orderedIds: string[] },
): StoryRow {
  const current = readOne(tx, storyId);
  const targetCategory = assertPlaceable(tx, current, target.stateId);
  const stateChanged = current.stateId !== target.stateId;
  const now = Date.now();
  tx.tx
    .update(stories)
    .set({
      stateId: target.stateId,
      completedAt: nextCompletedAt(targetCategory, stateChanged ? null : current.completedAt, now),
      updatedAt: now,
    })
    .where(eq(stories.id, storyId))
    .run();
  reorder(tx, stories, columnScope(target.stateId), target.orderedIds);
  if (stateChanged) {
    // Also renumber the column the story left, so it stays dense.
    const leftBehind = tx.tx
      .select({ id: stories.id })
      .from(stories)
      .where(and(eq(stories.projectId, tx.projectId), columnScope(current.stateId)))
      .orderBy(stories.position)
      .all()
      .map((r) => r.id);
    reorder(tx, stories, columnScope(current.stateId), leftBehind);
  }
  recordActivity(tx, {
    action: stateChanged ? "story.state_changed" : "story.moved",
    storyId,
    payload: { from: current.stateId, to: target.stateId, orderedIds: target.orderedIds },
  });
  return readOne(tx, storyId);
}

export function deleteStory(tx: ProjectTx, storyId: string): void {
  const story = readOne(tx, storyId);
  // Keep the trail, lose the pointer (design §5: the log survives with story_id nulled).
  tx.tx.update(activityLogs).set({ storyId: null }).where(eq(activityLogs.storyId, storyId)).run();
  tx.tx.delete(stories).where(eq(stories.id, storyId)).run();
  const remaining = tx.tx
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), columnScope(story.stateId)))
    .orderBy(stories.position)
    .all()
    .map((r) => r.id);
  reorder(tx, stories, columnScope(story.stateId), remaining);
  // storyId stays null: the row is gone, and the activity_logs trigger rejects a dangling id.
  recordActivity(tx, {
    action: "story.deleted",
    payload: { storyId, number: story.number, title: story.title },
  });
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `bun test test/stories.test.ts`
Expected: PASS (18 tests). If `reorder` complains about a permutation in `moveStory`, the client's `orderedIds` did not include the moved story — that is the intended error; check the test's expectation, not the service.

- [ ] **Step 9: Verify and commit**

```bash
pnpm --filter @storylane/core test
```
```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green.

```bash
git add packages/core/src/points.ts packages/core/src/points.test.ts packages/core/src/index.ts apps/server/src/services/stories.ts apps/server/test/stories.test.ts apps/server/package.json pnpm-lock.yaml
```
```bash
git commit -m "feat(server): stories service with MAX+1 numbering, estimation gate, category-driven completed_at and activity rows (TASK-250)"
```

---

### Task 6b: Story and board routes (TASK-250)

**Files:**
- Create: `apps/server/src/routes/stories.ts`, `apps/server/test/stories-routes.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`, `apps/server/test/route-matrix.test.ts`

**Interfaces:**
- Consumes: every export of Task 6a, `withProject`, `HttpError`, `STORY_TYPES`.
- Produces:
  ```ts
  export function storyRoutes(db: Db, actorOf: (c: Context) => Actor): Hono;
  ```
- ROUTE_ACTIONS additions:
  ```ts
  "GET /api/projects/:id/board": "story:read",
  "GET /api/projects/:id/stories": "story:read",
  "POST /api/projects/:id/stories": "story:write",
  "PATCH /api/projects/:id/stories/:storyId": "story:write",
  "POST /api/projects/:id/stories/:storyId/move": "story:write",
  "DELETE /api/projects/:id/stories/:storyId": "story:delete",
  ```
- `MatrixContext` gains `storyId: string` (a story in the seeded project, plus a fresh one for the destructive DELETE row).

- [ ] **Step 1: Write the failing route test**

`apps/server/test/stories-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { listStates } from "../src/services/states";
import { withProject, type Actor } from "../src/db/tx";
import type { Db } from "../src/db/client";

let db: Db;
let owner: Actor;
let member: Actor;
let viewer: Actor;
let projectId: string;
let stateIds: Record<string, string>;
let app: { request: (p: string, i?: RequestInit) => Promise<Response> };
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor: Actor) => ({ ...as(actor), "content-type": "application/json", origin: ORIGIN });

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  member = seedUser(db, "member@example.test");
  viewer = seedUser(db, "viewer@example.test");
  projectId = createProject(db, owner, { name: "P" }).id;
  for (const [actor, role] of [
    [member, "member"],
    [viewer, "viewer"],
  ] as const) {
    db.$client.run("insert into project_members (project_id, user_id, role, joined_at) values (?,?,?,?)", [
      projectId,
      (actor as { userId: string }).userId,
      role,
      Date.now(),
    ]);
  }
  const states = withProject(db, owner, projectId, "state:read", (tx) => listStates(tx));
  stateIds = Object.fromEntries(states.map((s) => [s.category, s.id]));
  app = makeTestApp(db).app;
});

const createStory = (actor: Actor, body: unknown) =>
  app.request(`${ORIGIN}/api/projects/${projectId}/stories`, {
    method: "POST",
    headers: jsonAs(actor),
    body: JSON.stringify(body),
  });

describe("story routes", () => {
  it("lets a member create and move a story, and a viewer only read", async () => {
    const created = await createStory(member, { title: "Ship it", points: 2, stateId: stateIds.unstarted });
    expect(created.status).toBe(201);
    const story = (await created.json()) as { id: string; number: number };
    expect(story.number).toBe(1);

    const forbidden = await createStory(viewer, { title: "No" });
    expect(forbidden.status).toBe(403);

    const board = await app.request(`${ORIGIN}/api/projects/${projectId}/board`, { headers: as(viewer) });
    expect(board.status).toBe(200);

    const moved = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}/move`, {
      method: "POST",
      headers: jsonAs(member),
      body: JSON.stringify({ stateId: stateIds.done, orderedIds: [story.id] }),
    });
    expect(moved.status).toBe(200);
    expect((await moved.json()) as { completedAt: number | null }).toMatchObject({ stateId: stateIds.done });
    expect(((await (await app.request(`${ORIGIN}/api/projects/${projectId}/board`, { headers: as(member) })).json()) as { columns: Array<{ stateId: string | null; stories: unknown[] }> }).columns.find((c) => c.stateId === stateIds.done)!.stories).toHaveLength(1);
  });

  it("only the owner may delete", async () => {
    const story = (await (await createStory(member, { title: "a" })).json()) as { id: string };
    const asMember = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}`, {
      method: "DELETE",
      headers: jsonAs(member),
    });
    expect(asMember.status).toBe(403);
    const asOwner = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${story.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(asOwner.status).toBe(204);
  });

  it("surfaces the estimation gate as 409 and an off-scale estimate as 400", async () => {
    const gated = await createStory(member, { title: "a", stateId: stateIds.in_progress });
    expect(gated.status).toBe(409);
    expect(await gated.json()).toEqual({ error: "estimate_required" });
    const offScale = await createStory(member, { title: "a", points: 4 });
    expect(offScale.status).toBe(400);
    expect(await offScale.json()).toEqual({ error: "points_off_scale" });
  });

  it("rejects an unknown story type with 400 and a foreign story id with 404", async () => {
    const badType = await createStory(member, { title: "a", storyType: "epic" });
    expect(badType.status).toBe(400);
    const other = createProject(db, owner, { name: "Other" }).id;
    const foreign = (await (
      await app.request(`${ORIGIN}/api/projects/${other}/stories`, {
        method: "POST",
        headers: jsonAs(owner),
        body: JSON.stringify({ title: "x" }),
      })
    ).json()) as { id: string };
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/stories/${foreign.id}`, {
      method: "PATCH",
      headers: jsonAs(member),
      body: JSON.stringify({ title: "hijack" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/stories-routes.test.ts`
Expected: FAIL — 404 for every story route.

- [ ] **Step 3: Implement the routes**

`src/routes/stories.ts`:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { HttpError } from "../http-error";
import { STORY_TYPES, type StoryType } from "../db/schema";
import { createStory, deleteStory, listStories, moveStory, readBoard, updateStory } from "../services/stories";

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function optionalStoryType(value: unknown): StoryType | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(STORY_TYPES as readonly string[]).includes(value)) {
    throw new HttpError(400, "story_type_invalid");
  }
  return value as StoryType;
}

function optionalPoints(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new HttpError(400, "points_invalid");
  return value;
}

function optionalStateId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "state_id_invalid");
  return value;
}

function requireIdList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new HttpError(400, "ordered_ids_invalid");
  return value as string[];
}

export function storyRoutes(db: Db, actorOf: (c: Context) => Actor) {
  return new Hono()
    .get("/api/projects/:id/board", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => readBoard(tx))),
    )
    .get("/api/projects/:id/stories", (c) =>
      c.json(withProject(db, actorOf(c), c.req.param("id"), "story:read", (tx) => listStories(tx))),
    )
    .post("/api/projects/:id/stories", async (c) => {
      const input = await body(c);
      if (typeof input.title !== "string") throw new HttpError(400, "title_required");
      const storyType = optionalStoryType(input.storyType);
      const points = optionalPoints(input.points);
      const stateId = optionalStateId(input.stateId);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:write", (tx) =>
          createStory(tx, {
            title: input.title as string,
            description: typeof input.description === "string" ? input.description : null,
            ...(storyType === undefined ? {} : { storyType }),
            ...(points === undefined ? {} : { points }),
            ...(stateId === undefined ? {} : { stateId }),
          }),
        ),
        201,
      );
    })
    .patch("/api/projects/:id/stories/:storyId", async (c) => {
      const input = await body(c);
      const storyType = optionalStoryType(input.storyType);
      const points = optionalPoints(input.points);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:write", (tx) =>
          updateStory(tx, c.req.param("storyId"), {
            ...(typeof input.title === "string" ? { title: input.title } : {}),
            ...(input.description === undefined ? {} : { description: input.description as string | null }),
            ...(storyType === undefined ? {} : { storyType }),
            ...(points === undefined ? {} : { points }),
            ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId as string | null }),
          }),
        ),
      );
    })
    .post("/api/projects/:id/stories/:storyId/move", async (c) => {
      const input = await body(c);
      const stateId = optionalStateId(input.stateId);
      if (stateId === undefined) throw new HttpError(400, "state_id_required");
      const orderedIds = requireIdList(input.orderedIds);
      return c.json(
        withProject(db, actorOf(c), c.req.param("id"), "story:write", (tx) =>
          moveStory(tx, c.req.param("storyId"), { stateId, orderedIds }),
        ),
      );
    })
    .delete("/api/projects/:id/stories/:storyId", (c) => {
      withProject(db, actorOf(c), c.req.param("id"), "story:delete", (tx) => deleteStory(tx, c.req.param("storyId")));
      return c.body(null, 204);
    });
}
```

In `src/app.ts`, register it after the project routes: `app.route("/", storyRoutes(deps.db, actorOf));`.

- [ ] **Step 4: Extend the manifest and matrix fixtures**

Add the six entries listed above to `ROUTE_ACTIONS`. In `test/matrix-fixtures.ts`, `MatrixContext` gains `storyId: string` and the fixtures gain:

```ts
    "POST /api/projects/:id/stories": { body: { title: "Matrix story" } },
    "PATCH /api/projects/:id/stories/:storyId": { params: { storyId: ctx.storyId }, body: { title: "Matrix" } },
    "POST /api/projects/:id/stories/:storyId/move": {
      params: { storyId: ctx.storyId },
      body: { stateId: null, orderedIds: ctx.iceboxOrder },
    },
    "DELETE /api/projects/:id/stories/:storyId": { params: { storyId: ctx.storyId } },
```

`MatrixContext` therefore also carries `iceboxOrder: string[]` — the Icebox column's ids after the move (for the seeded fixture that is `[ctx.storyId]`). In `route-matrix.test.ts` seed one Icebox story next to the spare state, add `DELETE /api/projects/:id/stories/:storyId` to the `DESTRUCTIVE` set, and give the destructive rows a per-role fresh project **and** a fresh story.

- [ ] **Step 5: Run to verify everything passes**

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green, including 5 roles × 17 project-scoped routes.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/stories.ts apps/server/src/app.ts apps/server/src/authz/route-manifest.ts apps/server/test/stories-routes.test.ts apps/server/test/matrix-fixtures.ts apps/server/test/route-matrix.test.ts
```
```bash
git commit -m "feat(server): story and board routes with five-actor matrix coverage (TASK-250)"
```

---

### Task 7: Realtime — in-process bus and SSE invalidation (TASK-251)

**Files:**
- Create: `apps/server/src/events/bus.ts`, `apps/server/src/events/emit.ts`, `apps/server/src/routes/events.ts`, `apps/server/test/events-bus.test.ts`, `apps/server/test/events-sse.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/src/routes/projects.ts`, `apps/server/src/routes/stories.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/harness.ts`, `apps/server/test/matrix-fixtures.ts` (`NotPromise` is already exported from `src/db/tx.ts` by Task 1a)

**Interfaces:**
- Consumes: `withProject`, `Action`, `ProjectTx`, `Actor`, `Db`, `NotPromise`.
- Produces:
  ```ts
  // src/events/bus.ts
  export interface ProjectChanged { type: "project.changed"; projectId: string }
  export class EventBus {
    subscribe(projectId: string, listener: (event: ProjectChanged) => void): () => void;   // returns unsubscribe
    publish(projectId: string): void;
    subscriberCount(projectId?: string): number;
  }
  // src/events/emit.ts
  export interface ChangeDeps { db: Db; bus: EventBus }
  /** withProject, then publish once the transaction has committed. */
  export function withProjectChange<T>(deps: ChangeDeps, actor: Actor, projectId: string, action: Action, fn: (tx: ProjectTx) => NotPromise<T>): T;
  // src/routes/events.ts
  export const SSE_HEARTBEAT_MS = 20_000;
  export function eventRoutes(deps: ChangeDeps & { actorOf: (c: Context) => Actor; heartbeatMs?: number }): Hono;
  // src/app.ts (AppDeps additions)
  //   bus?: EventBus;         — defaults to a fresh EventBus
  //   heartbeatMs?: number;   — tests shorten it
  ```
- Route-factory signature change (both call sites updated in this task):
  ```ts
  export function projectRoutes(deps: { db: Db; bus: EventBus; actorOf: (c: Context) => Actor }): Hono;
  export function storyRoutes(deps: { db: Db; bus: EventBus; actorOf: (c: Context) => Actor }): Hono;
  ```
- ROUTE_ACTIONS addition: `"GET /api/projects/:id/events": "project:read"`. `MatrixContext` needs nothing new; the fixture is `{ stream: true }`.

- [ ] **Step 1: Write the failing bus test**

`apps/server/test/events-bus.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { EventBus } from "../src/events/bus";

describe("EventBus", () => {
  it("delivers one event per publish to every subscriber of that project", () => {
    const bus = new EventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    bus.subscribe("p1", (e) => a.push(e));
    bus.subscribe("p1", (e) => b.push(e));
    bus.publish("p1");
    expect(a).toEqual([{ type: "project.changed", projectId: "p1" }]);
    expect(b).toHaveLength(1);
  });

  it("never delivers another project's events", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.subscribe("p1", (e) => seen.push(e));
    bus.publish("p2");
    expect(seen).toHaveLength(0);
  });

  it("unsubscribe stops delivery and drops the project's entry", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const off = bus.subscribe("p1", (e) => seen.push(e));
    expect(bus.subscriberCount("p1")).toBe(1);
    off();
    bus.publish("p1");
    expect(seen).toHaveLength(0);
    expect(bus.subscriberCount("p1")).toBe(0);
    expect(bus.subscriberCount()).toBe(0);
  });

  it("is idempotent when unsubscribe is called twice", () => {
    const bus = new EventBus();
    const off = bus.subscribe("p1", () => {});
    off();
    off();
    expect(bus.subscriberCount("p1")).toBe(0);
  });

  it("a throwing listener does not stop the others", () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.subscribe("p1", () => {
      throw new Error("listener blew up");
    });
    bus.subscribe("p1", (e) => seen.push(e));
    expect(() => bus.publish("p1")).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/events-bus.test.ts`
Expected: FAIL — `Cannot find module "../src/events/bus"`.

- [ ] **Step 3: Implement the bus and the emit helper**

`src/events/bus.ts`:

```ts
export interface ProjectChanged {
  type: "project.changed";
  projectId: string;
}

type Listener = (event: ProjectChanged) => void;

/**
 * Invalidation only: no payload, no ordering guarantees, no replay (design §6). Scaling past
 * one process would mean replacing this with an external channel — explicitly out of scope.
 */
export class EventBus {
  #listeners = new Map<string, Set<Listener>>();

  subscribe(projectId: string, listener: Listener): () => void {
    const set = this.#listeners.get(projectId) ?? new Set<Listener>();
    set.add(listener);
    this.#listeners.set(projectId, set);
    return () => {
      const current = this.#listeners.get(projectId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.#listeners.delete(projectId);
    };
  }

  publish(projectId: string): void {
    const event: ProjectChanged = { type: "project.changed", projectId };
    for (const listener of [...(this.#listeners.get(projectId) ?? [])]) {
      // One broken stream must not stop the others; the writer's own error handling closes it.
      try {
        listener(event);
      } catch {
        /* ignored on purpose */
      }
    }
  }

  subscriberCount(projectId?: string): number {
    if (projectId !== undefined) return this.#listeners.get(projectId)?.size ?? 0;
    let total = 0;
    for (const set of this.#listeners.values()) total += set.size;
    return total;
  }
}
```

`src/events/emit.ts`:

```ts
import type { Db } from "../db/client";
import type { Action } from "../authz/permissions";
import { withProject, type Actor, type NotPromise, type ProjectTx } from "../db/tx";
import type { EventBus } from "./bus";

export interface ChangeDeps {
  db: Db;
  bus: EventBus;
}

/**
 * Publishes only after withProject returns, i.e. after the transaction committed — a
 * subscriber that refetches on the event must not read pre-commit state. A throw skips the
 * publish, so a rolled-back change never announces itself.
 */
export function withProjectChange<T>(
  deps: ChangeDeps,
  actor: Actor,
  projectId: string,
  action: Action,
  fn: (tx: ProjectTx) => NotPromise<T>,
): T {
  const result = withProject(deps.db, actor, projectId, action, fn);
  deps.bus.publish(projectId);
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test test/events-bus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing SSE test**

`apps/server/test/events-sse.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { EventBus } from "../src/events/bus";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let outsider: Actor;
let bus: EventBus;
let app: { request: (p: string, i?: RequestInit) => Promise<Response> };
let projectId: string;
let otherProjectId: string;
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });

/** Reads decoded chunks until `match` is found or the deadline passes. */
async function readUntil(res: Response, match: string, timeoutMs = 2000): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + timeoutMs;
  while (!seen.includes(match)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${match}; saw: ${seen}`);
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before ${match}; saw: ${seen}`);
    seen += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return seen;
}

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  outsider = seedUser(db, "outsider@example.test");
  projectId = createProject(db, owner, { name: "P" }).id;
  otherProjectId = createProject(db, owner, { name: "Other" }).id;
  bus = new EventBus();
  app = makeTestApp(db, undefined, { bus, heartbeatMs: 50 }).app;
});

describe("GET /api/projects/:id/events", () => {
  it("authorizes before streaming: 401 anonymous, 404 non-member", async () => {
    const anon = await app.request(`${ORIGIN}/api/projects/${projectId}/events`);
    expect(anon.status).toBe(401);
    const stranger = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(outsider) });
    expect(stranger.status).toBe(404);
  });

  it("answers with an SSE content type and sends heartbeat comment frames", async () => {
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await readUntil(res, ":")).toContain(":");
  });

  it("delivers one project.changed for a mutation in that project and nothing for another's", async () => {
    const mine = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    const theirs = await app.request(`${ORIGIN}/api/projects/${otherProjectId}/events`, { headers: as(owner) });
    expect(bus.subscriberCount()).toBe(2);

    await app.request(`${ORIGIN}/api/projects/${projectId}/stories`, {
      method: "POST",
      headers: { ...as(owner), "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ title: "Ship it" }),
    });

    const seen = await readUntil(mine, "project.changed");
    expect(seen).toContain(projectId);
    expect(seen).not.toContain(otherProjectId);
    await theirs.body!.cancel();
  });

  it("drops the subscription when the client goes away", async () => {
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/events`, { headers: as(owner) });
    await readUntil(res, ":");
    // readUntil cancels the reader, which aborts the stream.
    const deadline = Date.now() + 2000;
    while (bus.subscriberCount() !== 0 && Date.now() < deadline) await Bun.sleep(10);
    expect(bus.subscriberCount()).toBe(0);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `bun test test/events-sse.test.ts`
Expected: FAIL — the route is 404 and `makeTestApp` does not accept a `bus`.

- [ ] **Step 7: Implement the SSE route**

`src/routes/events.ts`:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { withProject, type Actor } from "../db/tx";
import type { ChangeDeps } from "../events/emit";

export const SSE_HEARTBEAT_MS = 20_000;

/**
 * Invalidation stream. Authorization runs *before* the stream opens, so a non-member gets a
 * plain 404 rather than an empty event stream.
 */
export function eventRoutes(deps: ChangeDeps & { actorOf: (c: Context) => Actor; heartbeatMs?: number }) {
  const heartbeatMs = deps.heartbeatMs ?? SSE_HEARTBEAT_MS;
  return new Hono().get("/api/projects/:id/events", (c) => {
    const projectId = c.req.param("id");
    withProject(deps.db, deps.actorOf(c), projectId, "project:read", (tx) => tx.projectId);
    return streamSSE(c, async (stream) => {
      let pending = 0;
      let closed = false;
      let wake: (() => void) | null = null;
      const unsubscribe = deps.bus.subscribe(projectId, () => {
        pending += 1;
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake?.();
      });
      try {
        while (!closed) {
          if (pending > 0) {
            // Coalesce: the client refetches everything it shows, so N changes need one event.
            pending = 0;
            await stream.writeSSE({
              event: "project.changed",
              data: JSON.stringify({ type: "project.changed", projectId }),
            });
            continue;
          }
          await Promise.race([
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
            Bun.sleep(heartbeatMs),
          ]);
          wake = null;
          if (!closed && pending === 0) await stream.write(": heartbeat\n\n");
        }
      } finally {
        unsubscribe();
      }
    });
  });
}
```

- [ ] **Step 8: Publish from every mutating route**

`src/app.ts`:

```ts
export interface AppDeps {
  // …existing fields…
  bus?: EventBus;
  heartbeatMs?: number;
}

export function createApp(deps: AppDeps): Hono {
  const actorOf = deps.actorOf ?? defaultActorOf(deps.testActorHeader === true);
  const bus = deps.bus ?? new EventBus();
  // …middleware as before…
  app.route("/", projectRoutes({ db: deps.db, bus, actorOf }));
  app.route("/", storyRoutes({ db: deps.db, bus, actorOf }));
  app.route("/", eventRoutes({ db: deps.db, bus, actorOf, ...(deps.heartbeatMs === undefined ? {} : { heartbeatMs: deps.heartbeatMs }) }));
  // …static + notFound + onError as before…
}
```

In `src/routes/projects.ts` and `src/routes/stories.ts`, change the factory signature to take `deps: { db: Db; bus: EventBus; actorOf: (c: Context) => Actor }` and replace `withProject(db, …)` with `withProjectChange(deps, …)` **only in the mutating handlers**:

- projects: `PATCH /api/projects/:id`, `DELETE /api/projects/:id`, `POST …/archive`, `POST …/unarchive`, `POST …/states`, `POST …/states/reorder`, `PATCH …/states/:stateId`, `DELETE …/states/:stateId`
- stories: `POST …/stories`, `PATCH …/stories/:storyId`, `POST …/stories/:storyId/move`, `DELETE …/stories/:storyId`

Reads (`GET`) keep plain `withProject` — publishing on a read would put every viewer in a refetch loop. `POST /api/projects` (create) has no subscribers yet, so it stays a plain `createProject` call.

`src/index.ts` — build one bus for the process and pass it in:

```ts
  const bus = new EventBus();
  const app = createApp({ config, log, db, bus, actorOf: actorFromRequest(db), testActorHeader: false, health: /* … */ });
```

`test/harness.ts` — `makeTestApp(db, extra?, opts?)` gains `opts.bus` and `opts.heartbeatMs`, passed straight through to `createApp`, and returns the bus so tests can assert on it:

```ts
export function makeTestApp(
  db: Db,
  extra?: (app: Hono) => void,
  opts?: { staticRoot?: string; bus?: EventBus; heartbeatMs?: number },
): { app: Hono; lines: string[]; bus: EventBus } {
  const bus = opts?.bus ?? new EventBus();
  // …createApp({ …, bus, ...(opts?.heartbeatMs === undefined ? {} : { heartbeatMs: opts.heartbeatMs }) })…
  return { app, lines, bus };
}
```

`src/authz/route-manifest.ts` — add `"GET /api/projects/:id/events": "project:read"`. In `test/matrix-fixtures.ts` add `"GET /api/projects/:id/events": { stream: true }` so the matrix cancels the body after checking the status.

- [ ] **Step 9: Run to verify it passes**

Run: `bun test test/events-sse.test.ts`
Expected: PASS (4 tests).

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green. The matrix's owner row for `GET …/events` must be < 300 and its body cancelled — a hanging test run means the `stream: true` fixture is missing.

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/events apps/server/src/routes apps/server/src/app.ts apps/server/src/index.ts apps/server/src/authz/route-manifest.ts apps/server/test
```
```bash
git commit -m "feat(server): in-process event bus and SSE invalidation stream per project (TASK-251)"
```

---

### Task 8a: Project invitations by owners (TASK-252)

**Files:**
- Create: `apps/server/src/services/invites.ts`, `apps/server/src/routes/invites.ts`, `apps/server/test/invites.test.ts`
- Modify: `spec/permissions.md`, `spec/fixtures/permissions.json`, `apps/server/test/permissions.test.ts`, `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`, `apps/server/test/route-matrix.test.ts`

**Interfaces:**
- Consumes: `withProject`, `withProjectChange`, `loadInProject`, `ProjectTx`, `UserActor`, `bootstrapScope`, `recordActivity`, `newSecret`, `hashToken`, `hashPassword`, `assertPasswordAcceptable`, `createSession`, `setSessionCookie`, `createRateLimiter`, `clientIp`, `invites`, `projectMembers`, `projects`, `users`.
- Produces:
  ```ts
  // src/services/invites.ts
  export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  export interface InviteRow { id: string; role: MemberRole; createdAt: number; expiresAt: number; acceptedAt: number | null; revokedAt: number | null }
  export interface InvitePreview { projectId: string; projectName: string; role: MemberRole }
  export function mintInvite(tx: ProjectTx, input: { role: MemberRole; now?: number }): { token: string; invite: InviteRow };
  export function listInvites(tx: ProjectTx): InviteRow[];
  export function revokeInvite(tx: ProjectTx, inviteId: string, now?: number): InviteRow;
  export function previewInvite(db: Db, token: string, now?: number): InvitePreview | null;
  export function acceptInvite(db: Db, token: string, actor: UserActor, now?: number): InvitePreview;
  export function registerAndAcceptInvite(db: Db, token: string, user: { email: string; displayName: string; passwordHash: string }, now?: number): { userId: string; preview: InvitePreview };
  // src/routes/invites.ts
  export function inviteRoutes(deps: { db: Db; bus: EventBus; config: Config; actorOf: (c: Context) => Actor; limiter?: RateLimiter }): Hono;
  ```
- Permission fixture: add the `invite:read` row (401 / 404 / 403 / 403 / 200) to **both** `spec/permissions.md` and `spec/fixtures/permissions.json`, and add `"invite:read"` to `READ_ACTIONS` in `apps/server/test/permissions.test.ts`.
- ROUTE_ACTIONS additions:
  ```ts
  "POST /api/projects/:id/invites": "member:invite",
  "GET /api/projects/:id/invites": "invite:read",
  "DELETE /api/projects/:id/invites/:inviteId": "member:invite",
  "GET /api/invites/:token": "public",
  "POST /api/invites/:token/accept": "public",
  ```
- `MatrixContext` gains `inviteId: string`.

- [ ] **Step 1: Add the permission row first**

`spec/permissions.md` — insert after the `member:leave` row (alphabetical grouping by family is not used; keep the invite row next to the member family):

```markdown
| `invite:read` | 401 | 404 | 403 | 403 | 200 |
```

and, in the prose under the table, a sentence:

```markdown
`member:invite` covers minting **and** revoking an invitation; `invite:read`
covers listing a project's pending invitations, which is owner-only
bookkeeping (`member:read` is 200 for viewers and must not carry it).
```

`spec/fixtures/permissions.json` — the matching entry in the same position:

```json
    "invite:read":             { "anonymous": 401, "non-member": 404, "viewer": 403, "member": 403, "owner": 200 },
```

`apps/server/test/permissions.test.ts` — add `"invite:read",` to `READ_ACTIONS`.

Also add the "Routes outside the matrix" section to `spec/permissions.md` (it documents the `public` / `self` / `admin` / `setup` rules the manifest uses):

```markdown
### Routes outside the matrix

Some routes are not project-scoped and therefore have no `(action, role)` cell.
They declare a rule in the server's route manifest
(`apps/server/src/authz/route-manifest.ts`) and the matrix test asserts the
rule exists for every registered route:

- `public` — no session needed: `POST /api/auth/login`, `GET /api/invites/:token`,
  `POST /api/invites/:token/accept`, `GET|POST /api/auth/reset/:token`.
- `self` — any signed-in user, acting only on their own data:
  `GET /api/me`, `POST /api/me/password`, `POST /api/auth/logout`,
  `GET /api/projects`, `POST /api/projects` (a create has no role in a project
  that does not exist yet).
- `admin` — `users.is_admin` only (instance plane): anonymous → 401,
  signed-in non-admin → 403.
- `setup` — reachable only while the instance has no user
  (`GET|POST /api/setup`); afterwards 404.
```

Run: `pnpm --filter @storylane/core test`
Expected: PASS — the markdown table and the fixture still agree (this test is what catches a one-sided edit).

Run: `pnpm --filter @storylane/server test`
Expected: PASS — `permissions.test.ts` now names 8 read actions.

- [ ] **Step 2: Write the failing invites test**

`apps/server/test/invites.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { INVITE_TTL_MS } from "../src/services/invites";
import { invites, projectMembers, users } from "../src/db/schema";
import { SESSION_COOKIE } from "../src/auth/sessions";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let member: Actor;
let stranger: Actor;
let projectId: string;
let app: { request: (p: string, i?: RequestInit) => Promise<Response> };
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor?: Actor) => ({
  ...(actor ? as(actor) : {}),
  "content-type": "application/json",
  origin: ORIGIN,
});

const mint = async (actor: Actor, role = "member") =>
  app.request(`${ORIGIN}/api/projects/${projectId}/invites`, {
    method: "POST",
    headers: jsonAs(actor),
    body: JSON.stringify({ role }),
  });

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  member = seedUser(db, "member@example.test");
  stranger = seedUser(db, "stranger@example.test");
  projectId = createProject(db, owner, { name: "P" }).id;
  db.$client.run("insert into project_members (project_id, user_id, role, joined_at) values (?,?,?,?)", [
    projectId,
    (member as { userId: string }).userId,
    "member",
    Date.now(),
  ]);
  app = makeTestApp(db).app;
});

describe("minting", () => {
  it("returns the token once and stores only its hash", async () => {
    const res = await mint(owner);
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { token: string; invite: { id: string; role: string; expiresAt: number } };
    expect(payload.invite.role).toBe("member");
    expect(payload.invite.expiresAt).toBeGreaterThan(Date.now());
    expect(payload.invite.expiresAt).toBeLessThanOrEqual(Date.now() + INVITE_TTL_MS);
    const rows = db.select().from(invites).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(payload.token);
  });

  it("is owner-only and rejects an unknown role", async () => {
    expect((await mint(member)).status).toBe(403);
    expect((await mint(stranger)).status).toBe(404);
    const badRole = await mint(owner, "admin");
    expect(badRole.status).toBe(400);
  });

  it("lists invitations to the owner only", async () => {
    await mint(owner);
    const asOwner = await app.request(`${ORIGIN}/api/projects/${projectId}/invites`, { headers: as(owner) });
    expect(asOwner.status).toBe(200);
    expect((await asOwner.json()) as unknown[]).toHaveLength(1);
    const asMember = await app.request(`${ORIGIN}/api/projects/${projectId}/invites`, { headers: as(member) });
    expect(asMember.status).toBe(403);
  });
});

describe("previewing and accepting", () => {
  it("previews without a session and hides the token's project from a wrong token", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const preview = await app.request(`${ORIGIN}/api/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ projectId, projectName: "P", role: "viewer" });
    expect((await app.request(`${ORIGIN}/api/invites/not-a-token`)).status).toBe(404);
  });

  it("joins a signed-in non-member with the bound role and is then single-use", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const accepted = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ projectId, projectName: "P", role: "viewer" });
    const membership = db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.userId, (stranger as { userId: string }).userId))
      .get();
    expect(membership!.role).toBe("viewer");

    const again = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    expect(again.status).toBe(404);
  });

  it("registers and joins when accepted while logged out", async () => {
    const { token } = (await (await mint(owner)).json()) as { token: string };
    const res = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(),
      body: JSON.stringify({
        email: "newcomer@example.test",
        displayName: "Newcomer",
        password: "correct horse battery",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    const created = db.select().from(users).where(eq(users.email, "newcomer@example.test")).get();
    expect(created!.isAdmin).toBe(false);
    expect(created!.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("rejects a registration that reuses an existing email", async () => {
    const { token } = (await (await mint(owner)).json()) as { token: string };
    const res = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(),
      body: JSON.stringify({ email: "OWNER@example.test", displayName: "Copy", password: "correct horse battery" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "email_taken" });
  });

  it("refuses an expired or revoked invitation with the same 404", async () => {
    const expired = (await (await mint(owner)).json()) as { token: string; invite: { id: string } };
    db.update(invites).set({ expiresAt: Date.now() - 1 }).where(eq(invites.id, expired.invite.id)).run();
    expect(
      (await app.request(`${ORIGIN}/api/invites/${expired.token}/accept`, { method: "POST", headers: jsonAs(stranger), body: "{}" })).status,
    ).toBe(404);

    const revoked = (await (await mint(owner)).json()) as { token: string; invite: { id: string } };
    const revoke = await app.request(`${ORIGIN}/api/projects/${projectId}/invites/${revoked.invite.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(revoke.status).toBe(200);
    expect(
      (await app.request(`${ORIGIN}/api/invites/${revoked.token}/accept`, { method: "POST", headers: jsonAs(stranger), body: "{}" })).status,
    ).toBe(404);
  });

  it("is idempotent for a user who is already a member", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const res = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(member),
      body: "{}",
    });
    expect(res.status).toBe(200);
    // The existing role wins — accepting an invite never demotes a member.
    expect(((await res.json()) as { role: string }).role).toBe("member");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun test test/invites.test.ts`
Expected: FAIL — `Cannot find module "../src/services/invites"`.

- [ ] **Step 4: Implement the invites service**

`src/services/invites.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { invites, projectMembers, projects, users } from "../db/schema";
import { loadInProject, type ProjectTx, type UserActor } from "../db/tx";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { hashToken, newSecret } from "../auth/tokens";
import { bootstrapScope, recordActivity } from "./activity";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface InviteRow {
  id: string;
  role: MemberRole;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
  revokedAt: number | null;
}

export interface InvitePreview {
  projectId: string;
  projectName: string;
  role: MemberRole;
}

const ROW = {
  id: invites.id,
  role: invites.role,
  createdAt: invites.createdAt,
  expiresAt: invites.expiresAt,
  acceptedAt: invites.acceptedAt,
  revokedAt: invites.revokedAt,
};

export function mintInvite(tx: ProjectTx, input: { role: MemberRole; now?: number }): { token: string; invite: InviteRow } {
  const now = input.now ?? Date.now();
  const token = newSecret();
  const id = newId();
  if (tx.actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  tx.tx
    .insert(invites)
    .values({
      id,
      projectId: tx.projectId,
      tokenHash: hashToken(token),
      role: input.role,
      createdBy: tx.actor.userId,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
    })
    .run();
  const invite = tx.tx.select(ROW).from(invites).where(eq(invites.id, id)).get() as InviteRow;
  return { token, invite };
}

export function listInvites(tx: ProjectTx): InviteRow[] {
  return tx.tx
    .select(ROW)
    .from(invites)
    .where(eq(invites.projectId, tx.projectId))
    .orderBy(invites.createdAt)
    .all() as InviteRow[];
}

export function revokeInvite(tx: ProjectTx, inviteId: string, now = Date.now()): InviteRow {
  loadInProject(tx, invites, inviteId);
  tx.tx.update(invites).set({ revokedAt: now }).where(eq(invites.id, inviteId)).run();
  return tx.tx.select(ROW).from(invites).where(eq(invites.id, inviteId)).get() as InviteRow;
}

/** A bad, expired, revoked or already-used token is one indistinguishable 404. */
function usable(db: Db, token: string, now: number) {
  const row = db
    .select({
      id: invites.id,
      projectId: invites.projectId,
      role: invites.role,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
      revokedAt: invites.revokedAt,
      projectName: projects.name,
    })
    .from(invites)
    .innerJoin(projects, eq(projects.id, invites.projectId))
    .where(eq(invites.tokenHash, hashToken(token)))
    .get();
  if (!row || row.revokedAt !== null || row.acceptedAt !== null || now >= row.expiresAt) return null;
  return row;
}

export function previewInvite(db: Db, token: string, now = Date.now()): InvitePreview | null {
  const row = usable(db, token, now);
  if (!row) return null;
  return { projectId: row.projectId, projectName: row.projectName, role: row.role as MemberRole };
}

/**
 * Not project-scoped: the actor is not a member yet, so there is nothing for withProject to
 * authorize — the token is the authorization. Runs as one immediate transaction.
 */
export function acceptInvite(db: Db, token: string, actor: UserActor, now = Date.now()): InvitePreview {
  return db.transaction(
    (tx) => {
      const row = usable(db, token, now);
      if (!row) throw new HttpError(404, "not_found");
      const existing = tx
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, row.projectId), eq(projectMembers.userId, actor.userId)))
        .get();
      const role = (existing?.role ?? row.role) as MemberRole;
      if (!existing) {
        tx.insert(projectMembers)
          .values({ projectId: row.projectId, userId: actor.userId, role: row.role, joinedAt: now })
          .run();
        recordActivity(bootstrapScope(tx, row.projectId, actor), {
          action: "member.joined",
          payload: { role: row.role, via: "invite" },
        });
      }
      tx.update(invites).set({ acceptedAt: now, acceptedBy: actor.userId }).where(eq(invites.id, row.id)).run();
      return { projectId: row.projectId, projectName: row.projectName, role };
    },
    { behavior: "immediate" },
  );
}

/** Accepting while logged out: register, then join. The password is hashed by the route. */
export function registerAndAcceptInvite(
  db: Db,
  token: string,
  user: { email: string; displayName: string; passwordHash: string },
  now = Date.now(),
): { userId: string; preview: InvitePreview } {
  const userId = db.transaction(
    (tx) => {
      if (usable(db, token, now) === null) throw new HttpError(404, "not_found");
      // users.email is UNIQUE COLLATE NOCASE, so the lookup must use the same collation.
      const taken = tx
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.email} = ${user.email} collate nocase`)
        .get();
      if (taken) throw new HttpError(409, "email_taken");
      const id = newId();
      tx.insert(users)
        .values({
          id,
          email: user.email,
          passwordHash: user.passwordHash,
          displayName: user.displayName,
          isAdmin: false,
          createdAt: now,
        })
        .run();
      return id;
    },
    { behavior: "immediate" },
  );
  const preview = acceptInvite(db, token, { kind: "user", userId, isAdmin: false }, now);
  return { userId, preview };
}
```

- [ ] **Step 5: Implement the invite routes**

`src/routes/invites.ts`:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import type { EventBus } from "../events/bus";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { assertPasswordAcceptable, hashPassword } from "../auth/password";
import { setSessionCookie } from "../auth/cookies";
import { createSession } from "../auth/sessions";
import { clientIp, createRateLimiter, type RateLimiter } from "../auth/rate-limit";
import { acceptInvite, listInvites, mintInvite, previewInvite, registerAndAcceptInvite, revokeInvite } from "../services/invites";

const ACCEPT_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };
const ROLES: readonly MemberRole[] = ["owner", "member", "viewer"];

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function requireRole(value: unknown): MemberRole {
  if (typeof value !== "string" || !ROLES.includes(value as MemberRole)) throw new HttpError(400, "role_invalid");
  return value as MemberRole;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `${field}_required`);
  return value;
}

export function inviteRoutes(deps: {
  db: Db;
  bus: EventBus;
  config: Config;
  actorOf: (c: Context) => Actor;
  limiter?: RateLimiter;
}) {
  const limiter = deps.limiter ?? createRateLimiter(ACCEPT_LIMIT);
  return new Hono()
    .post("/api/projects/:id/invites", async (c) => {
      const role = requireRole((await body(c)).role);
      return c.json(
        withProjectChange(deps, deps.actorOf(c), c.req.param("id"), "member:invite", (tx) => mintInvite(tx, { role })),
        201,
      );
    })
    .get("/api/projects/:id/invites", (c) =>
      c.json(withProject(deps.db, deps.actorOf(c), c.req.param("id"), "invite:read", (tx) => listInvites(tx))),
    )
    .delete("/api/projects/:id/invites/:inviteId", (c) =>
      c.json(
        withProjectChange(deps, deps.actorOf(c), c.req.param("id"), "member:invite", (tx) =>
          revokeInvite(tx, c.req.param("inviteId")),
        ),
      ),
    )
    .get("/api/invites/:token", (c) => {
      const preview = previewInvite(deps.db, c.req.param("token"));
      if (!preview) throw new HttpError(404, "not_found");
      return c.json(preview);
    })
    .post("/api/invites/:token/accept", async (c) => {
      if (!limiter.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      const token = c.req.param("token");
      const actor = deps.actorOf(c);
      if (actor.kind === "user") {
        const preview = acceptInvite(deps.db, token, actor);
        deps.bus.publish(preview.projectId);
        return c.json(preview);
      }
      const input = await body(c);
      const email = requireString(input.email, "email");
      const displayName = requireString(input.displayName, "display_name");
      const password = requireString(input.password, "password");
      assertPasswordAcceptable(password);
      const passwordHash = await hashPassword(password);
      const { userId, preview } = registerAndAcceptInvite(deps.db, token, { email, displayName, passwordHash });
      const { secret, absoluteExpiresAt } = createSession(deps.db, userId);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      deps.bus.publish(preview.projectId);
      return c.json(preview);
    });
}
```

Register in `src/app.ts`: `app.route("/", inviteRoutes({ db: deps.db, bus, config: deps.config, actorOf }));`

Note the CSRF interaction: `POST /api/invites/:token/accept` from a logged-out browser carries no session cookie, so `csrfGuard` skips it; from a logged-in browser it carries one and must therefore be a JSON request with a matching `Origin` — which is what the SPA sends.

- [ ] **Step 6: Extend the manifest and matrix fixtures**

Add the five entries from this task's Interfaces block. In `test/matrix-fixtures.ts`, `MatrixContext` gains `inviteId: string` and:

```ts
    "POST /api/projects/:id/invites": { body: { role: "member" } },
    "DELETE /api/projects/:id/invites/:inviteId": { params: { inviteId: ctx.inviteId } },
```

In `route-matrix.test.ts`, seed the invite next to the spare state:

```ts
const seededInvite = withProject(db, ownerA, projectId, "member:invite", (tx) => mintInvite(tx, { role: "member" }));
```

Revoking is idempotent, so `DELETE …/invites/:inviteId` does not need the destructive-project treatment.

- [ ] **Step 7: Run to verify it passes**

Run: `bun test test/invites.test.ts`
Expected: PASS (9 tests).

```bash
pnpm --filter @storylane/core test
```
```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add spec/permissions.md spec/fixtures/permissions.json apps/server/src/services/invites.ts apps/server/src/routes/invites.ts apps/server/src/app.ts apps/server/src/authz/route-manifest.ts apps/server/test
```
```bash
git commit -m "feat(server): project invitations with hashed single-use tokens and the invite:read permission (TASK-252)"
```

- [ ] **Step 9: authz-reviewer pass**

`spec/permissions.md` changed, so this is mandatory. Dispatch `authz-reviewer` on this commit and record:

```bash
backlog task edit TASK-252 --append-notes "authz-reviewer (invites): <verdict>. Commit <sha>."
```

---

### Task 8b: Instance-admin reset links (TASK-252)

**Files:**
- Create: `apps/server/src/authz/admin.ts`, `apps/server/src/services/reset.ts`, `apps/server/src/routes/admin.ts`, `apps/server/test/reset.test.ts`
- Modify: `apps/server/src/routes/auth.ts` (the two token endpoints), `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`

**Interfaces:**
- Consumes: `Db`, `Config`, `Actor`, `UserActor`, `HttpError`, `newSecret`, `hashToken`, `hashPassword`, `assertPasswordAcceptable`, `revokeUserSessions`, `resetTokens`, `users`, `createRateLimiter`, `clientIp`.
- Produces:
  ```ts
  // src/authz/admin.ts
  export function requireAdmin(actor: Actor): UserActor;   // 401 anonymous, 403 non-admin
  // src/services/reset.ts
  export const RESET_TTL_MS = 60 * 60 * 1000;
  export function mintResetToken(db: Db, admin: UserActor, userId: string, now?: number): { token: string; expiresAt: number };
  export function previewResetToken(db: Db, token: string, now?: number): { email: string } | null;
  export function consumeResetToken(db: Db, token: string, passwordHash: string, now?: number): { userId: string };
  // src/routes/admin.ts
  export function adminRoutes(deps: { db: Db; config: Config; actorOf: (c: Context) => Actor }): Hono;
  ```
- ROUTE_ACTIONS additions: `"POST /api/admin/users/:userId/reset-link": "admin"`, `"GET /api/auth/reset/:token": "public"`, `"POST /api/auth/reset/:token": "public"`.
- `MatrixContext` gains `userId: string` (any seeded user id, for the admin route's anonymous-401 row).

- [ ] **Step 1: Write the failing reset test**

`apps/server/test/reset.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { makeTestApp, makeTestDb, seedUser, seedUserWithPassword } from "./harness";
import { RESET_TTL_MS } from "../src/services/reset";
import { resetTokens, sessions } from "../src/db/schema";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let admin: Actor;
let plainUser: Actor;
let target: Actor;
let app: { request: (p: string, i?: RequestInit) => Promise<Response> };
const ORIGIN = "http://127.0.0.1";
const PASSWORD = "correct horse battery";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor?: Actor) => ({
  ...(actor ? as(actor) : {}),
  "content-type": "application/json",
  origin: ORIGIN,
});
const userIdOf = (actor: Actor) => (actor as { userId: string }).userId;

const mint = (actor: Actor | undefined, userId: string) =>
  app.request(`${ORIGIN}/api/admin/users/${userId}/reset-link`, {
    method: "POST",
    headers: jsonAs(actor),
    body: "{}",
  });

beforeEach(async () => {
  db = makeTestDb();
  admin = seedUser(db, "admin@example.test", true);
  plainUser = seedUser(db, "plain@example.test");
  target = await seedUserWithPassword(db, "target@example.test", PASSWORD);
  app = makeTestApp(db).app;
});

describe("POST /api/admin/users/:userId/reset-link", () => {
  it("is admin-only: 401 anonymous, 403 non-admin, 200 admin", async () => {
    expect((await mint(undefined, userIdOf(target))).status).toBe(401);
    expect((await mint(plainUser, userIdOf(target))).status).toBe(403);
    const res = await mint(admin, userIdOf(target));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { token: string; expiresAt: number; path: string };
    expect(payload.path).toBe(`/reset/${payload.token}`);
    expect(payload.expiresAt).toBeLessThanOrEqual(Date.now() + RESET_TTL_MS);
    const rows = db.select().from(resetTokens).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(payload.token);
  });

  it("404s for an unknown user", async () => {
    expect((await mint(admin, "no-such-user")).status).toBe(404);
  });
});

describe("using a reset link", () => {
  const use = (token: string, password: string) =>
    app.request(`${ORIGIN}/api/auth/reset/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ password }),
    });

  it("previews the account, sets the password, revokes sessions and is single-use", async () => {
    // The target has a live session that must not survive the reset.
    const login = await app.request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "target@example.test", password: PASSWORD }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(db.select().from(sessions).all()).toHaveLength(1);

    const { token } = (await (await mint(admin, userIdOf(target))).json()) as { token: string };
    const preview = await app.request(`${ORIGIN}/api/auth/reset/${token}`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ email: "target@example.test" });

    const res = await use(token, "a whole new secret");
    expect(res.status).toBe(200);
    expect(db.select().from(sessions).all()).toHaveLength(0);
    expect((await app.request(`${ORIGIN}/api/me`, { headers: { cookie } })).status).toBe(401);

    const relogin = await app.request(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: "target@example.test", password: "a whole new secret" }),
    });
    expect(relogin.status).toBe(200);

    expect((await use(token, "yet another secret")).status).toBe(404);
    expect((await app.request(`${ORIGIN}/api/auth/reset/${token}`)).status).toBe(404);
  });

  it("refuses an expired token and a too-short password", async () => {
    const { token } = (await (await mint(admin, userIdOf(target))).json()) as { token: string };
    expect((await use(token, "short")).status).toBe(400);
    db.update(resetTokens).set({ expiresAt: Date.now() - 1 }).where(eq(resetTokens.userId, userIdOf(target))).run();
    expect((await use(token, "a whole new secret")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test test/reset.test.ts`
Expected: FAIL — `Cannot find module "../src/services/reset"`.

- [ ] **Step 3: Implement requireAdmin and the reset service**

`src/authz/admin.ts`:

```ts
import type { Actor, UserActor } from "../db/tx";
import { HttpError } from "../http-error";

/**
 * The instance-admin plane (`users.is_admin`) is independent of project membership
 * (spec/permissions.md "Instance admin plane"): anonymous → 401, signed-in non-admin → 403.
 * `isAdmin` comes from the session lookup, not from the request.
 */
export function requireAdmin(actor: Actor): UserActor {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  if (!actor.isAdmin) throw new HttpError(403, "forbidden");
  return actor;
}
```

`src/services/reset.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { resetTokens, users } from "../db/schema";
import type { UserActor } from "../db/tx";
import { HttpError } from "../http-error";
import { newId } from "../id";
import { hashToken, newSecret } from "../auth/tokens";
import { revokeUserSessions } from "../auth/sessions";

export const RESET_TTL_MS = 60 * 60 * 1000;

/** Admins mint a link and hand it over out of band; they never set a password themselves. */
export function mintResetToken(db: Db, admin: UserActor, userId: string, now = Date.now()): { token: string; expiresAt: number } {
  const user = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (!user) throw new HttpError(404, "not_found");
  const token = newSecret();
  const expiresAt = now + RESET_TTL_MS;
  db.insert(resetTokens)
    .values({ id: newId(), userId, tokenHash: hashToken(token), createdBy: admin.userId, createdAt: now, expiresAt })
    .run();
  return { token, expiresAt };
}

function usable(db: Db, token: string, now: number) {
  const row = db
    .select({ id: resetTokens.id, userId: resetTokens.userId, expiresAt: resetTokens.expiresAt, usedAt: resetTokens.usedAt, email: users.email })
    .from(resetTokens)
    .innerJoin(users, eq(users.id, resetTokens.userId))
    .where(eq(resetTokens.tokenHash, hashToken(token)))
    .get();
  if (!row || row.usedAt !== null || now >= row.expiresAt) return null;
  return row;
}

export function previewResetToken(db: Db, token: string, now = Date.now()): { email: string } | null {
  const row = usable(db, token, now);
  return row ? { email: row.email } : null;
}

/** Single use, and every session of that user goes (design §4). The hash is made by the route. */
export function consumeResetToken(db: Db, token: string, passwordHash: string, now = Date.now()): { userId: string } {
  const userId = db.transaction(
    (tx) => {
      const row = usable(db, token, now);
      if (!row) throw new HttpError(404, "not_found");
      tx.update(resetTokens).set({ usedAt: now }).where(eq(resetTokens.id, row.id)).run();
      tx.update(users).set({ passwordHash }).where(eq(users.id, row.userId)).run();
      return row.userId;
    },
    { behavior: "immediate" },
  );
  revokeUserSessions(db, userId);
  return { userId };
}
```

- [ ] **Step 4: Implement the routes**

`src/routes/admin.ts`:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import type { Actor } from "../db/tx";
import { requireAdmin } from "../authz/admin";
import { mintResetToken } from "../services/reset";

export function adminRoutes(deps: { db: Db; config: Config; actorOf: (c: Context) => Actor }) {
  return new Hono().post("/api/admin/users/:userId/reset-link", (c) => {
    const admin = requireAdmin(deps.actorOf(c));
    const { token, expiresAt } = mintResetToken(deps.db, admin, c.req.param("userId"));
    const path = `/reset/${token}`;
    // The absolute URL is only knowable when STORYLANE_BASE_URL is set; the admin UI can
    // always build one from the browser's own origin.
    return c.json({ token, expiresAt, path, url: deps.config.baseUrl ? new URL(path, deps.config.baseUrl).toString() : null });
  });
}
```

Add the two token endpoints to `src/routes/auth.ts` (they belong to the auth surface, and both are `public`):

```ts
    .get("/api/auth/reset/:token", (c) => {
      const preview = previewResetToken(deps.db, c.req.param("token"));
      if (!preview) throw new HttpError(404, "not_found");
      return c.json(preview);
    })
    .post("/api/auth/reset/:token", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
      const password = requireString(body.password, "password");
      assertPasswordAcceptable(password);
      const passwordHash = await hashPassword(password);
      consumeResetToken(deps.db, c.req.param("token"), passwordHash);
      // Deliberately no session: the user proves the new password by logging in.
      return c.json({ ok: true });
    });
```

Register the admin routes in `src/app.ts`: `app.route("/", adminRoutes({ db: deps.db, config: deps.config, actorOf }));`

- [ ] **Step 5: Extend the manifest and matrix fixtures**

Add the three entries. `MatrixContext` gains `userId: string`; fixtures:

```ts
    "POST /api/admin/users/:userId/reset-link": { params: { userId: ctx.userId }, body: {} },
```

The `self and admin rules reject anonymous callers` describe added in Task 3b now covers the admin route automatically.

- [ ] **Step 6: Run to verify it passes**

Run: `bun test test/reset.test.ts`
Expected: PASS (4 tests).

```bash
pnpm --filter @storylane/server test
```
```bash
pnpm --filter @storylane/server typecheck
```
```bash
pnpm --filter @storylane/server lint
```
Expected: all green.

- [ ] **Step 7: Commit and review**

```bash
git add apps/server/src/authz/admin.ts apps/server/src/services/reset.ts apps/server/src/routes/admin.ts apps/server/src/routes/auth.ts apps/server/src/app.ts apps/server/src/authz/route-manifest.ts apps/server/test
```
```bash
git commit -m "feat(server): admin-minted one-time password reset links that revoke all sessions (TASK-252)"
```

Dispatch `authz-reviewer` (paths `src/authz/admin.ts`, `src/routes/admin.ts`, `src/routes/auth.ts`) and record the verdict in TASK-252 notes.

---

### Task 9a: Web shell — routing, API client, session, auth pages (TASK-253)

**Library choices** (used consistently by 9a and 9b):
- **Router: `wouter`.** The SPA has six flat routes, is served by a single `index.html` fallback, and does its own fetching around SSE invalidation — `react-router` v7's loader/data layer would be machinery with nothing to do, and `wouter` is ~2 kB with the same hook shape.
- **Data fetching: hand-rolled `useResource`.** One hook (fetch + refetch + error) is all the SSE-invalidation model needs; TanStack Query's cache would duplicate the server's own invalidation signal.
- **SSE client: the browser's native `EventSource`.** Same-origin cookies are sent automatically, and the stream carries no payload to parse, so a library adds nothing.

**Files:**
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/use-resource.ts`, `apps/web/src/lib/session.tsx`, `apps/web/src/app-routes.tsx`, `apps/web/src/pages/SetupPage.tsx`, `apps/web/src/pages/LoginPage.tsx`, `apps/web/src/pages/InviteAcceptPage.tsx`, `apps/web/src/pages/ResetPage.tsx`, `apps/web/src/components/Field.tsx`, `apps/web/src/lib/api.test.ts`, `apps/web/src/pages/LoginPage.test.tsx`, `apps/web/src/pages/SetupPage.test.tsx`
- Modify: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/package.json`, `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: the phase-1 JSON API (`GET /api/setup`, `POST /api/setup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `GET /api/invites/:token`, `POST /api/invites/:token/accept`, `GET|POST /api/auth/reset/:token`).
- Produces:
  ```ts
  // src/lib/api.ts
  export class ApiError extends Error { constructor(readonly status: number, readonly code: string) }
  export async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T>;
  export function errorMessage(error: unknown): string;    // code → human sentence
  // src/lib/use-resource.ts
  export interface Resource<T> { data: T | undefined; error: unknown; loading: boolean; reload: () => void }
  export function useResource<T>(path: string | null): Resource<T>;
  // src/lib/session.tsx
  export interface Me { id: string; email: string; displayName: string; isAdmin: boolean }
  export interface SessionState { me: Me | null; setupRequired: boolean; loading: boolean; refresh: () => void }
  export function SessionProvider(props: { children: React.ReactNode }): JSX.Element;
  export function useSession(): SessionState;
  // src/app-routes.tsx
  export function AppRoutes(): JSX.Element;
  // src/components/Field.tsx
  export function Field(props: { label: string; children: React.ReactNode; hint?: string; error?: string | null }): JSX.Element;
  export const inputClass: string;
  export const buttonClass: string;
  ```

- [ ] **Step 1: Add the dependencies**

```bash
pnpm --filter @storylane/web add wouter
```
```bash
pnpm --filter @storylane/web add -D @testing-library/user-event
```

- [ ] **Step 2: Write the failing API-client test**

`apps/web/src/lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, errorMessage } from "./api";

afterEach(() => vi.restoreAllMocks());

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );

describe("apiFetch", () => {
  it("GETs and parses JSON", async () => {
    const fetchSpy = respond(200, { id: "p1" });
    await expect(apiFetch<{ id: string }>("/api/projects/p1")).resolves.toEqual({ id: "p1" });
    expect(fetchSpy).toHaveBeenCalledWith("/api/projects/p1", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("sends a JSON content type on writes (the server's CSRF guard requires it)", async () => {
    const fetchSpy = respond(201, { id: "s1" });
    await apiFetch("/api/projects/p1/stories", { method: "POST", body: { title: "a" } });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ title: "a" }));
  });

  it("returns undefined for 204 instead of failing to parse", async () => {
    respond(204, undefined);
    await expect(apiFetch("/api/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("throws an ApiError carrying status and code", async () => {
    respond(409, { error: "estimate_required" });
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status: 409, code: "estimate_required" });
  });

  it("falls back to a generic code when the body is not our error shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    await expect(apiFetch("/api/x")).rejects.toMatchObject({ status: 502, code: "unexpected" });
  });
});

describe("errorMessage", () => {
  it("translates the codes the UI can hit", () => {
    expect(errorMessage(new ApiError(401, "invalid_credentials"))).toMatch(/email or password/i);
    expect(errorMessage(new ApiError(409, "estimate_required"))).toMatch(/estimate/i);
    expect(errorMessage(new ApiError(409, "project_archived"))).toMatch(/archived/i);
    expect(errorMessage(new ApiError(429, "too_many_requests"))).toMatch(/too many/i);
    expect(errorMessage(new ApiError(400, "password_too_short"))).toMatch(/12/);
    expect(errorMessage(new Error("boom"))).toMatch(/something went wrong/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @storylane/web exec vitest run src/lib/api.test.ts`
Expected: FAIL — cannot resolve `./api`.

- [ ] **Step 4: Implement the API client**

`apps/web/src/lib/api.ts`:

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

/**
 * Same-origin JSON only. The server's CSRF guard rejects a cookie-authenticated write that is
 * not `application/json`, so every write sets it — including ones with an empty body.
 */
export async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const method = init?.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["content-type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    ...(method === "GET" ? {} : { body: JSON.stringify(init?.body ?? {}) }),
  });
  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const code = payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error
      : "unexpected";
    throw new ApiError(res.status, code);
  }
  return payload as T;
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email or password is not right.",
  unauthenticated: "Please sign in again.",
  forbidden: "You do not have permission to do that.",
  not_found: "That is gone, or was never yours to see.",
  setup_required: "This instance has not been set up yet.",
  setup_token_invalid: "That setup token is wrong or has expired. Restart the container to get a new one.",
  project_archived: "This project is archived. Un-archive it to make changes.",
  estimate_required: "Estimate this story before moving it out of the Icebox or a planning column.",
  points_off_scale: "Pick a value from the project's point scale.",
  state_category_immutable: "A column's category cannot change. Create a new column and move the stories.",
  state_last_of_category: "A project always needs one planning column and one done column.",
  state_in_use: "Move the stories off this column first.",
  email_taken: "That email already has an account. Sign in instead.",
  password_too_short: "Use at least 12 characters.",
  too_many_requests: "Too many attempts. Wait a few minutes and try again.",
  title_required: "A story needs a title.",
  name_required: "A name is required.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? "Something went wrong. Please try again.";
  return "Something went wrong. Please try again.";
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @storylane/web exec vitest run src/lib/api.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Implement `useResource` and the session provider**

`apps/web/src/lib/use-resource.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** `path === null` means "nothing to load yet" (e.g. no project selected). */
export function useResource<T>(path: string | null): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<T>(path)
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
```

`apps/web/src/lib/session.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, apiFetch } from "./api";

export interface Me {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export interface SessionState {
  me: Me | null;
  setupRequired: boolean;
  loading: boolean;
  refresh: () => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<Me>("/api/me")
      .then((value) => {
        if (!cancelled) {
          setMe(value);
          setSetupRequired(false);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setMe(null);
        // 409 setup_required is how the API says "this instance is brand new" (design §7).
        setSetupRequired(e instanceof ApiError && e.status === 409 && e.code === "setup_required");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return <SessionContext.Provider value={{ me, setupRequired, loading, refresh }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error("useSession must be used inside SessionProvider");
  return state;
}
```

- [ ] **Step 7: Write the failing page tests**

`apps/web/src/pages/LoginPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "./LoginPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("LoginPage", () => {
  it("submits the credentials and reports success to the caller", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "u1" }));
    const onSignedIn = vi.fn();
    render(<LoginPage onSignedIn={onSignedIn} />);

    await userEvent.type(screen.getByLabelText(/email/i), "owner@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    const [path, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/auth/login");
    expect(JSON.parse(init.body as string)).toEqual({ email: "owner@example.test", password: "correct horse battery" });
  });

  it("shows the server's reason and keeps the typed email", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { error: "invalid_credentials" }));
    render(<LoginPage onSignedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/email/i), "owner@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "wrong password here");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/email or password/i);
    expect(screen.getByLabelText(/email/i)).toHaveValue("owner@example.test");
  });

  it("never renders a disabled submit button (ux principle 1)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "u1" }));
    render(<LoginPage onSignedIn={vi.fn()} />);
    expect(screen.getByRole("button", { name: /sign in/i })).not.toBeDisabled();
  });
});
```

`apps/web/src/pages/SetupPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupPage } from "./SetupPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("SetupPage", () => {
  it("creates the admin from the token in the container log", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "u1", isAdmin: true }));
    const onReady = vi.fn();
    render(<SetupPage onReady={onReady} />);

    await userEvent.type(screen.getByLabelText(/setup token/i), "token-from-the-log");
    await userEvent.type(screen.getByLabelText(/your name/i), "Admin");
    await userEvent.type(screen.getByLabelText(/email/i), "admin@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: /create admin/i }));

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      token: "token-from-the-log",
      displayName: "Admin",
      email: "admin@example.test",
      password: "correct horse battery",
    });
  });

  it("explains a wrong token and a short password in place", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(403, { error: "setup_token_invalid" }))
      .mockResolvedValueOnce(json(400, { error: "password_too_short" }));
    render(<SetupPage onReady={vi.fn()} />);
    const submit = () => userEvent.click(screen.getByRole("button", { name: /create admin/i }));

    await userEvent.type(screen.getByLabelText(/setup token/i), "wrong");
    await userEvent.type(screen.getByLabelText(/your name/i), "Admin");
    await userEvent.type(screen.getByLabelText(/email/i), "admin@example.test");
    await userEvent.type(screen.getByLabelText(/password/i), "correct horse battery");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/setup token/i);

    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/12/);
  });

  it("tells the operator where the token comes from", () => {
    render(<SetupPage onReady={vi.fn()} />);
    expect(screen.getByText(/docker logs/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run to verify they fail**

Run: `pnpm --filter @storylane/web exec vitest run src/pages`
Expected: FAIL — the page modules do not exist.

- [ ] **Step 9: Implement the shared field, the auth pages and the tokens**

`apps/web/src/index.css` — extend the phase-0 file with the design tokens the pages use (square, dense, no shadows — `spec/ux-principles.md` "Design language"):

```css
@import "tailwindcss";

:root {
  --radius: 0.25rem;                 /* 4px base; never hardcode a larger radius */
  --surface: oklch(0.99 0 0);
  --surface-2: oklch(0.97 0 0);
  --ink: oklch(0.22 0 0);
  --ink-muted: oklch(0.48 0 0);
  --line: oklch(0.62 0 0);           /* ≥3:1 against --surface: a hairline is the only cue */
  --accent: oklch(0.55 0.14 250);
  --danger: oklch(0.52 0.18 25);
  --font-mono: ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace;
}

body {
  background: var(--surface);
  color: var(--ink);
}

/* Headings, ids and point values are mono (spec/ux-principles.md "Typography"). */
h1, h2, h3, .mono { font-family: var(--font-mono); }
```

`apps/web/src/components/Field.tsx`:

```tsx
/**
 * One labelled control. The error slot always occupies its line so a message cannot shift the
 * layout under the pointer (spec/ux-principles.md principle 3).
 */
export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string | null;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      <span className="min-h-4 text-xs" style={{ color: error ? "var(--danger)" : "var(--ink-muted)" }}>
        {error ?? hint ?? ""}
      </span>
    </label>
  );
}

export const inputClass =
  "rounded border px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]";

export const buttonClass =
  "rounded border px-3 py-1.5 text-sm font-medium hover:bg-[var(--surface-2)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";
```

`apps/web/src/pages/LoginPage.tsx`:

```tsx
import { useState } from "react";
import { apiFetch, errorMessage } from "../lib/api";
import { buttonClass, Field, inputClass } from "../components/Field";

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/auth/login", { method: "POST", body: { email, password } });
      onSignedIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl">Storylane</h1>
      <form onSubmit={submit} className="flex flex-col gap-2" style={{ borderColor: "var(--line)" }}>
        <Field label="Email">
          <input className={inputClass} style={{ borderColor: "var(--line)" }} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className={inputClass} style={{ borderColor: "var(--line)" }} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {/* Never disabled: a visible action is pressable and says what happened (principle 1). */}
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>
          {error ?? ""}
        </p>
      </form>
      <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
        Forgot your password? An instance admin can send you a one-time reset link.
      </p>
    </main>
  );
}
```

`apps/web/src/pages/SetupPage.tsx`:

```tsx
import { useState } from "react";
import { apiFetch, errorMessage } from "../lib/api";
import { buttonClass, Field, inputClass } from "../components/Field";

export function SetupPage({ onReady }: { onReady: () => void }) {
  const [form, setForm] = useState({ token: "", displayName: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));
  const input = { className: inputClass, style: { borderColor: "var(--line)" } };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch("/api/setup", { method: "POST", body: form });
      onReady();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl">Set up Storylane</h1>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Field label="Setup token" hint="Printed once when the container started: docker logs <container>">
          <input {...input} autoComplete="off" value={form.token} onChange={set("token")} />
        </Field>
        <Field label="Your name">
          <input {...input} value={form.displayName} onChange={set("displayName")} />
        </Field>
        <Field label="Email">
          <input {...input} type="email" autoComplete="username" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" hint="At least 12 characters.">
          <input {...input} type="password" autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} type="submit">
          {busy ? "Creating…" : "Create admin"}
        </button>
        <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      </form>
    </main>
  );
}
```

`apps/web/src/pages/InviteAcceptPage.tsx`:

```tsx
import { useState } from "react";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useSession } from "../lib/session";
import { buttonClass, Field, inputClass } from "../components/Field";

interface InvitePreview {
  projectId: string;
  projectName: string;
  role: "owner" | "member" | "viewer";
}

/** Accepting while signed in joins; while signed out it registers and joins (design §7). */
export function InviteAcceptPage({ token, onJoined }: { token: string; onJoined: (projectId: string) => void }) {
  const { me } = useSession();
  const preview = useResource<InvitePreview>(`/api/invites/${token}`);
  const [form, setForm] = useState({ email: "", displayName: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  async function accept(event?: React.FormEvent) {
    event?.preventDefault();
    setError(null);
    try {
      const joined = await apiFetch<InvitePreview>(`/api/invites/${token}/accept`, {
        method: "POST",
        body: me ? {} : form,
      });
      onJoined(joined.projectId);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (preview.loading) return <main className="p-6 text-sm">Checking the invitation…</main>;
  if (preview.error || !preview.data) {
    return (
      <main className="p-6 text-sm" role="alert">
        This invitation is not valid any more. Ask for a new link.
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl">Join {preview.data.projectName}</h1>
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        You are invited as <strong>{preview.data.role}</strong>.
      </p>
      {me ? (
        <>
          <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => void accept()}>
            Join as {me.displayName}
          </button>
          <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
        </>
      ) : (
        <form onSubmit={accept} className="flex flex-col gap-2">
          <Field label="Your name">
            <input className={inputClass} style={{ borderColor: "var(--line)" }} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Email">
            <input className={inputClass} style={{ borderColor: "var(--line)" }} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password" hint="At least 12 characters.">
            <input className={inputClass} style={{ borderColor: "var(--line)" }} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <button className={buttonClass} style={{ borderColor: "var(--line)" }} type="submit">Create account and join</button>
          <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
        </form>
      )}
    </main>
  );
}
```

`apps/web/src/pages/ResetPage.tsx`:

```tsx
import { useState } from "react";
import { Link } from "wouter";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { buttonClass, Field, inputClass } from "../components/Field";

export function ResetPage({ token }: { token: string }) {
  const preview = useResource<{ email: string }>(`/api/auth/reset/${token}`);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/auth/reset/${token}`, { method: "POST", body: { password } });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (preview.loading) return <main className="p-6 text-sm">Checking the link…</main>;
  if ((preview.error || !preview.data) && !done) {
    return (
      <main className="p-6 text-sm" role="alert">
        This reset link is not valid any more. Ask an instance admin for a new one.
      </main>
    );
  }
  if (done) {
    // The server issues no session here on purpose: the new password is proven by signing in.
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
        <p className="text-sm">Password changed. Sign in with your new password.</p>
        <Link href="/" className="text-sm underline">Go to sign in</Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-xl">New password</h1>
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>for {preview.data!.email}</p>
      <form onSubmit={submit} className="flex flex-col gap-2">
        <Field label="Password" hint="At least 12 characters.">
          <input
            className={inputClass}
            style={{ borderColor: "var(--line)" }}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} type="submit">Set password</button>
        <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      </form>
    </main>
  );
}
```

- [ ] **Step 10: Wire the router**

`apps/web/src/app-routes.tsx`:

```tsx
import { Route, Switch, useLocation } from "wouter";
import { useSession } from "./lib/session";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";
import { InviteAcceptPage } from "./pages/InviteAcceptPage";
import { ResetPage } from "./pages/ResetPage";

export function AppRoutes() {
  const session = useSession();
  const [, navigate] = useLocation();

  if (session.loading) return <main className="p-6 text-sm">Loading…</main>;

  // Token routes work signed in or out, so they come before the sign-in wall.
  return (
    <Switch>
      <Route path="/invite/:token">
        {(params) => <InviteAcceptPage token={params.token!} onJoined={(id) => navigate(`/projects/${id}/board`)} />}
      </Route>
      <Route path="/reset/:token">{(params) => <ResetPage token={params.token!} />}</Route>
      {session.setupRequired ? (
        <Route>
          <SetupPage onReady={session.refresh} />
        </Route>
      ) : session.me ? (
        // Signed-in routes arrive in Task 9b.
        <Route>
          <main className="p-6 text-sm">Signed in as {session.me.displayName}.</main>
        </Route>
      ) : (
        <Route>
          <LoginPage onSignedIn={session.refresh} />
        </Route>
      )}
    </Switch>
  );
}
```

`apps/web/src/App.tsx` becomes the provider shell:

```tsx
import { SessionProvider } from "./lib/session";
import { AppRoutes } from "./app-routes";

export function App() {
  return (
    <SessionProvider>
      <AppRoutes />
    </SessionProvider>
  );
}
```

Rewrite `apps/web/src/App.test.tsx` (its phase-0 `/healthz` assertions are gone) to cover the three shell decisions:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("App shell", () => {
  it("shows the setup page when the API says the instance is new", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(409, { error: "setup_required" }));
    render(<App />);
    expect(await screen.findByRole("button", { name: /create admin/i })).toBeInTheDocument();
  });

  it("shows the login page when there is no session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { error: "unauthenticated" }));
    render(<App />);
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("greets a signed-in user", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json(200, { id: "u1", email: "owner@example.test", displayName: "Owner", isAdmin: false }),
    );
    render(<App />);
    expect(await screen.findByText(/signed in as owner/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Run the web suite**

```bash
pnpm --filter @storylane/web test
```
```bash
pnpm --filter @storylane/web run lint
```
```bash
pnpm --filter @storylane/web run build
```
Expected: all green (the build is what catches a type error in a page that no test renders).

- [ ] **Step 12: Commit**

```bash
git add apps/web/src apps/web/package.json pnpm-lock.yaml
```
```bash
git commit -m "feat(web): routing shell, API client and the setup/login/invite/reset pages (TASK-253)"
```

---

### Task 9b: Web board — project list, board columns, drag, SSE refetch (TASK-253)

**Library choice:** **`@dnd-kit/core` + `@dnd-kit/sortable`** for drag (named by TASK-253) — pointer/keyboard sensors out of the box, which keeps drag from being the only way to move a story.

**Files:**
- Create: `apps/web/src/lib/board-ordering.ts`, `apps/web/src/lib/board-ordering.test.ts`, `apps/web/src/lib/use-project-events.ts`, `apps/web/src/pages/ProjectsPage.tsx`, `apps/web/src/pages/BoardPage.tsx`, `apps/web/src/components/BoardColumn.tsx`, `apps/web/src/components/StoryCard.tsx`, `apps/web/src/components/QuickAddCard.tsx`, `apps/web/src/pages/ProjectsPage.test.tsx`, `apps/web/src/pages/BoardPage.test.tsx`
- Modify: `apps/web/src/app-routes.tsx`, `apps/web/package.json`

**Interfaces:**
- Consumes: `apiFetch`, `errorMessage`, `useResource`, `useSession`, `Field`/`inputClass`/`buttonClass`, and the API shapes `GET /api/projects`, `POST /api/projects`, `GET /api/projects/:id/board`, `POST /api/projects/:id/stories`, `POST /api/projects/:id/stories/:storyId/move`, `GET /api/projects/:id/events`.
- Produces:
  ```ts
  // src/lib/board-ordering.ts
  export interface ColumnView { stateId: string | null; storyIds: string[] }
  /** Pure: where the card ends up after a drop, for every column. */
  export function moveStoryTo(columns: ColumnView[], storyId: string, targetStateId: string | null, targetIndex: number): ColumnView[];
  export function columnOf(columns: ColumnView[], storyId: string): ColumnView | undefined;
  export function orderedIdsFor(columns: ColumnView[], stateId: string | null): string[];
  // src/lib/use-project-events.ts
  export function useProjectEvents(projectId: string | null, onChange: () => void): void;
  // pages
  export function ProjectsPage(props: { onOpen: (projectId: string) => void }): JSX.Element;
  export function BoardPage(props: { projectId: string }): JSX.Element;
  // src/components/StoryCard.tsx
  export interface StoryView { id: string; number: number; title: string; storyType: "feature" | "bug" | "chore" | "release"; stateId: string | null; points: number | null; completedAt: number | null }
  export function StoryCard(props: { story: StoryView; states: GateState[]; onAdvance: (targetStateId: string) => void }): JSX.Element;
  // src/components/BoardColumn.tsx
  export function BoardColumn(props: {
    projectId: string;
    /** null for the Icebox column. */
    state: { id: string; name: string; category: "unstarted" | "in_progress" | "done" | "rejected"; actionLabel: string | null; position: number } | null;
    storyIds: string[];
    storiesById: Map<string, StoryView>;
    gateStates: GateState[];
    onAdvance: (storyId: string, targetStateId: string) => void;
    onAdded: () => void;
  }): JSX.Element;
  // src/components/QuickAddCard.tsx
  export function QuickAddCard(props: { projectId: string; onAdded: () => void }): JSX.Element;
  ```

- [ ] **Step 1: Add the dependencies**

```bash
pnpm --filter @storylane/web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```
```bash
pnpm --filter @storylane/web add @storylane/core@workspace:*
```

The second one is what makes `computeStateGate` (the advance-button graph, already in `packages/core`) available to the card.

- [ ] **Step 2: Write the failing ordering test**

`apps/web/src/lib/board-ordering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { columnOf, moveStoryTo, orderedIdsFor, type ColumnView } from "./board-ordering";

const columns = (): ColumnView[] => [
  { stateId: null, storyIds: ["i1", "i2"] },
  { stateId: "todo", storyIds: ["t1", "t2", "t3"] },
  { stateId: "done", storyIds: [] },
];

describe("moveStoryTo", () => {
  it("reorders within a column", () => {
    const next = moveStoryTo(columns(), "t3", "todo", 0);
    expect(orderedIdsFor(next, "todo")).toEqual(["t3", "t1", "t2"]);
  });

  it("moves across columns at the requested index", () => {
    const next = moveStoryTo(columns(), "i1", "todo", 1);
    expect(orderedIdsFor(next, "todo")).toEqual(["t1", "i1", "t2", "t3"]);
    expect(orderedIdsFor(next, null)).toEqual(["i2"]);
  });

  it("appends when the index is past the end and clamps a negative index", () => {
    expect(orderedIdsFor(moveStoryTo(columns(), "i1", "done", 99), "done")).toEqual(["i1"]);
    expect(orderedIdsFor(moveStoryTo(columns(), "t3", "todo", -5), "todo")).toEqual(["t3", "t1", "t2"]);
  });

  it("moves into the Icebox (null state)", () => {
    const next = moveStoryTo(columns(), "t1", null, 0);
    expect(orderedIdsFor(next, null)).toEqual(["t1", "i1", "i2"]);
  });

  it("leaves the board untouched for an unknown story or column", () => {
    expect(moveStoryTo(columns(), "ghost", "todo", 0)).toEqual(columns());
    expect(moveStoryTo(columns(), "t1", "nope", 0)).toEqual(columns());
  });

  it("never mutates its input", () => {
    const before = columns();
    moveStoryTo(before, "t1", null, 0);
    expect(before).toEqual(columns());
  });
});

describe("columnOf", () => {
  it("finds the column holding a story", () => {
    expect(columnOf(columns(), "t2")?.stateId).toBe("todo");
    expect(columnOf(columns(), "i2")?.stateId).toBeNull();
    expect(columnOf(columns(), "ghost")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @storylane/web exec vitest run src/lib/board-ordering.test.ts`
Expected: FAIL — cannot resolve `./board-ordering`.

- [ ] **Step 4: Implement the ordering module**

`apps/web/src/lib/board-ordering.ts`:

```ts
export interface ColumnView {
  stateId: string | null;
  storyIds: string[];
}

export function columnOf(columns: ColumnView[], storyId: string): ColumnView | undefined {
  return columns.find((column) => column.storyIds.includes(storyId));
}

export function orderedIdsFor(columns: ColumnView[], stateId: string | null): string[] {
  return columns.find((column) => column.stateId === stateId)?.storyIds ?? [];
}

/**
 * The whole drop computed in one place, so the optimistic board and the `orderedIds` the
 * server is sent can never disagree. Returns a fresh array; an unknown story or target column
 * yields the input unchanged (the caller then has nothing to send).
 */
export function moveStoryTo(
  columns: ColumnView[],
  storyId: string,
  targetStateId: string | null,
  targetIndex: number,
): ColumnView[] {
  const source = columnOf(columns, storyId);
  const target = columns.find((column) => column.stateId === targetStateId);
  if (!source || !target) return columns.map((column) => ({ ...column, storyIds: [...column.storyIds] }));
  const next = columns.map((column) => ({
    ...column,
    storyIds: column.storyIds.filter((id) => id !== storyId),
  }));
  const destination = next.find((column) => column.stateId === targetStateId)!;
  const index = Math.max(0, Math.min(targetIndex, destination.storyIds.length));
  destination.storyIds.splice(index, 0, storyId);
  return next;
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @storylane/web exec vitest run src/lib/board-ordering.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Implement the SSE hook**

`apps/web/src/lib/use-project-events.ts`:

```ts
import { useEffect } from "react";

/**
 * Invalidation only: the server sends no payload, so every event means "refetch what you show"
 * (design §6). EventSource reconnects by itself, and heartbeat comment frames keep proxies from
 * closing an idle stream.
 */
export function useProjectEvents(projectId: string | null, onChange: () => void): void {
  useEffect(() => {
    if (projectId === null || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/projects/${projectId}/events`, { withCredentials: true });
    const handler = () => onChange();
    source.addEventListener("project.changed", handler);
    return () => {
      source.removeEventListener("project.changed", handler);
      source.close();
    };
  }, [projectId, onChange]);
}
```

- [ ] **Step 7: Write the failing page tests**

`apps/web/src/pages/ProjectsPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectsPage } from "./ProjectsPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const list = [
  { id: "p1", name: "Live one", archivedAt: null, role: "owner" },
  { id: "p2", name: "Old one", archivedAt: 1_700_000_000_000, role: "member" },
];

describe("ProjectsPage", () => {
  it("groups archived projects in their own section below the active ones", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, list));
    render(<ProjectsPage onOpen={vi.fn()} />);
    expect(await screen.findByRole("link", { name: /live one/i })).toBeInTheDocument();
    const archivedHeading = screen.getByRole("heading", { name: /archived/i });
    expect(archivedHeading).toBeInTheDocument();
    // The archived project must render after the heading, never interleaved (principle 9).
    expect(archivedHeading.compareDocumentPosition(screen.getByRole("link", { name: /old one/i }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("opens the project it just created (principle 10)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(201, { id: "p9", name: "Fresh", archivedAt: null, role: "owner" }));
    const onOpen = vi.fn();
    render(<ProjectsPage onOpen={onOpen} />);
    await screen.findByRole("button", { name: /create project/i });
    await userEvent.type(screen.getByLabelText(/project name/i), "Fresh");
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("p9"));
    expect(JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string)).toEqual({ name: "Fresh" });
  });

  it("reports a failed create in place", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(400, { error: "name_required" }));
    render(<ProjectsPage onOpen={vi.fn()} />);
    await screen.findByRole("button", { name: /create project/i });
    await userEvent.click(screen.getByRole("button", { name: /create project/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/name is required/i);
  });
});
```

`apps/web/src/pages/BoardPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BoardPage } from "./BoardPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const board = {
  states: [
    { id: "todo", name: "Unstarted", category: "unstarted", actionLabel: "Start", position: 0 },
    { id: "doing", name: "Started", category: "in_progress", actionLabel: "Finish", position: 1 },
    { id: "done", name: "Accepted", category: "done", actionLabel: null, position: 2 },
  ],
  columns: [
    { stateId: null, stories: [{ id: "s1", number: 1, title: "Iced", storyType: "feature", stateId: null, position: 0, points: null, completedAt: null, assigneeId: null, requesterId: null, description: null }] },
    { stateId: "todo", stories: [{ id: "s2", number: 2, title: "Ready", storyType: "feature", stateId: "todo", position: 0, points: 2, completedAt: null, assigneeId: null, requesterId: null, description: null }] },
    { stateId: "doing", stories: [] },
    { stateId: "done", stories: [] },
  ],
};

describe("BoardPage", () => {
  it("renders one column per state plus the Icebox, with counts and point sums", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, board));
    render(<BoardPage projectId="p1" />);
    expect(await screen.findByRole("heading", { name: /icebox/i })).toBeInTheDocument();
    for (const name of ["Unstarted", "Started", "Accepted"]) {
      expect(screen.getByRole("heading", { name: new RegExp(name, "i") })).toBeInTheDocument();
    }
    expect(screen.getByTestId("column-todo-points")).toHaveTextContent("2");
    expect(screen.getByTestId("column-todo-count")).toHaveTextContent("1");
  });

  it("shows the story number and title on every card", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, board));
    render(<BoardPage projectId="p1" />);
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument();
  });

  it("advances a story with its state's action label and refetches", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, board))
      .mockResolvedValueOnce(json(200, { id: "s2", stateId: "doing" }))
      .mockResolvedValue(json(200, board));
    render(<BoardPage projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
    const [path, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(path).toBe("/api/projects/p1/stories/s2/move");
    expect(JSON.parse(init.body as string)).toEqual({ stateId: "doing", orderedIds: ["s2"] });
  });

  it("quick-adds a story into the Icebox, where new stories land", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, board))
      .mockResolvedValueOnce(json(201, { id: "s3", number: 3, title: "New one" }))
      .mockResolvedValue(json(200, board));
    render(<BoardPage projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: /add a story/i }));
    await userEvent.type(screen.getByLabelText(/title/i), "New one");
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
    const [path, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(path).toBe("/api/projects/p1/stories");
    expect(JSON.parse(init.body as string)).toMatchObject({ title: "New one", stateId: null });
  });

  it("surfaces a rejected move and puts the card back", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json(200, board))
      .mockResolvedValueOnce(json(409, { error: "estimate_required" }))
      .mockResolvedValue(json(200, board));
    render(<BoardPage projectId="p1" />);
    await userEvent.click(await screen.findByRole("button", { name: /^start$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/estimate/i);
    // The optimistic move was rolled back: the card is in Unstarted again.
    await waitFor(() => expect(screen.getByTestId("column-todo-count")).toHaveTextContent("1"));
  });

  it("does not render a disabled advance button on a done story (principle 1)", async () => {
    const doneBoard = {
      ...board,
      columns: [
        { stateId: null, stories: [] },
        { stateId: "todo", stories: [] },
        { stateId: "doing", stories: [] },
        { stateId: "done", stories: [{ ...board.columns[1]!.stories[0]!, id: "s9", stateId: "done", completedAt: 1_700_000_000_000 }] },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, doneBoard));
    render(<BoardPage projectId="p1" />);
    await screen.findByText("Ready");
    expect(screen.queryAllByRole("button", { name: /start|finish/i })).toHaveLength(0);
  });
});
```

- [ ] **Step 8: Run to verify they fail**

Run: `pnpm --filter @storylane/web exec vitest run src/pages/BoardPage.test.tsx src/pages/ProjectsPage.test.tsx`
Expected: FAIL — the page modules do not exist.

- [ ] **Step 9: Implement the projects page**

`apps/web/src/pages/ProjectsPage.tsx`:

```tsx
import { useState } from "react";
import { Link } from "wouter";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { buttonClass, Field, inputClass } from "../components/Field";

interface ProjectSummary {
  id: string;
  name: string;
  archivedAt: number | null;
  role: "owner" | "member" | "viewer";
}

export function ProjectsPage({ onOpen }: { onOpen: (projectId: string) => void }) {
  const projects = useResource<ProjectSummary[]>("/api/projects");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await apiFetch<ProjectSummary>("/api/projects", { method: "POST", body: { name } });
      // Principle 10: land in the thing that was just created.
      onOpen(created.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const rows = projects.data ?? [];
  const active = rows.filter((p) => p.archivedAt === null);
  const archived = rows.filter((p) => p.archivedAt !== null);

  const row = (project: ProjectSummary) => (
    <li key={project.id} className="border-b" style={{ borderColor: "var(--line)" }}>
      {/* A full row is the hit target, not just the text (principle 7). */}
      <Link href={`/projects/${project.id}/board`} className="flex items-center justify-between px-2 py-2 hover:bg-[var(--surface-2)]">
        <span>{project.name}</span>
        <span className="mono text-xs" style={{ color: "var(--ink-muted)" }}>{project.role}</span>
      </Link>
    </li>
  );

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl">Projects</h1>
      {/* The create affordance sits with the list it adds to (principle 4). */}
      <form onSubmit={create} className="flex items-end gap-2">
        <Field label="Project name">
          <input className={inputClass} style={{ borderColor: "var(--line)" }} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button className={`${buttonClass} mb-5`} style={{ borderColor: "var(--line)" }} type="submit">Create project</button>
      </form>
      <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      {projects.loading ? <p className="text-sm">Loading…</p> : <ul className="border-t" style={{ borderColor: "var(--line)" }}>{active.map(row)}</ul>}
      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm" style={{ color: "var(--ink-muted)" }}>Archived</h2>
          <ul className="border-t" style={{ borderColor: "var(--line)" }}>{archived.map(row)}</ul>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 10: Implement the card, the column and the board**

`apps/web/src/components/StoryCard.tsx`:

```tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { computeStateGate, type GateState } from "@storylane/core";
import { buttonClass } from "./Field";

export interface StoryView {
  id: string;
  number: number;
  title: string;
  storyType: "feature" | "bug" | "chore" | "release";
  stateId: string | null;
  points: number | null;
  completedAt: number | null;
}

/**
 * The one-click advance button (or Accept/Reject pair, or Restart) is computed by
 * packages/core from the project's states — never from a state name.
 */
export function StoryCard({
  story,
  states,
  onAdvance,
}: {
  story: StoryView;
  states: GateState[];
  onAdvance: (targetStateId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: story.id });
  const gate = computeStateGate(states, story.stateId);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, borderColor: "var(--line)" }}
      className="flex flex-col gap-1 rounded border bg-[var(--surface)] p-2"
      {...attributes}
      {...listeners}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{story.title}</span>
        <span className="mono text-xs" style={{ color: "var(--ink-muted)" }}>#{story.number}</span>
      </div>
      <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
        <span>{story.storyType}</span>
        {story.points !== null && <span className="mono">{story.points}</span>}
      </div>
      {/* No dead controls: when there is no advance, nothing is rendered (principle 1). */}
      {gate.kind === "advance" && (
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => onAdvance(gate.targetStateId)}>
          {gate.label}
        </button>
      )}
      {gate.kind === "accept-reject" && (
        <div className="flex gap-1">
          <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => onAdvance(gate.acceptStateId)}>
            {gate.acceptLabel}
          </button>
          {gate.rejectStateId !== null && (
            <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => onAdvance(gate.rejectStateId!)}>
              Reject
            </button>
          )}
        </div>
      )}
      {gate.kind === "restart" && gate.targetStateId !== null && (
        <button className={buttonClass} style={{ borderColor: "var(--line)" }} onClick={() => onAdvance(gate.targetStateId!)}>
          Restart
        </button>
      )}
    </li>
  );
}
```

`apps/web/src/components/BoardColumn.tsx` — a `SortableContext` per column, a header with the state name, `data-testid={`column-${stateId ?? "icebox"}-count`}` and `…-points`, category tinting derived from `category` (green for `done`, red for `rejected`, neutral otherwise), and the quick-add slot rendered only for the Icebox column. The header reserves the quick-add row's height in every column so switching columns never shifts the cards (principle 3).

`apps/web/src/components/QuickAddCard.tsx` — a `+ Add a story` trigger that swaps into an inline form (`Title` required, `Type`, `Points`), submits `POST /api/projects/:id/stories` with `stateId: null`, and returns to the trigger on success. New stories land in the Icebox (`spec/features.md` "Icebox: new stories start in the Icebox"), which is also the group the affordance sits in (principle 4).

`apps/web/src/pages/BoardPage.tsx`:

```tsx
import { useCallback, useMemo, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { apiFetch, errorMessage } from "../lib/api";
import { useResource } from "../lib/use-resource";
import { useProjectEvents } from "../lib/use-project-events";
import { moveStoryTo, orderedIdsFor, type ColumnView } from "../lib/board-ordering";
import { BoardColumn } from "../components/BoardColumn";
import type { StoryView } from "../components/StoryCard";

interface BoardState {
  id: string;
  name: string;
  category: "unstarted" | "in_progress" | "done" | "rejected";
  actionLabel: string | null;
  position: number;
}

interface BoardResponse {
  states: BoardState[];
  columns: Array<{ stateId: string | null; stories: StoryView[] }>;
}

export function BoardPage({ projectId }: { projectId: string }) {
  const board = useResource<BoardResponse>(`/api/projects/${projectId}/board`);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ColumnView[] | null>(null);
  const reload = board.reload;
  useProjectEvents(projectId, useCallback(() => reload(), [reload]));

  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));

  const columns: ColumnView[] = useMemo(
    () => pending ?? (board.data?.columns ?? []).map((c) => ({ stateId: c.stateId, storyIds: c.stories.map((s) => s.id) })),
    [pending, board.data],
  );

  const storiesById = useMemo(() => {
    const map = new Map<string, StoryView>();
    for (const column of board.data?.columns ?? []) for (const story of column.stories) map.set(story.id, story);
    return map;
  }, [board.data]);

  const gateStates = useMemo(
    () => (board.data?.states ?? []).map((s) => ({ id: s.id, category: s.category, actionLabel: s.actionLabel, position: s.position })),
    [board.data],
  );

  async function commit(next: ColumnView[], storyId: string, targetStateId: string | null) {
    setError(null);
    setPending(next);
    try {
      await apiFetch(`/api/projects/${projectId}/stories/${storyId}/move`, {
        method: "POST",
        body: { stateId: targetStateId, orderedIds: orderedIdsFor(next, targetStateId) },
      });
      setPending(null);
      reload();
    } catch (e) {
      // Every action produces visible feedback, and a refused move snaps back (principle 2).
      setPending(null);
      setError(errorMessage(e));
      reload();
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const storyId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (overId === null) return;
    // dnd-kit reports either a column droppable ("column:<stateId|icebox>") or a sibling card.
    const target = overId.startsWith("column:")
      ? { stateId: overId === "column:icebox" ? null : overId.slice("column:".length), index: Number.MAX_SAFE_INTEGER }
      : (() => {
          const column = columns.find((c) => c.storyIds.includes(overId))!;
          return { stateId: column.stateId, index: column.storyIds.indexOf(overId) };
        })();
    void commit(moveStoryTo(columns, storyId, target.stateId, target.index), storyId, target.stateId);
  }

  function advance(storyId: string, targetStateId: string) {
    void commit(moveStoryTo(columns, storyId, targetStateId, Number.MAX_SAFE_INTEGER), storyId, targetStateId);
  }

  if (board.loading && !board.data) return <main className="p-6 text-sm">Loading the board…</main>;
  if (board.error && !board.data) {
    return (
      <main className="p-6 text-sm" role="alert">
        {errorMessage(board.error)}
      </main>
    );
  }

  return (
    <main className="flex flex-col gap-3 p-4">
      <p role="alert" className="min-h-5 text-xs" style={{ color: "var(--danger)" }}>{error ?? ""}</p>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto">
          {columns.map((column) => {
            const state = board.data!.states.find((s) => s.id === column.stateId) ?? null;
            return (
              <BoardColumn
                key={column.stateId ?? "icebox"}
                projectId={projectId}
                state={state}
                storyIds={column.storyIds}
                storiesById={storiesById}
                gateStates={gateStates}
                onAdvance={advance}
                onAdded={reload}
              />
            );
          })}
        </div>
      </DndContext>
    </main>
  );
}
```

Extend `apps/web/src/app-routes.tsx`'s signed-in branch:

```tsx
      <Route path="/projects/:id/board">{(params) => <BoardPage projectId={params.id!} />}</Route>
      <Route path="/">{() => <ProjectsPage onOpen={(id) => navigate(`/projects/${id}/board`)} />}</Route>
      <Route>{() => <ProjectsPage onOpen={(id) => navigate(`/projects/${id}/board`)} />}</Route>
```

`useProjectEvents` is inert in jsdom (`EventSource` is undefined there), so the page tests exercise the fetch path without a live stream.

- [ ] **Step 11: Run the web suite**

```bash
pnpm --filter @storylane/web test
```
```bash
pnpm --filter @storylane/web run lint
```
```bash
pnpm --filter @storylane/web run build
```
Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src apps/web/package.json pnpm-lock.yaml
```
```bash
git commit -m "feat(web): project list, board columns with dnd-kit drag, quick-add and SSE-driven refetch (TASK-253)"
```

- [ ] **Step 13: fable-advisor design review (required gate)**

Run the `/advisor` skill with one focused question and wait for the verdict:

> Phase-1 board and auth screens (apps/web/src/pages, apps/web/src/components) against `spec/ux-principles.md`: which principle does this change violate, if any? Specifically: (a) quick-add lives on the **Icebox** column because `spec/features.md` says new stories start in the Icebox, while `spec/screens.md` "Kanban view" puts the `+` on the first `unstarted` column — which is right for phase 1? (b) the advance button is hidden rather than disabled when a story cannot advance (principle 1) — is hiding the right reading? (c) the board shows every state column including the Icebox, where `spec/screens.md` says the Kanban view has no Icebox column; phase 1 has no List view yet, so the Icebox would otherwise be unreachable.

Record the verdict and every triaged finding:

```bash
backlog task edit TASK-253 --append-notes "fable-advisor design review: <verdict + findings + triage>."
```

Fix the findings the owner accepts before the manual verification.

- [ ] **Step 14: Manual browser verification (owner)**

Give the owner these exact steps (they run them; no model can):

1. Build the SPA: `pnpm --filter @storylane/web run build`
2. Start the server on a scratch data dir:
   ```bash
   STORYLANE_DATA_DIR=/tmp/sl-phase1 STORYLANE_PORT=3000 pnpm --filter @storylane/server start
   ```
3. Copy the `"msg":"setup token"` value from the terminal.
4. Open `http://localhost:3000/` — the setup page appears. Paste the token, fill in name / email / a 12-character password, submit.
5. The projects page appears. Type a project name, press **Create project** — the board opens (principle 10).
6. Press **+ Add a story** on the Icebox column, add "First story", press **Add** — the card appears in the Icebox.
7. Drag the card onto the **Unstarted** column. It stays there; no error appears.
8. Press **Start** on the card — it moves to Started.
9. Drag it onto **Accepted** — the card shows as done. Drag it back to **Started** — the done styling clears (that is `completed_at` being cleared).
10. Create a second story **without** points and try to drag it straight to Started — the move is refused with "Estimate this story…" and the card returns.
11. Open a second browser window on the same board, move a card in the first — the second updates within a second or two (SSE).
12. Clean up: stop the server, then `rm -rf /tmp/sl-phase1`.

Record the outcome in TASK-253 notes.

---

### Task 10: Phase-1 release (TASK-254) — owner steps

This is the owner's task (`@l4l4dev`): it needs interactive git operations, a published image and a real outside person. A model may prepare the three documentation edits in steps 1–3 as a normal commit; everything from step 4 on is the owner's.

**Files:**
- Modify: `INSTALL.md` (§1 and the upgrade section), `README.md` ("try in 60 seconds"), `spec/data-model.md` (Supabase-era prose sweep, deferred from TASK-237), `apps/server/package.json` (version), `ARCHITECTURE.md` (below the marker)

**Interfaces:** none — no code changes.

- [ ] **Step 1: INSTALL.md §1 walks through the real first run**

Replace the "there is no setup page yet (phase 1)" wording with the actual flow:

1. `docker run -d -p 3000:3000 -v storylane:/data ghcr.io/l4l4dev/storylane:latest`
2. `docker logs <container>` and copy the value of the `"msg":"setup token"` line. State that the token is single-use, expires after 30 minutes, and that **restarting the container prints a new one** while no admin exists.
3. Open `http://<host>:3000/`, paste the token, create the admin (email + name + a 12-character password).
4. Create the first project; `/setup` is closed from then on.
5. Add the note that further users join through an **invite link** minted by a project owner, and that a forgotten password is reset by an instance admin minting a one-time link (no email is sent by this instance).

Also state in the upgrade section that a pre-migration backup (`/data/backups/pre-<version>.db`) is written before migrations on every boot, and that phase-1 upgrades add tables only.

- [ ] **Step 2: README "try in 60 seconds"**

The same four lines as INSTALL §1, trimmed: `docker run`, `docker logs` for the token, open the page, create the admin. Point at `INSTALL.md` for TLS/compose. Keep the `:edge` vs `:latest` distinction accurate — after step 6 `latest` exists, so README may finally use it.

- [ ] **Step 3: spec/data-model.md Supabase-era prose sweep**

The mechanical part of the deferral recorded in the phase-0 ledger. For every table phase 1 actually ships (`users`/`profiles`, `projects`, `project_members`, `project_states`, `stories`, `activity_logs`), replace Postgres-only wording with the SQLite reality, and mark the rest as not-yet-built:

- `### users` — the `profiles`/`auth.users` split is gone; `users` holds email (UNIQUE COLLATE NOCASE), argon2id `password_hash`, `display_name`, `is_admin`, `disabled_at`.
- Type wording throughout: `uuid` → `text` (UUIDv7), `timestamptz` → `integer` (UTC ms), `boolean` → `integer` 0/1, `jsonb` → `text`.
- Replace every "RLS policy" / "SECURITY DEFINER" / "RPC" sentence for shipped tables with a pointer to `spec/permissions.md` and the owning service (`apps/server/src/services/*`), e.g. `set_story_state` → `moveStory()` in `services/stories.ts`, the activity trigger → `recordActivity()`.
- Add one line at the top of each table block that phase 1 does **not** ship (iterations, labels, tasks, comments, my_work_*, backlog_dividers, integrations, story hierarchy): "Not yet built in the self-hosted rewrite — phase 2/3."

Do not delete the numeric behaviour or the invariants — they are still the spec.

Then commit (a model may do steps 1–3):

```bash
git add INSTALL.md README.md spec/data-model.md
```
```bash
git commit -m "docs: phase-1 install flow, README quick start and the SQLite data-model sweep (TASK-254)"
```

- [ ] **Step 4: Owner — run `/code-review high` on the whole branch**

`/code-review` cannot be started by a model. The owner types it; it covers migrations, authz and the board algorithm, so `high` is the right level. Hold the merge until the findings are triaged (repo rule: surface findings before merging). Also confirm the `authz-reviewer` notes exist on TASK-245, TASK-247 and TASK-252.

- [ ] **Step 5: Owner — merge to `main`**

```bash
git switch rewrite/self-hosted
```
```bash
git merge --no-ff rewrite/phase-1
```
```bash
git switch main
```
```bash
git merge --no-ff rewrite/self-hosted
```
Phase 0 is unmerged, so `main` gains both phases in one go. Open a PR instead if the owner wants the Codex review pass (`@codex review` in a comment after each round of fixes).

- [ ] **Step 6: Owner — cut v0.1.0**

Bump `apps/server/package.json` to `0.1.0` if it is not already there, commit, then:

```bash
git tag -a v0.1.0 -m "Phase 1: self-hosted vertical slice"
```
```bash
git push origin main
```
```bash
git push origin v0.1.0
```
CI (`.github/workflows/publish.yml`) publishes `latest` + `0.1.0` for the semver tag. Watch the run and confirm both tags exist on ghcr.

- [ ] **Step 7: Owner — verify the published image on a clean machine**

```bash
docker run --rm -d -p 3000:3000 -v storylane-fresh:/data ghcr.io/l4l4dev/storylane:latest
```
Then walk the INSTALL §1 steps end to end (token → admin → project → a story → drag it). Afterwards:

```bash
docker volume rm storylane-fresh
```

- [ ] **Step 8: Owner — outside install test**

Have at least one person who did not build this install it from `INSTALL.md` alone, and write down every place they hesitated. File each friction point as a Backlog task (ask before creating, per the repo rule) with a milestone, and let those tasks precede phase 2 (design §9: "their friction is fixed first"). Record the summary:

```bash
backlog task edit TASK-254 --append-notes "Outside install by <person, non-identifying>: <friction list> → TASK-<ids>."
```

---

## Spec coverage (self-review)

| Requirement | Task |
|---|---|
| design §3 project-scoped authorization, fail closed, matrix over five actors | 1a, and every route task's manifest + matrix rows |
| design §3 `loadInProject`, composite `(id, project_id)` keys | 2 (indexes), 5a/6a (all row loads) |
| design §4 argon2id, hashed sessions, absolute + idle expiry, new id on login, logout, revoke on password change | 3a |
| design §4 `Secure`-when-HTTPS cookie, CSRF Origin/Sec-Fetch-Site + JSON, rate limits with `STORYLANE_TRUST_PROXY`, uniform login failure | 3a (cookie), 3b (guard, limits, routes) |
| design §4 hashed reset tokens, admin-minted one-time links, no SMTP | 8b |
| design §5 SQLite conventions, `MAX+1` numbering, two-step `reorder`, `RAISE(ABORT)` guards, `completed_at` from category, `recordActivity` | 2, 1b, 5a, 6a |
| design §6 in-process bus, SSE invalidation-only, heartbeat, cleanup on abort | 7 |
| design §7 setup token (single use, 30 min, reprinted on restart), `409 setup_required`, single-admin creation, invite links | 4, 8a |
| design §7 install experience documented | 10 |
| `spec/permissions.md` new action + rules for non-matrix routes | 8a |
| `spec/features.md` Icebox default, point scale, estimation gate, per-project states | 6a, 9b |
| `spec/screens.md` "Board layout" basics (columns in position order, counts, point sums, drag = set state, advance button from `packages/core`, quick-add) | 9b |
| `spec/ux-principles.md` gate (advisor review + manual verification) | 9b |
| TASK-240 carry-over 1 (projectId-scoped store), 2 (`.tx` lint), 3 (nesting), 6 (COLLATE NOCASE), 7 (reorder scope test) | 1a, 3b, 8a, 5a |
| TASK-240 carry-over 4 (last-owner 409), 5 (explicit write flag), 8 (carry the project row on `ProjectTx`) | **not in phase 1** — 4 needs the member-management routes (phase 2); 5 and 8 are refactors with no phase-1 behaviour change. Leave them in TASK-240's notes. |
