# Tracker-parity rewrite — Step 1 (Core model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the doc-8 domain (project states, board stories, person-day velocity) with Pivotal Tracker's own core model — schema, guard triggers, services, JSON API, Tracker-shaped activity, before/after-id story ordering, the Owner/Member/Viewer permission matrix, and the pure velocity / planning / iteration / search-parser logic in `packages/core` with golden fixtures — so every panel built in steps 2–10 reads one faithful model.

**Architecture:** The 2026-09-05 foundation is kept whole: routes stay thin, every project read or write goes through `withProject(db, actor, projectId, action, fn)` and a synchronous `ProjectTx`, guards live in SQLite triggers, behaviour lives in `services/`. What changes is everything domain-shaped underneath: `project_states` and the board schema are deleted, the five unshipped migrations are squashed into a fresh `0000`, `activity_logs` becomes Tracker's `activities` (kind / highlight / message / changes JSON / project_version), story ordering becomes two sparse-position lists moved by `before_id` / `after_id`, and iterations stop being rows — they are computed on read from the project's start date, iteration length, week start day and time zone, with `iteration_overrides` the only stored deviation.

**Tech Stack:** Bun 1.4 (`bun test`, `bun:sqlite` synchronous transactions, `Bun.randomUUIDv7()`), Hono, Drizzle ORM + Drizzle Kit (sqlite dialect), pnpm workspaces, Vitest (`packages/core`, `apps/web`), Vite + React 19 (web shell only in this step), `Intl.DateTimeFormat` for project-time-zone arithmetic.

**Spec:** `docs/design/2026-09-16-tracker-parity-rewrite-design.md` (§2 kept/discarded, §3.2 core model, §3.3 step table, §4 branch/migration rules are binding) and `docs/reference/tracker-notes/core-model.md` (§1–§8 are the field tables and rules this schema must match; §9 unknowns are resolved by the Assumptions section below). Predecessor plan: `docs/plans/2026-09-07-self-host-phase-1.md` — its foundation rulings still hold except where §2 of the design discards them.

## Global Constraints

- Branch: all work on `rewrite/tracker` (from `rewrite/phase-1`, HEAD `eea9178`). **No commit lands on `main` until `rewrite/tracker` merges** (design §4) — that includes `.backlog/` housekeeping. Never push unless the owner asks.
- Repo rules: never `git add -A` / `git add .` — list paths explicitly. Never chain state-changing commands with `&&` — one command per step. Conventional Commits. Every commit message ends with the trailer:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- This repository is public: no personal name or private email anywhere git-tracked. The owner is `@l4l4dev`. Test identities are fictional and use `@example.test`. "Pivotal Tracker" may appear in `spec/`, `docs/` and code comments; it must never appear in product UI strings.
- `bun:sqlite` transactions are synchronous: **no `await` inside `db.transaction()` / `withProject()` / `withTwoProjects()` callbacks.** `local/no-await-in-transaction` fails the build and `NotPromise<T>` rejects async callbacks at compile time. Parse request bodies and read files *before* opening the transaction.
- Routes never touch `.tx` (`local/no-project-tx-escape`); `src/services/**` and `src/routes/**` may not import `src/db/client` for anything but the `Db` type.
- Writes use `behavior: "immediate"` (`withProject` derives it from `isWrite(action)`). One `withProject` per request — nesting throws.
- Conventions: ids are `text` UUIDv7 via `newId()`; instants are `integer` UTC milliseconds; calendar dates are `text` `YYYY-MM-DD`; booleans are `integer` 0/1; enums are `text` + CHECK with the value list declared once in a TS module; JSON is stored as `text` and never used in `WHERE`.
- Sequences (`stories.number`) are `MAX(x)+1` **inside** the transaction. Dense reordering uses `reorder(tx, table, scope, orderedIds)` and is reserved for small lists (tasks, labels, epics, review types); stories use sparse positions (Task 9).
- Response-code precedence `401 (anon) → 401 (disabled) → 404 (missing / non-member) → 409 (archived write) → 403`. 409 codes: `project_archived`, `setup_required`, `last_owner`, `estimate_required`, `invalid_transition`.
- Migrations are generated with `pnpm --filter @storylane/server db:generate`. Drizzle Kit does not emit triggers — hand-append trigger SQL to the newly generated, not-yet-committed file, separated by `--> statement-breakpoint`. After Task 5 the single migration `0000` is treated as shipped again: never edit it in a later task; add `0001`, `0002`, … instead.
- Every route registered in `app.ts` needs a `ROUTE_ACTIONS` entry (`apps/server/test/route-matrix.test.ts` fails otherwise) and, when project-scoped, a passing five-actor matrix row plus a `matrix-fixtures.ts` entry.
- `spec/permissions.md` and `spec/fixtures/permissions.json` must stay byte-equivalent — `packages/core/src/permissions.test.ts` parses the markdown table and compares it to the fixture.
- Preserve the `<!-- hook:end -->` marker in `ARCHITECTURE.md`.
- Tests: server `bun test` (and `bun test <path>` while iterating) from `apps/server`; core and web `vitest`. A task is not done until its own tests pass **and** `pnpm --filter @storylane/server test`, `pnpm --filter @storylane/server lint`, `pnpm --filter @storylane/server typecheck`, `pnpm --filter @storylane/core test`, `pnpm --filter @storylane/web test`, `pnpm --filter @storylane/web lint` are green, and the commit is made.
- **Advisor gate (CLAUDE.md):** Task 4 (permission matrix) and Task 5 (schema) must be sent to `/advisor` (fable-advisor) *before* execution, as one unit each. Do not start either task until the owner relays the verdict.
- **authz-reviewer gate:** Task 4 changes `spec/permissions.md` and `apps/server/src/authz/`; run the `authz-reviewer` agent after it and record the verdict in the Backlog task notes.
- `/code-review` runs before every commit proposal — a model cannot start it; ask the owner and wait.

---

## Assumptions (resolving `core-model.md` §9 unknowns)

Each line is a decision this plan makes where the reference corpus is silent. They are repeated as code comments only where the code would otherwise look arbitrary, and are listed in `spec/data-model.md` "Assumptions" (Task 22) so a later corpus find can overturn them deliberately.

1. **§9.1 packing and capacity (assumption).** Stories in `started`, `finished`, `delivered`, `accepted` and `rejected` are always in Current and *do* consume Current capacity. Current uses the asymmetric rule: an estimated story is taken while `total < capacity`; an unestimated one while `total <= capacity`; the first refusal ends Current (it is always a prefix of the list). Backlog iterations use strict fit — a story is taken only when `total + estimate <= capacity` — and a story whose estimate alone exceeds capacity gets an iteration to itself rather than being skipped forever. List order is never reordered to make something fit. The note's worked example ("velocity 8 → a 7-point then a 9-point iteration") cannot be reproduced by any single consistent rule and is treated as unreliable; the article's prose ("takes only what fits") wins.
2. **§9.2 `estimate: -1` (assumption).** Not stored. `stories.estimate` is a nullable `real`; `-1` exists only as the search-layer sentinel, and `search-query.ts` maps `estimate:-1` to "estimate IS NULL".
3. **§9.3 activity enumeration (assumption).** `ACTIVITY_KINDS` is a closed TS union holding exactly the kinds step 1 writes (the §5.2 subset for stories, epics, comments, tasks, labels, blockers, reviews, review types, followers, iteration overrides, project updates and memberships). `changes[].change_type` has three values: `create`, `update`, `delete`.
4. **§9.4 `original_values` / `new_values` (assumption).** Only the columns the service actually changed, keyed by the API's snake_case field names. No derived fields are included (the corpus's one example includes a derived `finish`; we do not copy that).
5. **§9.5 `story_priority` (assumption).** A display-only field. It never affects ordering, planning or velocity. Of the three visibility flags only `show_story_priority` is stored; `show_priority_icon` and `show_priority_icon_in_all_panels` wait for the step-8 corpus pass.
6. **§9.6 ranges (assumption).** `iteration_length` and `velocity_averaged_over` are both CHECKed to 1–4 (the articles' range). `iteration_overrides.length` is CHECKed to 1–99.
7. **§9.7 `planned` (assumption).** `planned` is settable through the API, but only while `projects.automatic_planning = 0`; a guard trigger rejects it otherwise. The story `group` value `current` is likewise accepted only under manual planning.
8. **§9.8 label colours (assumption).** No colour column in step 1. Epic/label colouring is a step-6 corpus question.
9. **§9.9 `project.status` (assumption).** Not carried — the field is never described in the corpus.
10. **§9.10 manual iteration markers (assumption).** No representation in step 1. Manual planning markers are step 4 (design §3.3); step 1 only needs the `automatic_planning` flag and the `planned` state.

Two further decisions the note leaves implicit:

11. **`current_iteration_number` is derived, never stored** (design §3.2: "Iterations are derived, not stored"), computed by `currentIterationNumber()` from the project calendar and serialized as a read-only field.
12. **`point_scale` is the comma-separated string** Tracker uses, stored verbatim; `point_scale_is_custom` is computed on read by comparing against the three built-ins. The old `point_scale` enum column and its guard triggers are gone.

**Deferred out of step 1 by the design:** `saved_searches` (step 7 — `search-query.ts` ships now, the saved-search table and its routes do not), analytics/burndown rollups (step 9), integrations, webhooks, source commits, notifications, reactions, story templates, Google attachments (step 10 / divergence list §10), per-member `project_color` and `favorite` *routes* (step 8 — the columns land now so the dashboard needs no migration).

---

## File map after Step 1

```
apps/server/
  src/db/schema/projects.ts        Task 5  — projects (rewritten), project_members (+3 columns)
  src/db/schema/stories.ts         Task 5  — stories, story_owners, story_followers  (replaces board.ts)
  src/db/schema/labels.ts          Task 5  — labels, story_labels, epics
  src/db/schema/attachments.ts     Task 5  — tasks, comments, file_attachments
  src/db/schema/workflow.ts        Task 5  — blockers, review_types, reviews
  src/db/schema/iterations.ts      Task 5  — iteration_overrides
  src/db/schema/activity.ts        Task 5  — activities, activity_resources (replaces activity_logs)
  src/db/migrations/0000_*.sql     Task 5  — the single squashed migration + all guard triggers
  src/services/activity.ts         Task 7  — recordActivity (Tracker shape) + bumpVersion
  src/services/projects.ts         Task 6  — settings read/update, memberships
  src/services/stories.ts          Task 8  — CRUD, transitions; Task 9 — move
  src/services/ordering.ts         Task 9  — placeInList / renumberAround (sparse positions)
  src/services/story-people.ts     Task 10 — owners, followers
  src/services/labels.ts           Task 11 — labels, story labels, epics
  src/services/tasks.ts            Task 12 — story tasks
  src/services/comments.ts         Task 13 — comments + file attachments
  src/services/blockers.ts         Task 14 — blockers + accept-time resolution
  src/services/reviews.ts          Task 15 — review types + reviews
  src/services/iterations.ts       Task 16 — iteration overrides; Task 20 — derived iterations
  src/attachments/store.ts         Task 13 — on-disk blob store under $STORYLANE_DATA_DIR
  src/routes/projects.ts           Task 6  — GET/PUT project, memberships
  src/routes/stories.ts            Tasks 8-10 — stories, owners, followers
  src/routes/labels.ts             Task 11 — labels, epics
  src/routes/story-parts.ts        Tasks 12-15 — tasks, comments, attachments, blockers, reviews
  src/routes/iterations.ts         Tasks 16, 20 — overrides + derived iterations
  src/routes/activity.ts           Task 7  — GET activity?since_version=
packages/core/
  src/story.ts                     Task 8  — states, types, priorities, transition + estimation rules
  src/point-scale.ts               Task 6  — parse/validate Tracker point scales
  src/iterations.ts                Task 17 — windows, current number, zone arithmetic
  src/velocity.ts                  Task 18 — Tracker's published formula
  src/planning.ts                  Task 19 — the Current/Backlog cut
  src/search-query.ts              Task 21 — the query parser
spec/fixtures/
  permissions.json                 Task 4  — Tracker roles
  iterations.json                  Task 17
  velocity.json                    Task 18
  planning.json                    Task 19
  search-query.json                Task 21
```

Deleted by Tasks 1–3: `apps/server/src/db/schema/board.ts`, `src/services/states.ts`, the doc-8 `src/services/stories.ts`, `src/routes/stories.ts`, `test/{states,stories,stories-routes}.test.ts`, `packages/core/src/{capacity,container-rollup,story-state,story-types,velocity,points}.ts` and their tests, `spec/fixtures/{capacity,container-rollup,state-templates}.json`, and the board half of `apps/web/src`.

---

## Task 1: Protect the pre-rewrite history, then delete the doc-8 server domain

**Files:**
- Delete: `apps/server/src/services/states.ts`, `apps/server/src/services/stories.ts`, `apps/server/src/routes/stories.ts`, `apps/server/src/db/schema/board.ts`, `apps/server/test/states.test.ts`, `apps/server/test/stories.test.ts`, `apps/server/test/stories-routes.test.ts`
- Modify: `apps/server/src/db/schema/index.ts`, `apps/server/src/services/projects.ts`, `apps/server/src/routes/projects.ts`, `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/src/services/activity.ts`, `apps/server/test/harness.ts`, `apps/server/test/matrix-fixtures.ts`, `apps/server/test/route-matrix.test.ts`, `apps/server/test/schema-constraints.test.ts`, `apps/server/test/activity.test.ts`, `apps/server/test/projects.test.ts`, `apps/server/test/projects-routes.test.ts`, `apps/server/src/routes/limits.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a server with no story/state domain. `createProject(db, actor, input: { name: string }): ProjectDetail` loses its `template` parameter. `ACTIVITY_ACTIONS` shrinks to `["project.created","project.updated","project.archived","project.unarchived","member.invited","member.invite_revoked","member.joined"]` (Task 7 replaces the whole module). `ProjectDetail` keeps `pointScale`/`customPoints` until Task 6.

- [ ] **Step 1: Tag the branches that are about to be superseded (design §4)**

These tags are the only copy of the phase-0/phase-1 history if anything goes wrong. Pushing them is the owner's action, not this task's.

```bash
git tag -f rewrite-phase-0 rewrite/self-hosted
```

```bash
git tag -f rewrite-phase-1 rewrite/phase-1
```

```bash
git tag --list 'rewrite-phase-*'
```
Expected: both tag names printed.

- [ ] **Step 2: Confirm the working tree is on the right branch and clean of unrelated edits**

Run: `git status --short --branch`
Expected: `## rewrite/tracker`, and no modifications under `apps/` or `packages/`.

- [ ] **Step 3: Delete the domain source and its tests**

```bash
git rm apps/server/src/services/states.ts apps/server/src/services/stories.ts apps/server/src/routes/stories.ts apps/server/src/db/schema/board.ts
```

```bash
git rm apps/server/test/states.test.ts apps/server/test/stories.test.ts apps/server/test/stories-routes.test.ts
```

- [ ] **Step 4: Drop the board module from the schema barrel**

In `apps/server/src/db/schema/index.ts`, delete the line `export * from "./board";`. The file becomes:

```ts
export * from "./meta";
export * from "./auth";
export * from "./projects";
export * from "./activity";
export * from "./sessions";
```

- [ ] **Step 5: Cut state seeding out of project creation**

In `apps/server/src/services/projects.ts`: delete the `import { seedTemplateStates, type ProjectTemplate } from "./states";` line and the `export type { ProjectTemplate };` line, and change `createProject`'s signature and body:

```ts
export function createProject(db: Db, actor: Actor, input: { name: string }): ProjectDetail {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  if (input.name.trim().length === 0) throw new HttpError(400, "name_required");
  assertNoOpenTransaction("createProject");
  const now = Date.now();
  const id = newId();
  return db.transaction(
    (tx) => {
      tx.insert(projects).values({ id, name: input.name.trim(), createdBy: actor.userId, createdAt: now }).run();
      tx.insert(projectMembers).values({ projectId: id, userId: actor.userId, role: "owner", joinedAt: now }).run();
      recordActivity(bootstrapScope(tx, id, actor), { action: "project.created", payload: { name: input.name.trim() } });
      return {
        id,
        name: input.name.trim(),
        description: null,
        archivedAt: null,
        role: "owner" as MemberRole,
        pointScale: "fibonacci" as PointScale,
        customPoints: null,
      };
    },
    { behavior: "immediate" },
  );
}
```

- [ ] **Step 6: Remove the state routes and the story route group**

In `apps/server/src/routes/projects.ts`: delete the `../services/states` import, drop `STATE_CATEGORIES`/`StateCategory` from the `../db/schema` import, delete `ACTION_LABEL_MAX` from the `./limits` import, delete every chained handler from `.get("/api/projects/:id/states", …)` through `.delete("/api/projects/:id/states/:stateId", …)`, and delete any `template` handling in the `POST /api/projects` body validation.

In `apps/server/src/app.ts`: delete `import { storyRoutes } from "./routes/stories";` and the line `app.route("/", storyRoutes({ db: deps.db, bus, actorOf }));`.

In `apps/server/src/routes/limits.ts`: delete the `ACTION_LABEL_MAX` export if nothing else references it (`grep -rn ACTION_LABEL_MAX apps/server/src` must print nothing afterwards).

- [ ] **Step 7: Shrink the route manifest**

In `apps/server/src/authz/route-manifest.ts`, delete these eight entries:

```
"GET /api/projects/:id/states", "POST /api/projects/:id/states",
"POST /api/projects/:id/states/reorder", "PATCH /api/projects/:id/states/:stateId",
"DELETE /api/projects/:id/states/:stateId", "GET /api/projects/:id/board",
"GET /api/projects/:id/stories", "POST /api/projects/:id/stories",
"PATCH /api/projects/:id/stories/:storyId", "POST /api/projects/:id/stories/:storyId/move",
"DELETE /api/projects/:id/stories/:storyId"
```

(The permission *fixture* keeps its rows for now; Task 4 rewrites it. An action with no route is allowed — the matrix test only fails on a route with no action.)

- [ ] **Step 8: Shrink the activity action list**

In `apps/server/src/services/activity.ts`, replace `ACTIVITY_ACTIONS` with:

```ts
export const ACTIVITY_ACTIONS = [
  "project.created",
  "project.updated",
  "project.archived",
  "project.unarchived",
  "member.invited",
  "member.invite_revoked",
  "member.joined",
] as const;
```

- [ ] **Step 9: Strip the test harness of state/story seeding**

In `apps/server/test/harness.ts`: delete `seedState` and `seedStory` entirely, and drop `projectStates`, `stories`, `StateCategory`, `StoryType` from the `../src/db/schema` import.

In `apps/server/test/matrix-fixtures.ts`: delete the `stateId`, `stateIds`, `storyId` and `iceboxOrder` fields from `MatrixContext` and every fixture entry whose key names `/states` or `/stories`.

In `apps/server/test/route-matrix.test.ts`: delete `seedState`/`seedStory` from the harness import, `projectStates`/`stories` from the schema import, the `currentStateIds` and `currentIceboxIds` helpers, the two `key === …` special cases in the fixture selection (`const fixture = base;`), the state/story entries in `DESTRUCTIVE` (leaving `"DELETE /api/projects/:id"`), and the state/story lines inside `seedFullProject` so it reads:

```ts
function seedFullProject() {
  const id = seedProject(db, ownerA, [
    [memberA, "member"],
    [viewerA, "viewer"],
  ]);
  const seededInvite = withProject(db, ownerA, id, "member:invite", (tx) => mintInvite(tx, { role: "member" }));
  return { id, inviteId: seededInvite.invite.id };
}
```
and `fixturesFor` passes only `{ projectId: t.id, inviteId: t.inviteId, userId: (ownerA as { userId: string }).userId }`.

In `apps/server/test/schema-constraints.test.ts`: delete the `describe("project_states", …)` and `describe("stories", …)` blocks and the now-unused imports. Keep the `projects` / `project_members` blocks.

In `apps/server/test/activity.test.ts`, `projects.test.ts` and `projects-routes.test.ts`: delete any assertion that names a state, a story, a template, or an activity action that no longer exists.

- [ ] **Step 10: Run the server suite**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail. If a test file still imports a deleted symbol, the failure names it — delete that assertion, never re-add the symbol.

- [ ] **Step 11: Lint and typecheck**

Run: `pnpm --filter @storylane/server lint`
Expected: no errors.

Run: `pnpm --filter @storylane/server typecheck`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
refactor(server): remove the doc-8 board domain

project_states, the board story service and their routes are replaced by
Tracker's model in this step; deleting them first keeps the squashed 0000
free of the workarounds forward-only history forced on them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 2: Delete the doc-8 modules and fixtures from `packages/core`

**Files:**
- Delete: `packages/core/src/capacity.ts`, `capacity.test.ts`, `container-rollup.ts`, `container-rollup.test.ts`, `story-state.ts`, `story-state.test.ts`, `story-types.ts`, `story-types.test.ts`, `velocity.ts`, `velocity.test.ts`, `points.ts`, `points.test.ts`; `spec/fixtures/capacity.json`, `spec/fixtures/container-rollup.json`, `spec/fixtures/state-templates.json`
- Modify: `packages/core/src/index.ts`
- Keep untouched: `packages/core/src/dates.ts` (wall-date arithmetic — Task 17 builds on it), `packages/core/src/permissions.test.ts` (the spec↔fixture guard)

**Interfaces:**
- Consumes: Task 1's server, which no longer imports `@storylane/core` domain helpers.
- Produces: `@storylane/core` exporting only `./dates` (`MS_PER_DAY`, `parseDateOnly`, `formatDateOnly`, `isoWeekday`, `addDays`). Tasks 6 and 17–21 add the Tracker modules.

- [ ] **Step 1: Prove the server no longer depends on the modules about to go**

Run: `grep -rn "@storylane/core" apps/server/src apps/web/src`
Expected: no output. (Task 1 removed the last import; if anything prints, fix it there before deleting.)

- [ ] **Step 2: Delete the modules and their fixtures**

```bash
git rm packages/core/src/capacity.ts packages/core/src/capacity.test.ts packages/core/src/container-rollup.ts packages/core/src/container-rollup.test.ts
```

```bash
git rm packages/core/src/story-state.ts packages/core/src/story-state.test.ts packages/core/src/story-types.ts packages/core/src/story-types.test.ts
```

```bash
git rm packages/core/src/velocity.ts packages/core/src/velocity.test.ts packages/core/src/points.ts packages/core/src/points.test.ts
```

```bash
git rm spec/fixtures/capacity.json spec/fixtures/container-rollup.json spec/fixtures/state-templates.json
```

- [ ] **Step 3: Reduce the barrel**

`packages/core/src/index.ts` becomes exactly:

```ts
export * from "./dates";
```

- [ ] **Step 4: Run the core suite**

Run: `pnpm --filter @storylane/core test`
Expected: PASS — `permissions.test.ts` (4 tests) plus any `dates` tests. No "cannot find module" errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src spec/fixtures
```

```bash
git commit -m "$(cat <<'MSG'
refactor(core): drop the doc-8 domain modules and fixtures

Person-day capacity, container roll-up, the category state gate and the
point-scale enum are doc-8 inventions with no counterpart in Tracker.
dates.ts stays: the derived-iteration math is built on it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 3: Reduce `apps/web/src` to the auth shell plus a project placeholder

**Files:**
- Delete: `apps/web/src/pages/BoardPage.tsx`, `BoardPage.test.tsx`, `apps/web/src/components/BoardColumn.tsx`, `BoardColumn.test.tsx`, `StoryCard.tsx`, `StoryCard.test.tsx`, `PointButtons.tsx`, `QuickAddCard.tsx`, `apps/web/src/lib/board-ordering.ts`, `board-ordering.test.ts`
- Create: `apps/web/src/pages/ProjectPage.tsx`, `apps/web/src/pages/ProjectPage.test.tsx`
- Modify: `apps/web/src/app-routes.tsx`, `apps/web/src/pages/ProjectsPage.tsx`, `apps/web/src/components/Header.tsx`, `apps/web/src/lib/api.ts`, `apps/web/package.json`
- Keep: `LoginPage`, `SetupPage`, `InviteAcceptPage`, `ResetPage` and their tests (foundation auth — design §2), `lib/session.tsx`, `lib/api.ts`, `lib/use-resource.ts`, `lib/use-project-events.ts` + its test (the SSE client is kept foundation), `components/Field.tsx`, `components/Header.tsx` + its test, `App.tsx` + its test

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (the web app talks to the server over HTTP only).
- Produces: `export function ProjectPage({ projectId }: { projectId: string }): JSX.Element` — renders the project's name and a "The project view arrives in step 2." line, so the router has a destination and `apps/web` keeps building. Route `/projects/:id` replaces `/projects/:id/board` everywhere.

- [ ] **Step 1: Write the failing test for the placeholder page**

Create `apps/web/src/pages/ProjectPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectPage } from "./ProjectPage";

afterEach(() => vi.restoreAllMocks());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("ProjectPage", () => {
  it("shows the project name it fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { id: "p1", name: "Apollo", archivedAt: null, role: "owner" }));
    render(<ProjectPage projectId="p1" />);
    expect(await screen.findByRole("heading", { name: "Apollo" })).toBeInTheDocument();
  });

  it("reports a project it may not read", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(404, { error: "not_found" }));
    render(<ProjectPage projectId="p1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/gone, or was never yours/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm exec vitest run src/pages/ProjectPage.test.tsx`
Expected: FAIL — "Failed to resolve import ./ProjectPage".

- [ ] **Step 3: Write the placeholder page**

Create `apps/web/src/pages/ProjectPage.tsx`:

```tsx
import { useResource } from "../lib/use-resource";
import { errorMessage } from "../lib/api";

interface ProjectDetail {
  id: string;
  name: string;
  archivedAt: number | null;
  role: "owner" | "member" | "viewer";
}

export function ProjectPage({ projectId }: { projectId: string }) {
  const project = useResource<ProjectDetail>(`/api/projects/${projectId}`);
  if (project.error) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>{errorMessage(project.error)}</p>
      </main>
    );
  }
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-xl">{project.data?.name ?? "…"}</h1>
      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>The project view arrives in step 2.</p>
    </main>
  );
}
```

If `useResource` does not expose an `error` field, read `apps/web/src/lib/use-resource.ts` and use whatever it does expose (the phase-1 hook returns `{ data, loading, error }`); do not change the hook.

- [ ] **Step 4: Run the test again**

Run: `cd apps/web && pnpm exec vitest run src/pages/ProjectPage.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Delete the board UI**

```bash
git rm apps/web/src/pages/BoardPage.tsx apps/web/src/pages/BoardPage.test.tsx
```

```bash
git rm apps/web/src/components/BoardColumn.tsx apps/web/src/components/BoardColumn.test.tsx apps/web/src/components/StoryCard.tsx apps/web/src/components/StoryCard.test.tsx
```

```bash
git rm apps/web/src/components/PointButtons.tsx apps/web/src/components/QuickAddCard.tsx apps/web/src/lib/board-ordering.ts apps/web/src/lib/board-ordering.test.ts
```

- [ ] **Step 6: Repoint the router at the placeholder**

In `apps/web/src/app-routes.tsx`: replace the `BoardPage` import with `import { ProjectPage } from "./pages/ProjectPage";`, replace the board route line with

```tsx
<Route path="/projects/:id">{(params) => <ProjectPage projectId={params.id!} />}</Route>
```

and change the invite redirect from `navigate(\`/projects/${id}/board\`)` to `navigate(\`/projects/${id}\`)`.

In `apps/web/src/pages/ProjectsPage.tsx`: change the row link to `href={\`/projects/${project.id}\`}`.

In `apps/web/src/components/Header.tsx`: change `useRoute("/projects/:id/board")` to `useRoute("/projects/:id")`.

- [ ] **Step 7: Prune the dead error copy and the drag dependency**

In `apps/web/src/lib/api.ts`, delete these `MESSAGES` entries (their codes no longer exist): `state_category_immutable`, `state_last_of_category`, `state_in_use`, `state_id_invalid`, `state_id_required`, `state_id_unsupported`, `assignee_not_member`, `category_invalid`, `point_scale_invalid`, `action_label_invalid`, `action_label_too_long`, `custom_points_required`, `custom_points_invalid`, `custom_points_must_be_null`. Keep `estimate_required` and `points_off_scale` — Tracker has both (`api.test.ts` asserts `estimate_required`).

In `apps/web/package.json`, delete the three `@dnd-kit/*` dependencies. Drag returns in step 2 and its library is a step-2 decision.

Run: `pnpm install`
Expected: lockfile updated, no errors.

- [ ] **Step 8: Run the web suite, lint and build**

Run: `pnpm --filter @storylane/web test`
Expected: PASS, 0 fail.

Run: `pnpm --filter @storylane/web lint`
Expected: no errors.

Run: `pnpm --filter @storylane/web build`
Expected: `tsc -b` clean, `vite build` writes `apps/web/dist`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src apps/web/package.json pnpm-lock.yaml
```

```bash
git commit -m "$(cat <<'MSG'
refactor(web): strip the phase-1 board, keep the auth shell

Login, setup, invite and reset are foundation and stay. The board UI is
replaced wholesale by the Tracker project view in step 2, so it leaves
behind only a placeholder route that keeps the build and the shell tests
honest.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 4 — ADVISOR-GATED: rewrite the permission matrix to Tracker's roles

> **Gate:** send this whole task (the table below plus the notes) to `/advisor` before executing it, and run the `authz-reviewer` agent after it. It changes `spec/permissions.md` and `apps/server/src/authz/`.

**Files:**
- Modify: `spec/fixtures/permissions.json`, `spec/permissions.md`, `apps/server/test/permissions.test.ts`
- Test: `packages/core/src/permissions.test.ts` (unchanged, but it is the gate that fails if the two files diverge)

**Interfaces:**
- Consumes: Task 1's trimmed `ROUTE_ACTIONS`.
- Produces: `Action` (the union `keyof typeof fixture.actions`) becomes exactly the 32 names in the table below. Tasks 6–20 add `ROUTE_ACTIONS` entries drawn from this list and add nothing to the fixture.

**The matrix.** Derived from `core-model.md` §8.2: "Members may do anything with stories, comments and attachments but may not edit project settings, manage members, or configure integrations; owners may. Viewers are read-only, can follow stories and receive notifications." Two rows are decisions rather than transcription and are called out under the table.

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

Changes from the doc-8 matrix that are not simple renames:

- `story:delete`, `label:delete`, `epic:delete` and `comment:delete` move from owner-only to member: Tracker's rule is that members may do anything with stories. The author/owner restriction on comment deletion is not expressible in a role matrix and is enforced in the service (Task 13), recorded in `notes`.
- `follower:write` is the one write a **viewer** may perform (`article:project_member_roles`: viewers can follow stories and receive notifications), and it is a viewer's own follow only — following someone else is a member action, enforced in the service (Task 10).
- `review-type:write` is owner-only: review types are project settings (`article:reviews`), unlike the per-story `review:write`.
- `iteration:override` is **member** (assumption): Tracker exposes iteration length and team strength from the iteration header in the Current panel, which members use, not from the owner-only Settings page. Recorded in `notes`.
- Removed entirely: `state:read`, `state:write`, `state:delete` (no `project_states`), `calendar-exception:write` and `iteration:update-goal` (doc-8 inventions), `iteration:rollover` (rollover does not exist — iterations are derived), `export:read` (step 10).

- [ ] **Step 1: Rewrite the fixture**

Replace the `actions` object in `spec/fixtures/permissions.json` with exactly the rows above, in that order, keeping the existing formatting style (one line per action, roles in the order `anonymous, non-member, viewer, member, owner`). Leave `roles` and `adminActions` unchanged. Replace `notes` with:

```json
  "notes": {
    "last-owner": "The sole owner of a project can never be demoted, removed, or leave. member:change-role / member:remove / member:leave return 409 last_owner in that case.",
    "archived": "When projects.archived_at is set, :read actions are unaffected and every other action returns 409 project_archived for every role, except project:archive (un-archive) and project:delete, which stay owner-only. Precedence is 404 then 409 then 403.",
    "member-scope": "Tracker's rule: a member may do anything with stories, tasks, comments, attachments, labels, epics, blockers and reviews; only an owner edits project settings, review types and membership.",
    "comment-own": "comment:update-own additionally requires the actor to be the comment's author. comment:delete is allowed to the author or to any project owner; another member deleting someone else's comment gets 403 from the service.",
    "follower-self": "follower:write is 200 for a viewer only for the viewer's own follow row. Adding or removing somebody else's follow is refused to a viewer by the service.",
    "iteration-override": "iteration:override is member-level by assumption: Tracker sets iteration length and team strength from the iteration header, not from the owner-only settings page. See docs/plans/2026-09-16-tracker-step-1-core-model.md Assumptions.",
    "member-leave": "member:leave is the actor removing their own membership; owners must transfer ownership first.",
    "admin-plane": "adminActions require users.is_admin; they are instance-wide and never depend on project membership. Non-admin -> 403, anonymous -> 401.",
    "codes": "200 stands for allowed (the route may answer 201/204). 401 unauthenticated, 403 member-level denial, 404 non-member or row outside the project."
  }
```

- [ ] **Step 2: Rewrite the markdown table to match byte for byte**

In `spec/permissions.md`, replace the matrix table with the same 32 rows in the same order (the parser in `packages/core/src/permissions.test.ts` reads the first table whose header starts with `| action |`). Update the prose under it: delete the paragraphs about state columns, rollover and calendar exceptions; add one sentence pointing at `docs/reference/tracker-notes/core-model.md` §8 as the source of the role definitions.

- [ ] **Step 3: Update the read/write pin**

In `apps/server/test/permissions.test.ts`, replace `READ_ACTIONS` with:

```ts
const READ_ACTIONS: readonly Action[] = [
  "project:read",
  "member:read",
  "invite:read",
  "story:read",
  "iteration:read",
  "activity:read",
  "search:read",
];
```

- [ ] **Step 4: Run the two guards**

Run: `pnpm --filter @storylane/core test`
Expected: PASS — "has identical matrices" is the one that fails if the markdown and the JSON drifted.

Run: `cd apps/server && bun test test/permissions.test.ts test/route-matrix.test.ts`
Expected: PASS. A failure naming an unknown action means a `ROUTE_ACTIONS` entry survived Task 1.

- [ ] **Step 5: Full suite**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add spec/permissions.md spec/fixtures/permissions.json apps/server/test/permissions.test.ts
```

```bash
git commit -m "$(cat <<'MSG'
feat(authz): Tracker's Owner/Member/Viewer permission matrix

Members may do anything with stories and their parts; owners alone edit
settings, review types and membership; viewers are read-only except their
own follow. The mechanism (fixture -> Action union -> route matrix test) is
unchanged.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 5 — ADVISOR-GATED: the core schema, squashed into a fresh `0000`

> **Gate:** this task is the step-1 schema proposal the design (§3.2 last paragraph) and CLAUDE.md's new-table rule require to go through `/advisor` as one unit. Send Steps 1–9 (every table, CHECK, trigger and index below) before executing. Nothing in Tasks 6–22 may add a table without its own gate.

**Files:**
- Create: `apps/server/src/db/schema/stories.ts`, `labels.ts`, `attachments.ts`, `workflow.ts`, `iterations.ts`
- Modify: `apps/server/src/db/schema/projects.ts`, `activity.ts`, `index.ts`
- Delete and regenerate: `apps/server/src/db/migrations/**` → a single `0000_<name>.sql` + `meta/_journal.json` + `meta/0000_snapshot.json`
- Test: `apps/server/test/schema-constraints.test.ts` (rewritten), `apps/server/test/migrate.test.ts` (one new case), `apps/server/test/harness.ts` (new seed helpers)

**Interfaces:**
- Consumes: Task 1's schema barrel, Task 4's action union.
- Produces, exported from `apps/server/src/db/schema` and consumed by every later task:
  ```ts
  export const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;
  export type StoryType = (typeof STORY_TYPES)[number];
  export const STORY_STATES = ["unscheduled","unstarted","planned","started","finished","delivered","accepted","rejected"] as const;
  export type StoryState = (typeof STORY_STATES)[number];
  export const STORY_PRIORITIES = ["none", "p0", "p1", "p2", "p3"] as const;
  export type StoryPriority = (typeof STORY_PRIORITIES)[number];
  export const STORY_LISTS = ["backlog", "icebox"] as const;   // "backlog" is Current + Backlog
  export type StoryList = (typeof STORY_LISTS)[number];
  export const REVIEW_STATUSES = ["unstarted", "in_review", "pass", "revise"] as const;
  export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
  export const DEFAULT_POINT_SCALE = "0,1,2,3,5,8";
  export const BUILT_IN_POINT_SCALES = ["0,1,2,3", "0,1,2,4,8", "0,1,2,3,5,8"] as const;
  ```
  plus the tables `projects`, `projectMembers`, `stories`, `storyOwners`, `storyFollowers`, `labels`, `storyLabels`, `epics`, `tasks`, `comments`, `fileAttachments`, `blockers`, `reviewTypes`, `reviews`, `iterationOverrides`, `activities`, `activityResources`.
- New harness helpers (Step 10): `seedStory(db, projectId, input?): string`, `seedLabel(db, projectId, name): string`.

**Shape rules this schema follows** (`ARCHITECTURE.md` invariants):
every project-scoped table carries `project_id` and a `UNIQUE (id, project_id)` so a child can only reference a parent in the same project through a composite foreign key; instants are UTC ms integers; `iteration_overrides` is the one table whose identity is not `(id, project_id)` — its key is `(project_id, number)`, because in Tracker the iteration number *is* the identity and there is no row to give an id to.

- [ ] **Step 1: Rewrite `projects.ts`**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, primaryKey, index, check, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./auth";

/** Tracker's three built-in scales; anything else makes point_scale_is_custom true on read. */
export const BUILT_IN_POINT_SCALES = ["0,1,2,3", "0,1,2,4,8", "0,1,2,3,5,8"] as const;
export const DEFAULT_POINT_SCALE = "0,1,2,3,5,8";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** Comma-separated ascending point values, exactly as Tracker stores it (core-model §2.2). */
    pointScale: text("point_scale").notNull().default(DEFAULT_POINT_SCALE),
    bugsAndChoresAreEstimatable: integer("bugs_and_chores_are_estimatable", { mode: "boolean" }).notNull().default(false),
    /** Weeks. 1-4 per the articles; the API bounds neither (core-model §9.6). */
    iterationLength: integer("iteration_length").notNull().default(1),
    /** ISO weekday, 1 = Monday. Tracker names the day; the name is a serialization concern. */
    weekStartDay: integer("week_start_day").notNull().default(1),
    /** YYYY-MM-DD wall date; its weekday must equal week_start_day (guard trigger). */
    startDate: text("start_date").notNull(),
    /** IANA zone. Iteration boundaries are midnight in this zone. */
    timeZone: text("time_zone").notNull().default("UTC"),
    velocityAveragedOver: integer("velocity_averaged_over").notNull().default(3),
    initialVelocity: integer("initial_velocity").notNull().default(10),
    numberOfDoneIterationsToShow: integer("number_of_done_iterations_to_show").notNull().default(4),
    automaticPlanning: integer("automatic_planning", { mode: "boolean" }).notNull().default(true),
    enableTasks: integer("enable_tasks", { mode: "boolean" }).notNull().default(true),
    showStoryPriority: integer("show_story_priority", { mode: "boolean" }).notNull().default(false),
    /** Bumped by every recordActivity; the activity row carries the value it produced. */
    version: integer("version").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    check("projects_iteration_length", sql`${t.iterationLength} between 1 and 4`),
    check("projects_week_start_day", sql`${t.weekStartDay} between 1 and 7`),
    check("projects_velocity_averaged_over", sql`${t.velocityAveragedOver} between 1 and 4`),
    check("projects_initial_velocity", sql`${t.initialVelocity} >= 0`),
    check("projects_done_iterations_shown", sql`${t.numberOfDoneIterationsToShow} between 1 and 99`),
    check("projects_version", sql`${t.version} >= 0`),
    check("projects_point_scale_shape", sql`${t.pointScale} glob '[0-9]*' and ${t.pointScale} not glob '*[^0-9.,]*'`),
  ],
);

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["owner", "member", "viewer"] }).notNull(),
    /** Per-member project colour and favourite flag; their UI is step 8 (dashboard). */
    projectColor: text("project_color"),
    favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
    lastViewedAt: integer("last_viewed_at"),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user").on(t.userId),
    uniqueIndex("project_members_project_user").on(t.projectId, t.userId),
    check("project_members_role", sql`${t.role} in ('owner','member','viewer')`),
  ],
);
```

`project_members` gains an explicit `UNIQUE (project_id, user_id)` on top of its primary key because SQLite will not accept a composite foreign key that references a primary key it cannot see as a unique index in that column order — `story_owners` and `reviews` both reference it.

- [ ] **Step 2: Create `stories.ts`**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, check, uniqueIndex, foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projectMembers, projects } from "./projects";

export const STORY_TYPES = ["feature", "bug", "chore", "release"] as const;
export type StoryType = (typeof STORY_TYPES)[number];

/** Tracker's eight API values (core-model §1.2). `planned` needs manual planning. */
export const STORY_STATES = [
  "unscheduled", "unstarted", "planned", "started", "finished", "delivered", "accepted", "rejected",
] as const;
export type StoryState = (typeof STORY_STATES)[number];

export const STORY_PRIORITIES = ["none", "p0", "p1", "p2", "p3"] as const;
export type StoryPriority = (typeof STORY_PRIORITIES)[number];

/** Two ordered lists per project: "backlog" is Current + Backlog, cut by planning on read. */
export const STORY_LISTS = ["backlog", "icebox"] as const;
export type StoryList = (typeof STORY_LISTS)[number];

export const stories = sqliteTable(
  "stories",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    storyType: text("story_type", { enum: STORY_TYPES }).notNull().default("feature"),
    currentState: text("current_state", { enum: STORY_STATES }).notNull().default("unscheduled"),
    /** Float because Tracker types it so; null = unestimated (the -1 sentinel is search-only). */
    estimate: real("estimate"),
    acceptedAt: integer("accepted_at"),
    /** Release stories only (guard trigger). */
    deadline: integer("deadline"),
    storyPriority: text("story_priority", { enum: STORY_PRIORITIES }).notNull().default("none"),
    list: text("list", { enum: STORY_LISTS }).notNull().default("icebox"),
    /** Sparse: moves renumber only around the target (services/ordering.ts). */
    position: integer("position").notNull(),
    requestedById: text("requested_by_id").references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("stories_id_project").on(t.id, t.projectId),
    uniqueIndex("stories_project_number").on(t.projectId, t.number),
    uniqueIndex("stories_project_list_position").on(t.projectId, t.list, t.position),
    index("stories_project_state").on(t.projectId, t.currentState),
    index("stories_project_accepted").on(t.projectId, t.acceptedAt),
    check("stories_story_type", sql`${t.storyType} in ('feature','bug','chore','release')`),
    check(
      "stories_current_state",
      sql`${t.currentState} in ('unscheduled','unstarted','planned','started','finished','delivered','accepted','rejected')`,
    ),
    check("stories_story_priority", sql`${t.storyPriority} in ('none','p0','p1','p2','p3')`),
    check("stories_list", sql`${t.list} in ('backlog','icebox')`),
    check("stories_estimate_non_negative", sql`${t.estimate} is null or ${t.estimate} >= 0`),
    check("stories_position_non_negative", sql`${t.position} >= 0`),
  ],
);

export const storyOwners = sqliteTable(
  "story_owners",
  {
    projectId: text("project_id").notNull(),
    storyId: text("story_id").notNull(),
    userId: text("user_id").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.storyId, t.userId] }),
    index("story_owners_user").on(t.projectId, t.userId),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "story_owners_story_fk",
    }).onDelete("cascade"),
    // An owner must be a member of the story's own project; removal is handled by a trigger,
    // not ON DELETE SET NULL, because SQLite nulls every column of a composite child key.
    foreignKey({
      columns: [t.projectId, t.userId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
      name: "story_owners_member_fk",
    }),
  ],
);

export const storyFollowers = sqliteTable(
  "story_followers",
  {
    projectId: text("project_id").notNull(),
    storyId: text("story_id").notNull(),
    userId: text("user_id").notNull(),
    followedAt: integer("followed_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.storyId, t.userId] }),
    index("story_followers_user").on(t.projectId, t.userId),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "story_followers_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.projectId, t.userId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
      name: "story_followers_member_fk",
    }),
  ],
);
```

- [ ] **Step 3: Create `labels.ts`**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { projects } from "./projects";
import { stories } from "./stories";

export const labels = sqliteTable(
  "labels",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("labels_id_project").on(t.id, t.projectId),
    uniqueIndex("labels_project_name").on(t.projectId, sql`${t.name} COLLATE NOCASE`),
  ],
);

export const storyLabels = sqliteTable(
  "story_labels",
  {
    projectId: text("project_id").notNull(),
    storyId: text("story_id").notNull(),
    labelId: text("label_id").notNull(),
    addedAt: integer("added_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.storyId, t.labelId] }),
    index("story_labels_label").on(t.projectId, t.labelId),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "story_labels_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.labelId, t.projectId],
      foreignColumns: [labels.id, labels.projectId],
      name: "story_labels_label_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * An epic *has* a label (core-model §4.2): a story is in the epic exactly when it carries that
 * label, so there is no epic_id on stories. One label backs at most one epic.
 */
export const epics = sqliteTable(
  "epics",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    labelId: text("label_id").notNull(),
    /** Dense 0..n-1 via reorder(); epics are a short list. */
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("epics_id_project").on(t.id, t.projectId),
    uniqueIndex("epics_project_label").on(t.projectId, t.labelId),
    uniqueIndex("epics_project_position").on(t.projectId, t.position),
    check("epics_position_non_negative", sql`${t.position} >= 0`),
    foreignKey({
      columns: [t.labelId, t.projectId],
      foreignColumns: [labels.id, labels.projectId],
      name: "epics_label_fk",
    }).onDelete("restrict"),
  ],
);
```

- [ ] **Step 4: Create `attachments.ts` (tasks, comments, file attachments)**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projects } from "./projects";
import { stories } from "./stories";
import { epics } from "./labels";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id").notNull(),
    description: text("description").notNull(),
    complete: integer("complete", { mode: "boolean" }).notNull().default(false),
    /** Dense 0..n-1 within one story; Tracker serializes it 1-based. */
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("tasks_id_project").on(t.id, t.projectId),
    uniqueIndex("tasks_story_position").on(t.projectId, t.storyId, t.position),
    check("tasks_position_non_negative", sql`${t.position} >= 0`),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "tasks_story_fk",
    }).onDelete("cascade"),
  ],
);

/** A comment hangs off exactly one of a story or an epic (core-model §7). */
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id"),
    epicId: text("epic_id"),
    text: text("text").notNull(),
    personId: text("person_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("comments_id_project").on(t.id, t.projectId),
    index("comments_story").on(t.projectId, t.storyId, t.createdAt),
    index("comments_epic").on(t.projectId, t.epicId, t.createdAt),
    check("comments_one_parent", sql`(${t.storyId} is null) <> (${t.epicId} is null)`),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "comments_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.epicId, t.projectId],
      foreignColumns: [epics.id, epics.projectId],
      name: "comments_epic_fk",
    }).onDelete("cascade"),
  ],
);

/**
 * Metadata only. The bytes live at $STORYLANE_DATA_DIR/attachments/<storage_path>; the column
 * holds a path relative to that directory so the data dir can move.
 */
export const fileAttachments = sqliteTable(
  "file_attachments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    commentId: text("comment_id").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storagePath: text("storage_path").notNull(),
    uploaderId: text("uploader_id")
      .notNull()
      .references(() => users.id),
    width: integer("width"),
    height: integer("height"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("file_attachments_id_project").on(t.id, t.projectId),
    uniqueIndex("file_attachments_storage_path").on(t.storagePath),
    index("file_attachments_comment").on(t.projectId, t.commentId),
    check("file_attachments_size", sql`${t.size} >= 0`),
    foreignKey({
      columns: [t.commentId, t.projectId],
      foreignColumns: [comments.id, comments.projectId],
      name: "file_attachments_comment_fk",
    }).onDelete("cascade"),
  ],
);
```

- [ ] **Step 5: Create `workflow.ts` (blockers, review types, reviews)**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { users } from "./auth";
import { projectMembers, projects } from "./projects";
import { stories } from "./stories";

/**
 * Free text that may name another story. blocking_story_id is that reference resolved at write
 * time, so accepting or deleting the referenced story can resolve the blocker (core-model §1.6)
 * without re-parsing prose.
 */
export const blockers = sqliteTable(
  "blockers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id").notNull(),
    blockingStoryId: text("blocking_story_id"),
    description: text("description").notNull(),
    resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
    personId: text("person_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("blockers_id_project").on(t.id, t.projectId),
    index("blockers_story").on(t.projectId, t.storyId),
    index("blockers_blocking").on(t.projectId, t.blockingStoryId),
    check("blockers_not_self", sql`${t.blockingStoryId} is null or ${t.blockingStoryId} <> ${t.storyId}`),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "blockers_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.blockingStoryId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "blockers_blocking_story_fk",
    }).onDelete("set null"),
  ],
);

export const reviewTypes = sqliteTable(
  "review_types",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Tracker never deletes a review type; hiding removes it from the menu (core-model §1.7). */
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    position: integer("position").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("review_types_id_project").on(t.id, t.projectId),
    uniqueIndex("review_types_project_name").on(t.projectId, sql`${t.name} COLLATE NOCASE`),
    uniqueIndex("review_types_project_position").on(t.projectId, t.position),
    check("review_types_position_non_negative", sql`${t.position} >= 0`),
  ],
);

export const REVIEW_STATUSES = ["unstarted", "in_review", "pass", "revise"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storyId: text("story_id").notNull(),
    reviewTypeId: text("review_type_id").notNull(),
    reviewerId: text("reviewer_id"),
    status: text("status", { enum: REVIEW_STATUSES }).notNull().default("unstarted"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("reviews_id_project").on(t.id, t.projectId),
    uniqueIndex("reviews_story_type_reviewer").on(t.projectId, t.storyId, t.reviewTypeId, t.reviewerId),
    index("reviews_reviewer").on(t.projectId, t.reviewerId),
    check("reviews_status", sql`${t.status} in ('unstarted','in_review','pass','revise')`),
    foreignKey({
      columns: [t.storyId, t.projectId],
      foreignColumns: [stories.id, stories.projectId],
      name: "reviews_story_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.reviewTypeId, t.projectId],
      foreignColumns: [reviewTypes.id, reviewTypes.projectId],
      name: "reviews_type_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.projectId, t.reviewerId],
      foreignColumns: [projectMembers.projectId, projectMembers.userId],
      name: "reviews_reviewer_member_fk",
    }),
  ],
);
```

- [ ] **Step 6: Create `iterations.ts`**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, check, primaryKey } from "drizzle-orm/sqlite-core";
import { projects } from "./projects";

/**
 * The only stored iteration data. Windows, numbers, points and velocity are computed on read
 * from the project calendar (design §3.2), so there is no iteration row to override — the key
 * is (project_id, number), not (id, project_id).
 *
 * length null = "default" (Tracker's own pre-override sentinel in the activity payload).
 */
export const iterationOverrides = sqliteTable(
  "iteration_overrides",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    length: integer("length"),
    teamStrength: real("team_strength").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.number] }),
    check("iteration_overrides_number", sql`${t.number} >= 1`),
    check("iteration_overrides_length", sql`${t.length} is null or ${t.length} between 1 and 99`),
    check("iteration_overrides_team_strength", sql`${t.teamStrength} >= 0 and ${t.teamStrength} <= 10`),
  ],
);
```

- [ ] **Step 7: Rewrite `activity.ts` to Tracker's shape**

```ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, check, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { projects } from "./projects";
import { users } from "./auth";

/**
 * One row per user action (core-model §5). `changes` is a JSON array of
 * { kind, id, change_type, original_values, new_values }; `primary_resources` and
 * `secondary_resources` are JSON arrays. None of them is ever used in a WHERE — activity_resources
 * is the queryable projection.
 */
export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** The projects.version this action produced; guid is "<project_id>_<project_version>". */
    projectVersion: integer("project_version").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    highlight: text("highlight").notNull(),
    changes: text("changes").notNull(),
    primaryResources: text("primary_resources").notNull(),
    secondaryResources: text("secondary_resources"),
    performedById: text("performed_by_id").references(() => users.id),
    occurredAt: integer("occurred_at").notNull(),
  },
  (t) => [
    uniqueIndex("activities_id_project").on(t.id, t.projectId),
    // The resync primitive: GET /activity?since_version=N is a range scan on this.
    uniqueIndex("activities_project_version").on(t.projectId, t.projectVersion),
    index("activities_project_occurred").on(t.projectId, t.occurredAt),
    check("activities_kind_suffix", sql`${t.kind} like '%\_activity' escape '\'`),
  ],
);

export const ACTIVITY_RESOURCE_ROLES = ["primary", "secondary"] as const;

/** Queryable projection of primary/secondary resources: per-story and per-epic activity views. */
export const activityResources = sqliteTable(
  "activity_resources",
  {
    activityId: text("activity_id").notNull(),
    projectId: text("project_id").notNull(),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    role: text("role", { enum: ACTIVITY_RESOURCE_ROLES }).notNull(),
  },
  (t) => [
    uniqueIndex("activity_resources_unique").on(t.activityId, t.resourceKind, t.resourceId, t.role),
    index("activity_resources_lookup").on(t.projectId, t.resourceKind, t.resourceId),
    check("activity_resources_role", sql`${t.role} in ('primary','secondary')`),
    foreignKey({
      columns: [t.activityId, t.projectId],
      foreignColumns: [activities.id, activities.projectId],
      name: "activity_resources_activity_fk",
    }).onDelete("cascade"),
  ],
);
```

- [ ] **Step 8: Update the barrel**

`apps/server/src/db/schema/index.ts`:

```ts
export * from "./meta";
export * from "./auth";
export * from "./projects";
export * from "./stories";
export * from "./labels";
export * from "./attachments";
export * from "./workflow";
export * from "./iterations";
export * from "./activity";
export * from "./sessions";
```

- [ ] **Step 9: Squash the migrations into a fresh `0000`**

Nothing in `0000`–`0004` has shipped (design §4: no push, no tag, no public image), so history is rewritten once, here, and is shipped from this commit onward.

```bash
git rm -r apps/server/src/db/migrations
```

```bash
mkdir -p apps/server/src/db/migrations
```

```bash
pnpm --filter @storylane/server db:generate
```
Expected: drizzle-kit prints the tables it created and writes exactly one `apps/server/src/db/migrations/0000_<adjective>_<noun>.sql`, a `meta/_journal.json` with one entry and `meta/0000_snapshot.json`.

Run: `ls apps/server/src/db/migrations`
Expected: one `.sql` file plus `meta/`. If more than one `.sql` appears, the old folder was not fully removed — delete and regenerate.

Then **append** the guard triggers to the end of that generated file, each separated by a line containing exactly `--> statement-breakpoint` (Drizzle Kit does not emit triggers). Do not edit the generated statements above them.

```sql
CREATE TRIGGER projects_start_date_matches_week_start_insert
BEFORE INSERT ON projects
WHEN ((CAST(strftime('%w', new.start_date) AS INTEGER) + 6) % 7) + 1 <> new.week_start_day
BEGIN
  SELECT RAISE(ABORT, 'projects.start_date must fall on week_start_day');
END;
--> statement-breakpoint
CREATE TRIGGER projects_start_date_matches_week_start_update
BEFORE UPDATE OF start_date, week_start_day ON projects
WHEN ((CAST(strftime('%w', new.start_date) AS INTEGER) + 6) % 7) + 1 <> new.week_start_day
BEGIN
  SELECT RAISE(ABORT, 'projects.start_date must fall on week_start_day');
END;
--> statement-breakpoint
CREATE TRIGGER stories_number_pinned
BEFORE UPDATE OF number ON stories
WHEN new.number <> old.number
BEGIN
  SELECT RAISE(ABORT, 'stories.number is pinned after insert');
END;
--> statement-breakpoint
CREATE TRIGGER stories_icebox_is_unscheduled_insert
BEFORE INSERT ON stories
WHEN (new.list = 'icebox') <> (new.current_state = 'unscheduled')
BEGIN
  SELECT RAISE(ABORT, 'stories: unscheduled is exactly the icebox list');
END;
--> statement-breakpoint
CREATE TRIGGER stories_icebox_is_unscheduled_update
BEFORE UPDATE OF list, current_state ON stories
WHEN (new.list = 'icebox') <> (new.current_state = 'unscheduled')
BEGIN
  SELECT RAISE(ABORT, 'stories: unscheduled is exactly the icebox list');
END;
--> statement-breakpoint
CREATE TRIGGER stories_type_transitions_insert
BEFORE INSERT ON stories
WHEN (new.story_type = 'release' AND new.current_state = 'started')
  OR (new.story_type = 'chore' AND new.current_state = 'finished')
BEGIN
  SELECT RAISE(ABORT, 'stories: a release has no started state and a chore has no finished state');
END;
--> statement-breakpoint
CREATE TRIGGER stories_type_transitions_update
BEFORE UPDATE OF story_type, current_state ON stories
WHEN (new.story_type = 'release' AND new.current_state = 'started')
  OR (new.story_type = 'chore' AND new.current_state = 'finished')
BEGIN
  SELECT RAISE(ABORT, 'stories: a release has no started state and a chore has no finished state');
END;
--> statement-breakpoint
CREATE TRIGGER stories_estimate_gate_insert
BEFORE INSERT ON stories
WHEN new.estimate IS NULL
  AND new.current_state IN ('started','finished','delivered','accepted','rejected')
  AND (new.story_type = 'feature'
       OR (new.story_type IN ('bug','chore')
           AND (SELECT bugs_and_chores_are_estimatable FROM projects WHERE id = new.project_id) = 1))
BEGIN
  SELECT RAISE(ABORT, 'stories: an estimable story must be estimated before it starts');
END;
--> statement-breakpoint
CREATE TRIGGER stories_estimate_gate_update
BEFORE UPDATE OF estimate, current_state, story_type ON stories
WHEN new.estimate IS NULL
  AND new.current_state IN ('started','finished','delivered','accepted','rejected')
  AND (new.story_type = 'feature'
       OR (new.story_type IN ('bug','chore')
           AND (SELECT bugs_and_chores_are_estimatable FROM projects WHERE id = new.project_id) = 1))
BEGIN
  SELECT RAISE(ABORT, 'stories: an estimable story must be estimated before it starts');
END;
--> statement-breakpoint
CREATE TRIGGER stories_accepted_at_agrees_insert
BEFORE INSERT ON stories
WHEN (new.current_state = 'accepted') <> (new.accepted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'stories.accepted_at is set exactly while current_state is accepted');
END;
--> statement-breakpoint
CREATE TRIGGER stories_accepted_at_agrees_update
BEFORE UPDATE OF current_state, accepted_at ON stories
WHEN (new.current_state = 'accepted') <> (new.accepted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'stories.accepted_at is set exactly while current_state is accepted');
END;
--> statement-breakpoint
CREATE TRIGGER stories_planned_needs_manual_planning_insert
BEFORE INSERT ON stories
WHEN new.current_state = 'planned'
  AND (SELECT automatic_planning FROM projects WHERE id = new.project_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'stories: planned exists only under manual planning');
END;
--> statement-breakpoint
CREATE TRIGGER stories_planned_needs_manual_planning_update
BEFORE UPDATE OF current_state ON stories
WHEN new.current_state = 'planned'
  AND (SELECT automatic_planning FROM projects WHERE id = new.project_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'stories: planned exists only under manual planning');
END;
--> statement-breakpoint
CREATE TRIGGER stories_deadline_release_only_insert
BEFORE INSERT ON stories
WHEN new.deadline IS NOT NULL AND new.story_type <> 'release'
BEGIN
  SELECT RAISE(ABORT, 'stories.deadline belongs to release stories only');
END;
--> statement-breakpoint
CREATE TRIGGER stories_deadline_release_only_update
BEFORE UPDATE OF deadline, story_type ON stories
WHEN new.deadline IS NOT NULL AND new.story_type <> 'release'
BEGIN
  SELECT RAISE(ABORT, 'stories.deadline belongs to release stories only');
END;
--> statement-breakpoint
CREATE TRIGGER story_people_drop_on_member_removal
BEFORE DELETE ON project_members
BEGIN
  DELETE FROM story_owners WHERE project_id = old.project_id AND user_id = old.user_id;
  DELETE FROM story_followers WHERE project_id = old.project_id AND user_id = old.user_id;
  UPDATE reviews SET reviewer_id = NULL WHERE project_id = old.project_id AND reviewer_id = old.user_id;
END;
```

`stories_icebox_is_unscheduled_*` is what makes the `list` column honest: `unscheduled` and the Icebox are the same fact in Tracker (core-model §1.2 rule 2), and a service that set one without the other would produce a story the Icebox panel and the Backlog panel both claim.

There is deliberately **no** trigger checking `estimate` against `projects.point_scale`: the scale is a comma-separated string, parsing it in SQL would duplicate `parsePointScale` in a second language, and the service already refuses an off-scale value with `400 points_off_scale` (Task 8).

- [ ] **Step 10: Add the harness seeds the later tasks need**

In `apps/server/test/harness.ts`, `seedProject` must now supply the new NOT NULL column; add `startDate` and give every seeded project a Monday start:

```ts
export function seedProject(db: Db, owner: Actor, others: Array<[Actor, "member" | "viewer"]> = []): string {
  if (owner.kind !== "user") throw new Error("owner must be a user");
  const id = crypto.randomUUID();
  db.insert(projects)
    .values({ id, name: "P", startDate: "2026-09-14", createdBy: owner.userId, createdAt: Date.now() })
    .run();
  db.insert(projectMembers).values({ projectId: id, userId: owner.userId, role: "owner", joinedAt: Date.now() }).run();
  for (const [a, role] of others) {
    if (a.kind !== "user") continue;
    db.insert(projectMembers).values({ projectId: id, userId: a.userId, role, joinedAt: Date.now() }).run();
  }
  return id;
}

/** Seeds one story with the next free number, at the end of its list. */
export function seedStory(
  db: Db,
  projectId: string,
  input: {
    name?: string;
    list?: StoryList;
    currentState?: StoryState;
    storyType?: StoryType;
    estimate?: number | null;
    position?: number;
  } = {},
): string {
  const id = newId();
  const list = input.list ?? "icebox";
  const next = db
    .select({ n: sql<number>`coalesce(max(${stories.number}), 0) + 1` })
    .from(stories)
    .where(eq(stories.projectId, projectId))
    .get();
  const tail = db
    .select({ p: sql<number>`coalesce(max(${stories.position}), -1024) + 1024` })
    .from(stories)
    .where(and(eq(stories.projectId, projectId), eq(stories.list, list)))
    .get();
  db.insert(stories)
    .values({
      id,
      projectId,
      number: next?.n ?? 1,
      name: input.name ?? "story",
      storyType: input.storyType ?? "feature",
      currentState: input.currentState ?? (list === "icebox" ? "unscheduled" : "unstarted"),
      estimate: input.estimate ?? null,
      list,
      position: input.position ?? tail?.p ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  return id;
}

export function seedLabel(db: Db, projectId: string, name: string): string {
  const id = newId();
  db.insert(labels).values({ id, projectId, name, createdAt: Date.now(), updatedAt: Date.now() }).run();
  return id;
}
```

Import `and`, `eq`, `sql` from `drizzle-orm` and `labels`, `stories`, `StoryList`, `StoryState`, `StoryType` from `../src/db/schema`.

- [ ] **Step 11: Write the failing constraint tests**

Rewrite `apps/server/test/schema-constraints.test.ts`, keeping its existing `beforeEach` shape (`makeTestDb`, `seedUser`, two seeded projects) and its `run()` helper:

```ts
describe("projects", () => {
  it("rejects a start date that is not the week start day", () => {
    expect(() =>
      run("update projects set start_date = '2026-09-15' where id = ?", [projectId]),
    ).toThrow(/start_date must fall on week_start_day/);
  });

  it("accepts a start date on the configured week start day", () => {
    expect(() =>
      run("update projects set start_date = '2026-09-13', week_start_day = 7 where id = ?", [projectId]),
    ).not.toThrow();
  });

  it("rejects an iteration length outside 1-4", () => {
    expect(() => run("update projects set iteration_length = 5 where id = ?", [projectId])).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("rejects a velocity strategy outside 1-4", () => {
    expect(() => run("update projects set velocity_averaged_over = 0 where id = ?", [projectId])).toThrow(
      /CHECK constraint failed/,
    );
  });
});

describe("stories", () => {
  it("rejects a second story with the same number in one project", () => {
    seedStory(db, projectId);
    expect(() =>
      run(
        "insert into stories (id, project_id, number, name, story_type, current_state, list, position, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?)",
        [newId(), projectId, 1, "dup", "feature", "unscheduled", "icebox", 99, Date.now(), Date.now()],
      ),
    ).toThrow(/UNIQUE/);
  });

  it("rejects two stories at the same position in one list", () => {
    seedStory(db, projectId, { position: 1024 });
    expect(() => seedStory(db, projectId, { position: 1024 })).toThrow(/UNIQUE/);
  });

  it("allows the same position in the other list", () => {
    seedStory(db, projectId, { list: "icebox", position: 1024 });
    expect(() => seedStory(db, projectId, { list: "backlog", position: 1024 })).not.toThrow();
  });

  it("rejects an unknown state", () => {
    expect(() => seedStory(db, projectId, { currentState: "done" as never })).toThrow(/CHECK constraint failed/);
  });

  it("refuses to renumber a story", () => {
    const id = seedStory(db, projectId);
    expect(() => run("update stories set number = 42 where id = ?", [id])).toThrow(/number is pinned/);
  });

  it("keeps unscheduled and the icebox in agreement", () => {
    const id = seedStory(db, projectId, { list: "icebox" });
    expect(() => run("update stories set list = 'backlog' where id = ?", [id])).toThrow(
      /unscheduled is exactly the icebox list/,
    );
  });

  it("refuses a started release and a finished chore", () => {
    const release = seedStory(db, projectId, { list: "backlog", storyType: "release", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'started' where id = ?", [release])).toThrow(
      /a release has no started state/,
    );
    const chore = seedStory(db, projectId, { list: "backlog", storyType: "chore", currentState: "started" });
    expect(() => run("update stories set current_state = 'finished' where id = ?", [chore])).toThrow(
      /a chore has no finished state/,
    );
  });

  it("refuses to start an unestimated feature but allows an unestimated chore", () => {
    const feature = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'started' where id = ?", [feature])).toThrow(
      /must be estimated before it starts/,
    );
    const chore = seedStory(db, projectId, { list: "backlog", storyType: "chore", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'started' where id = ?", [chore])).not.toThrow();
  });

  it("gates bugs and chores once the project enables their estimation", () => {
    run("update projects set bugs_and_chores_are_estimatable = 1 where id = ?", [projectId]);
    const bug = seedStory(db, projectId, { list: "backlog", storyType: "bug", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'started' where id = ?", [bug])).toThrow(
      /must be estimated before it starts/,
    );
  });

  it("ties accepted_at to the accepted state in both directions", () => {
    const id = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 1 });
    expect(() => run("update stories set current_state = 'accepted' where id = ?", [id])).toThrow(
      /accepted_at is set exactly while/,
    );
    expect(() =>
      run("update stories set current_state = 'accepted', accepted_at = ? where id = ?", [Date.now(), id]),
    ).not.toThrow();
  });

  it("refuses planned while automatic planning is on, and allows it once off", () => {
    const id = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    expect(() => run("update stories set current_state = 'planned' where id = ?", [id])).toThrow(
      /planned exists only under manual planning/,
    );
    run("update projects set automatic_planning = 0 where id = ?", [projectId]);
    expect(() => run("update stories set current_state = 'planned' where id = ?", [id])).not.toThrow();
  });

  it("refuses a deadline on a non-release story", () => {
    const id = seedStory(db, projectId);
    expect(() => run("update stories set deadline = ? where id = ?", [Date.now(), id])).toThrow(
      /deadline belongs to release stories only/,
    );
  });
});

describe("cross-project composite keys", () => {
  it("refuses to label a story with another project's label", () => {
    const storyId = seedStory(db, projectId);
    const foreignLabel = seedLabel(db, otherProjectId, "elsewhere");
    expect(() =>
      run("insert into story_labels (project_id, story_id, label_id, added_at) values (?,?,?,?)", [
        projectId, storyId, foreignLabel, Date.now(),
      ]),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("refuses an owner who is not a member of the story's project", () => {
    const storyId = seedStory(db, projectId);
    const outsider = seedUser(db, "outsider@example.test") as { userId: string };
    expect(() =>
      run("insert into story_owners (project_id, story_id, user_id, added_at) values (?,?,?,?)", [
        projectId, storyId, outsider.userId, Date.now(),
      ]),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("drops owners and follows when a membership is removed", () => {
    const member = seedUser(db, "member@example.test") as { userId: string };
    run("insert into project_members (project_id, user_id, role, favorite, joined_at) values (?,?,?,?,?)", [
      projectId, member.userId, "member", 0, Date.now(),
    ]);
    const storyId = seedStory(db, projectId);
    run("insert into story_owners (project_id, story_id, user_id, added_at) values (?,?,?,?)", [
      projectId, storyId, member.userId, Date.now(),
    ]);
    run("delete from project_members where project_id = ? and user_id = ?", [projectId, member.userId]);
    const left = db.$client.query("select count(*) as n from story_owners").get() as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("iteration_overrides", () => {
  it("rejects an override length outside 1-99", () => {
    expect(() =>
      run("insert into iteration_overrides (project_id, number, length, team_strength, created_at, updated_at) values (?,?,?,?,?,?)", [
        projectId, 3, 100, 1, Date.now(), Date.now(),
      ]),
    ).toThrow(/CHECK constraint failed/);
  });

  it("keeps one override row per (project, number)", () => {
    const row = [projectId, 3, 2, 1, Date.now(), Date.now()];
    run("insert into iteration_overrides (project_id, number, length, team_strength, created_at, updated_at) values (?,?,?,?,?,?)", row);
    expect(() =>
      run("insert into iteration_overrides (project_id, number, length, team_strength, created_at, updated_at) values (?,?,?,?,?,?)", row),
    ).toThrow(/UNIQUE/);
  });
});

describe("activities", () => {
  it("keeps project_version unique within a project", () => {
    const values = (id: string) => [id, projectId, 7, "story_create_activity", "m", "h", "[]", "[]", Date.now()];
    const insert =
      "insert into activities (id, project_id, project_version, kind, message, highlight, changes, primary_resources, occurred_at) values (?,?,?,?,?,?,?,?,?)";
    run(insert, values(newId()));
    expect(() => run(insert, values(newId()))).toThrow(/UNIQUE/);
  });

  it("refuses a kind that is not a Tracker activity name", () => {
    expect(() =>
      run(
        "insert into activities (id, project_id, project_version, kind, message, highlight, changes, primary_resources, occurred_at) values (?,?,?,?,?,?,?,?,?)",
        [newId(), projectId, 8, "story_create", "m", "h", "[]", "[]", Date.now()],
      ),
    ).toThrow(/CHECK constraint failed/);
  });
});
```

- [ ] **Step 12: Run the constraint tests**

Run: `cd apps/server && bun test test/schema-constraints.test.ts`
Expected: PASS. A `no such table` failure means Step 9's regeneration missed a module — check that `index.ts` exports it and regenerate.

- [ ] **Step 13: Prove a fresh database still boots and the setup flow works**

Add to `apps/server/test/migrate.test.ts`:

```ts
it("creates every step-1 table in one migration", () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const tables = (db.$client.query("select name from sqlite_master where type='table'").all() as { name: string }[])
    .map((t) => t.name);
  for (const name of [
    "users", "sessions", "invites", "reset_tokens", "instance_meta",
    "projects", "project_members", "stories", "story_owners", "story_followers",
    "labels", "story_labels", "epics", "tasks", "comments", "file_attachments",
    "blockers", "review_types", "reviews", "iteration_overrides", "activities", "activity_resources",
  ]) {
    expect(tables).toContain(name);
  }
  const journal = (db.$client.query("select count(*) as n from __drizzle_migrations").get() as { n: number }).n;
  expect(journal).toBe(1);
  db.$client.close();
});
```

If `reset_tokens` is not the actual table name in `schema/sessions.ts`, use the name that module declares — read it, do not guess.

Run: `cd apps/server && bun test test/migrate.test.ts test/setup.test.ts test/boot.test.ts`
Expected: PASS — the setup flow (first-run token → admin user) is untouched by the squash, which is exactly what this proves.

- [ ] **Step 14: Full suite, lint, typecheck**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

Run: `pnpm --filter @storylane/server lint`
Expected: no errors.

Run: `pnpm --filter @storylane/server typecheck`
Expected: no errors.

- [ ] **Step 15: Commit**

```bash
git add apps/server/src/db apps/server/test/schema-constraints.test.ts apps/server/test/migrate.test.ts apps/server/test/harness.ts
```

```bash
git commit -m "$(cat <<'MSG'
feat(db): Tracker's core schema, squashed into a single 0000

Stories with the eight-value state enum and two ordered lists, owners,
followers, labels, epics, tasks, comments, file attachments, blockers,
review types, reviews, iteration overrides, and Tracker-shaped activities
replace the board schema. Iterations are not stored: only their overrides
are. Guard triggers carry the rules a CHECK cannot see - the estimation
gate, the per-type transitions, unscheduled-is-the-icebox, accepted_at,
and planned-needs-manual-planning.

Nothing in 0000-0004 had shipped (design section 4), so the five files are
squashed into one; forward-only applies again from here.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 6: Tracker-shaped activity, the project version counter, and `GET /activity`

**Files:**
- Rewrite: `apps/server/src/services/activity.ts`
- Create: `apps/server/src/routes/activity.ts`, `apps/server/test/activity.test.ts` (rewritten in place)
- Modify: `apps/server/src/events/bus.ts`, `apps/server/src/events/emit.ts`, `apps/server/src/routes/events.ts`, `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`, `apps/server/src/services/projects.ts`, `apps/server/src/services/invites.ts`, `apps/server/test/events-bus.test.ts`, `apps/server/test/events-sse.test.ts`
- Test: `apps/server/test/activity.test.ts`

**Interfaces:**
- Consumes: Task 5's `activities` / `activityResources` / `projects.version`.
- Produces (every later service writes through this):
  ```ts
  export const ACTIVITY_KINDS = [
    "story_create_activity", "story_update_activity", "story_delete_activity", "story_move_activity",
    "epic_create_activity", "epic_update_activity", "epic_delete_activity", "epic_move_activity",
    "comment_create_activity", "comment_update_activity", "comment_delete_activity",
    "task_create_activity", "task_update_activity", "task_delete_activity",
    "label_create_activity", "label_update_activity", "label_delete_activity",
    "blocker_create_activity", "blocker_update_activity", "blocker_delete_activity",
    "review_create_activity", "review_update_activity", "review_delete_activity",
    "review_type_create_activity", "review_type_update_activity",
    "follower_create_activity", "follower_delete_activity",
    "iteration_update_activity", "project_update_activity",
    "project_membership_create_activity", "project_membership_update_activity", "project_membership_delete_activity",
  ] as const;
  export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
  export type ChangeType = "create" | "update" | "delete";
  export interface ActivityChange {
    kind: string;                              // "story" | "epic" | "comment" | "task" | "label" | "blocker" | "review" | "review_type" | "iteration_override" | "project" | "project_membership"
    id?: string;
    number?: number;                           // stories carry #n as well as the id
    change_type: ChangeType;
    original_values?: Record<string, unknown>; // snake_case field names, changed fields only
    new_values?: Record<string, unknown>;
  }
  export interface ActivityResourceRef { kind: string; id: string }
  export interface ActivityEntry {
    kind: ActivityKind;
    message: string;
    highlight: string;
    changes: ActivityChange[];
    primaryResources: ActivityResourceRef[];
    secondaryResources?: ActivityResourceRef[];
  }
  export interface RecordedActivity { id: string; projectVersion: number }
  export function recordActivity(scope: ActivityScope, entry: ActivityEntry): RecordedActivity;
  export function projectVersion(scope: ActivityScope): number;
  export function listActivity(tx: ProjectTx, opts: { sinceVersion?: number; limit?: number; offset?: number }): ActivityRow[];
  export function storyActivity(tx: ProjectTx, storyId: string, opts?: { limit?: number }): ActivityRow[];
  export interface ActivityRow {
    guid: string;            // `${projectId}_${projectVersion}`
    project_version: number;
    kind: ActivityKind;
    message: string;
    highlight: string;
    changes: ActivityChange[];
    primary_resources: ActivityResourceRef[];
    secondary_resources: ActivityResourceRef[];
    performed_by_id: string | null;
    occurred_at: number;
  }
  ```
  `BootstrapScope` and `bootstrapScope(tx, projectId, actor)` keep their current shape and role.
- Also produces: `ProjectChanged = { type: "project.changed"; projectId: string; version: number }` and `bus.publish(projectId, version)`.

- [ ] **Step 1: Write the failing test**

Rewrite `apps/server/test/activity.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestDb, seedProject, seedStory, seedUser } from "./harness";
import { withProject } from "../src/db/tx";
import { listActivity, projectVersion, recordActivity, storyActivity } from "../src/services/activity";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let projectId: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = seedProject(db, owner);
});

const entry = (name: string) => ({
  kind: "story_update_activity" as const,
  message: `Owner edited ${name}`,
  highlight: "edited",
  changes: [
    {
      kind: "story",
      id: "s1",
      number: 1,
      change_type: "update" as const,
      original_values: { name: "before" },
      new_values: { name },
    },
  ],
  primaryResources: [{ kind: "story", id: "s1" }],
});

describe("recordActivity", () => {
  it("bumps the project version once per row and stamps it on the row", () => {
    const [first, second] = withProject(db, owner, projectId, "story:write", (tx) => [
      recordActivity(tx, entry("one")),
      recordActivity(tx, entry("two")),
    ]);
    expect(first.projectVersion).toBe(1);
    expect(second.projectVersion).toBe(2);
    const version = withProject(db, owner, projectId, "activity:read", (tx) => projectVersion(tx));
    expect(version).toBe(2);
  });

  it("returns rows after a version and never the version itself", () => {
    withProject(db, owner, projectId, "story:write", (tx) => {
      recordActivity(tx, entry("one"));
      recordActivity(tx, entry("two"));
      recordActivity(tx, entry("three"));
    });
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, { sinceVersion: 1 }));
    expect(rows.map((r) => r.project_version)).toEqual([2, 3]);
    expect(rows[0]!.guid).toBe(`${projectId}_2`);
    expect(rows[0]!.changes[0]!.new_values).toEqual({ name: "two" });
  });

  it("indexes primary and secondary resources so a story's own activity is a lookup", () => {
    const storyId = seedStory(db, projectId);
    withProject(db, owner, projectId, "story:write", (tx) => {
      recordActivity(tx, { ...entry("one"), primaryResources: [{ kind: "story", id: storyId }] });
      recordActivity(tx, { ...entry("elsewhere"), primaryResources: [{ kind: "story", id: "other" }] });
    });
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => storyActivity(tx, storyId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message).toBe("Owner edited one");
  });

  it("refuses a kind outside the enum", () => {
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) =>
        recordActivity(tx, { ...entry("x"), kind: "story_exploded_activity" as never }),
      ),
    ).toThrow(/unknown activity kind/);
  });

  it("never snapshots a display name into the payload", () => {
    // The message is rendered at write time from the actor, but performed_by_id is what a
    // reader resolves — a renamed user must not leave stale names in old rows.
    const [recorded] = withProject(db, owner, projectId, "story:write", (tx) => [recordActivity(tx, entry("one"))]);
    expect(recorded.projectVersion).toBe(1);
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    expect(rows[0]!.performed_by_id).toBe((owner as { userId: string }).userId);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/server && bun test test/activity.test.ts`
Expected: FAIL — `listActivity`/`projectVersion`/`storyActivity` are not exported.

- [ ] **Step 3: Rewrite the service**

`apps/server/src/services/activity.ts` keeps `BootstrapScope`, `bootstrapScope` and `ActivityScope` exactly as they are today and replaces the rest:

```ts
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { activities, activityResources, projects } from "../db/schema";
import { newId } from "../id";
import { ProjectTx, type Actor, type Tx } from "../db/tx";

/* ACTIVITY_KINDS, types and interfaces exactly as listed in this task's Interfaces block */

const KNOWN = new Set<string>(ACTIVITY_KINDS);

/** Reads the counter the last recordActivity produced; the SSE event carries it. */
export function projectVersion(scope: ActivityScope): number {
  const row = scope.tx.select({ v: projects.version }).from(projects).where(eq(projects.id, scope.projectId)).get();
  return row?.v ?? 0;
}

/**
 * The only writer of `activities`. Runs inside the caller's transaction, never its own, and
 * bumps projects.version in the same statement pair so the row's project_version is the value
 * this action produced (core-model §5.3). The UNIQUE (project_id, project_version) index is what
 * makes that claim enforceable.
 */
export function recordActivity(scope: ActivityScope, entry: ActivityEntry): RecordedActivity {
  if (!KNOWN.has(entry.kind)) throw new Error(`unknown activity kind: ${entry.kind}`);
  scope.tx
    .update(projects)
    .set({ version: sql`${projects.version} + 1` })
    .where(eq(projects.id, scope.projectId))
    .run();
  const version = projectVersion(scope);
  const id = newId();
  scope.tx
    .insert(activities)
    .values({
      id,
      projectId: scope.projectId,
      projectVersion: version,
      kind: entry.kind,
      message: entry.message,
      highlight: entry.highlight,
      changes: JSON.stringify(entry.changes),
      primaryResources: JSON.stringify(entry.primaryResources),
      secondaryResources: entry.secondaryResources ? JSON.stringify(entry.secondaryResources) : null,
      performedById: scope.actor.kind === "user" ? scope.actor.userId : null,
      occurredAt: Date.now(),
    })
    .run();
  const rows = [
    ...entry.primaryResources.map((r) => ({ ...r, role: "primary" as const })),
    ...(entry.secondaryResources ?? []).map((r) => ({ ...r, role: "secondary" as const })),
  ];
  for (const r of rows) {
    scope.tx
      .insert(activityResources)
      .values({ activityId: id, projectId: scope.projectId, resourceKind: r.kind, resourceId: r.id, role: r.role })
      .onConflictDoNothing()
      .run();
  }
  return { id, projectVersion: version };
}

function toRow(projectId: string, row: typeof activities.$inferSelect): ActivityRow {
  return {
    guid: `${projectId}_${row.projectVersion}`,
    project_version: row.projectVersion,
    kind: row.kind as ActivityKind,
    message: row.message,
    highlight: row.highlight,
    changes: JSON.parse(row.changes) as ActivityChange[],
    primary_resources: JSON.parse(row.primaryResources) as ActivityResourceRef[],
    secondary_resources: row.secondaryResources ? (JSON.parse(row.secondaryResources) as ActivityResourceRef[]) : [],
    performed_by_id: row.performedById,
    occurred_at: row.occurredAt,
  };
}

/** Oldest first, so a client applying them in order reaches the same state the server is in. */
export function listActivity(tx: ProjectTx, opts: { sinceVersion?: number; limit?: number; offset?: number }): ActivityRow[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where =
    opts.sinceVersion === undefined
      ? eq(activities.projectId, tx.projectId)
      : and(eq(activities.projectId, tx.projectId), gt(activities.projectVersion, opts.sinceVersion));
  return tx.tx
    .select()
    .from(activities)
    .where(where)
    .orderBy(activities.projectVersion)
    .limit(limit)
    .offset(opts.offset ?? 0)
    .all()
    .map((r) => toRow(tx.projectId, r));
}

/** Newest first: the story panel shows the most recent action at the top. */
export function storyActivity(tx: ProjectTx, storyId: string, opts: { limit?: number } = {}): ActivityRow[] {
  return tx.tx
    .select({ a: activities })
    .from(activities)
    .innerJoin(
      activityResources,
      and(eq(activityResources.activityId, activities.id), eq(activityResources.projectId, activities.projectId)),
    )
    .where(
      and(
        eq(activities.projectId, tx.projectId),
        eq(activityResources.resourceKind, "story"),
        eq(activityResources.resourceId, storyId),
      ),
    )
    .orderBy(desc(activities.projectVersion))
    .limit(Math.min(Math.max(opts.limit ?? 100, 1), 500))
    .all()
    .map((r) => toRow(tx.projectId, r.a));
}
```

- [ ] **Step 4: Update the three existing writers**

`services/projects.ts` (`createProject`, `updateProject`, `setArchived`) and `services/invites.ts` currently pass `{ action, payload }`. Convert each call to the new shape, for example in `createProject`:

```ts
recordActivity(bootstrapScope(tx, id, actor), {
  kind: "project_update_activity",
  message: `created ${name}`,
  highlight: "created",
  changes: [{ kind: "project", id, change_type: "create", new_values: { name } }],
  primaryResources: [{ kind: "project", id }],
});
```
and in `mintInvite` / invite acceptance:

```ts
recordActivity(scope, {
  kind: "project_membership_create_activity",
  message: `added a ${role}`,
  highlight: "added",
  changes: [{ kind: "project_membership", id: userId, change_type: "create", new_values: { role } }],
  primaryResources: [{ kind: "project_membership", id: userId }],
});
```
Message strings are English product copy; never put a person's display name in them (the reader resolves `performed_by_id`).

- [ ] **Step 5: Carry the version on the SSE event**

`events/bus.ts`:

```ts
export interface ProjectChanged {
  type: "project.changed";
  projectId: string;
  /** projects.version after the change: a client may fetch activity?since_version= instead of refetching. */
  version: number;
}
...
  publish(projectId: string, version: number): void {
    const event: ProjectChanged = { type: "project.changed", projectId, version };
    ...
  }
```

`events/emit.ts` — read the version inside the authorized transaction, publish after it commits. `emit.ts` must not touch `.tx` (the lint rule), so it calls `projectVersion`:

```ts
import { projectVersion } from "../services/activity";
...
  let authorizedId!: string;
  let version = 0;
  const result = withProject(deps.db, actor, projectId, action, (tx) => {
    authorizedId = tx.projectId;
    const out = fn(tx);
    version = projectVersion(tx);
    return out;
  });
  deps.bus.publish(authorizedId, version);
  return result;
```

`routes/events.ts`: include `version` in the serialized event payload (the SSE `data` JSON). Update `test/events-bus.test.ts` and `test/events-sse.test.ts` for the new `publish` arity and payload.

- [ ] **Step 6: Add the activity route**

Create `apps/server/src/routes/activity.ts`:

```ts
import { Hono } from "hono";
import type { Context } from "hono";
import type { Db } from "../db/client";
import { withProject, type Actor } from "../db/tx";
import { HttpError } from "../http-error";
import { listActivity } from "../services/activity";

function optionalNonNegativeInt(raw: string | undefined, code: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new HttpError(400, code);
  return value;
}

export function activityRoutes(deps: { db: Db; actorOf: (c: Context) => Actor }) {
  const { db, actorOf } = deps;
  return new Hono().get("/api/projects/:id/activity", (c) => {
    const sinceVersion = optionalNonNegativeInt(c.req.query("since_version"), "since_version_invalid");
    const limit = optionalNonNegativeInt(c.req.query("limit"), "limit_invalid");
    const offset = optionalNonNegativeInt(c.req.query("offset"), "offset_invalid");
    return c.json(
      withProject(db, actorOf(c), c.req.param("id"), "activity:read", (tx) =>
        listActivity(tx, {
          ...(sinceVersion === undefined ? {} : { sinceVersion }),
          ...(limit === undefined ? {} : { limit }),
          ...(offset === undefined ? {} : { offset }),
        }),
      ),
    );
  });
}
```

Register it in `app.ts` (`app.route("/", activityRoutes({ db: deps.db, actorOf }));`) and add to `ROUTE_ACTIONS`:

```ts
"GET /api/projects/:id/activity": "activity:read",
```

- [ ] **Step 7: Run the tests**

Run: `cd apps/server && bun test test/activity.test.ts test/events-bus.test.ts test/events-sse.test.ts test/route-matrix.test.ts`
Expected: PASS.

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

Run: `pnpm --filter @storylane/server lint`
Expected: no errors — in particular no `local/no-project-tx-escape` on `events/emit.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/services/activity.ts apps/server/src/services/projects.ts apps/server/src/services/invites.ts apps/server/src/events apps/server/src/routes apps/server/src/app.ts apps/server/src/authz/route-manifest.ts apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): Tracker-shaped activity and the project version counter

One row per user action with kind/highlight/message/changes, a
(project_id, project_version) unique index, and an activity_resources
projection so a story's own history is an index lookup. The SSE event now
carries the version a change produced, which is what lets a client fetch
activity?since_version= instead of refetching the project.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 7: Point scales in `packages/core`, project settings, and memberships

**Files:**
- Create: `packages/core/src/point-scale.ts`, `packages/core/src/point-scale.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/server/src/services/projects.ts`, `apps/server/src/routes/projects.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`, `apps/server/test/projects.test.ts`, `apps/server/test/projects-routes.test.ts`
- Create: `apps/server/src/services/memberships.ts`, `apps/server/test/memberships.test.ts`

**Interfaces:**
- Consumes: Task 5's `projects` columns, Task 6's `recordActivity`.
- Produces:
  ```ts
  // packages/core/src/point-scale.ts
  export const BUILT_IN_POINT_SCALES: readonly string[];   // ["0,1,2,3", "0,1,2,4,8", "0,1,2,3,5,8"]
  export function parsePointScale(raw: string): number[];  // throws RangeError on a malformed scale
  export function isCustomPointScale(raw: string): boolean;
  export function isAllowedEstimate(estimate: number | null, scale: readonly number[]): boolean;
  export function nearestOnScale(value: number, scale: readonly number[]): number;

  // apps/server/src/services/projects.ts
  export interface ProjectSettings {
    id: string; name: string; description: string | null; role: MemberRole; archivedAt: number | null;
    point_scale: string; point_scale_is_custom: boolean; bugs_and_chores_are_estimatable: boolean;
    iteration_length: number; week_start_day: number; start_date: string; time_zone: string;
    velocity_averaged_over: number; initial_velocity: number; number_of_done_iterations_to_show: number;
    automatic_planning: boolean; enable_tasks: boolean; show_story_priority: boolean;
    version: number; current_iteration_number: number;
  }
  export function readProject(tx: ProjectTx): ProjectSettings;
  export function updateProject(tx: ProjectTx, patch: ProjectSettingsPatch): ProjectSettings;
  export function createProject(db: Db, actor: Actor, input: { name: string; timeZone?: string; startDate?: string }): ProjectSettings;

  // apps/server/src/services/memberships.ts
  export interface MembershipRow { user_id: string; role: MemberRole; display_name: string; email: string; initials: string; favorite: boolean; last_viewed_at: number | null }
  export function listMemberships(tx: ProjectTx): MembershipRow[];
  export function changeRole(tx: ProjectTx, userId: string, role: MemberRole): MembershipRow;
  export function removeMember(tx: ProjectTx, userId: string): void;
  export function leaveProject(tx: ProjectTx): void;
  ```
  `current_iteration_number` is filled by Task 20; until then `readProject` returns `1`, and Task 20's step replaces that literal with the `currentIterationNumber()` call. (This is the only forward reference in the plan and it is a single line.)
- Routes added: `GET /api/projects/:id` (existing, now returns `ProjectSettings`), `PUT /api/projects/:id` (replaces `PATCH`), `GET /api/projects/:id/memberships`, `PUT /api/projects/:id/memberships/:userId`, `DELETE /api/projects/:id/memberships/:userId`.

- [ ] **Step 1: Write the failing point-scale test**

Create `packages/core/src/point-scale.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedEstimate, isCustomPointScale, nearestOnScale, parsePointScale } from "./point-scale";

describe("parsePointScale", () => {
  it("reads Tracker's three built-ins", () => {
    expect(parsePointScale("0,1,2,3")).toEqual([0, 1, 2, 3]);
    expect(parsePointScale("0,1,2,4,8")).toEqual([0, 1, 2, 4, 8]);
    expect(parsePointScale("0,1,2,3,5,8")).toEqual([0, 1, 2, 3, 5, 8]);
  });

  it("reads a custom scale with fractional values", () => {
    expect(parsePointScale("0,0.5,1,2")).toEqual([0, 0.5, 1, 2]);
  });

  it("refuses an empty, unsorted, duplicated, negative or non-numeric scale", () => {
    for (const bad of ["", "1,0", "1,1", "-1,0", "0,1,x", "0,,1"]) {
      expect(() => parsePointScale(bad)).toThrow(RangeError);
    }
  });
});

describe("isCustomPointScale", () => {
  it("is false for an exact built-in and true for anything else", () => {
    expect(isCustomPointScale("0,1,2,3,5,8")).toBe(false);
    expect(isCustomPointScale("0,1,2,3,5,8,13")).toBe(true);
    // Spacing is not normalization: Tracker compares the stored string.
    expect(isCustomPointScale("0, 1, 2, 3")).toBe(true);
  });
});

describe("isAllowedEstimate", () => {
  const scale = [0, 1, 2, 3, 5, 8];
  it("accepts null (unestimated) and any value on the scale", () => {
    expect(isAllowedEstimate(null, scale)).toBe(true);
    expect(isAllowedEstimate(5, scale)).toBe(true);
  });
  it("refuses a value off the scale, including the search sentinel", () => {
    expect(isAllowedEstimate(4, scale)).toBe(false);
    expect(isAllowedEstimate(-1, scale)).toBe(false);
  });
});

describe("nearestOnScale", () => {
  it("rewrites an estimate to the closest value when a built-in scale changes", () => {
    expect(nearestOnScale(5, [0, 1, 2, 4, 8])).toBe(4);
    expect(nearestOnScale(3, [0, 1, 2, 4, 8])).toBe(2);   // a tie rounds down
    expect(nearestOnScale(99, [0, 1, 2, 4, 8])).toBe(8);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && pnpm exec vitest run src/point-scale.test.ts`
Expected: FAIL — "Failed to resolve import ./point-scale".

- [ ] **Step 3: Write the module**

Create `packages/core/src/point-scale.ts`:

```ts
/**
 * Tracker stores the scale as the comma-separated string itself and exposes
 * `point_scale_is_custom` rather than an enum (core-model §2.2): the set of built-ins is
 * explicitly outside its API version contract, so the string is the data and the built-in list
 * is only a display hint.
 */
export const BUILT_IN_POINT_SCALES: readonly string[] = ["0,1,2,3", "0,1,2,4,8", "0,1,2,3,5,8"];

export function parsePointScale(raw: string): number[] {
  const parts = raw.split(",");
  if (raw.length === 0 || parts.length === 0) throw new RangeError("point scale is empty");
  const values = parts.map((part) => {
    if (part.length === 0 || !/^\d+(\.\d+)?$/.test(part)) throw new RangeError(`point scale value ${part} is not a non-negative number`);
    return Number(part);
  });
  for (let i = 1; i < values.length; i++) {
    if (values[i]! <= values[i - 1]!) throw new RangeError("point scale must be strictly ascending");
  }
  return values;
}

export function isCustomPointScale(raw: string): boolean {
  return !BUILT_IN_POINT_SCALES.includes(raw);
}

export function isAllowedEstimate(estimate: number | null, scale: readonly number[]): boolean {
  if (estimate === null) return true;
  return scale.includes(estimate);
}

/** A tie rounds down: moving 0,1,2,3,5,8 → 0,1,2,4,8 must not inflate an estimate. */
export function nearestOnScale(value: number, scale: readonly number[]): number {
  let best = scale[0]!;
  let bestDistance = Math.abs(value - best);
  for (const candidate of scale.slice(1)) {
    const distance = Math.abs(value - candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
```

Add `export * from "./point-scale";` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run the core test**

Run: `cd packages/core && pnpm exec vitest run src/point-scale.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing settings test**

Add to `apps/server/test/projects.test.ts`:

```ts
describe("project settings", () => {
  it("returns Tracker's settings shape with point_scale_is_custom derived", () => {
    const settings = withProject(db, owner, projectId, "project:read", (tx) => readProject(tx));
    expect(settings.point_scale).toBe("0,1,2,3,5,8");
    expect(settings.point_scale_is_custom).toBe(false);
    expect(settings.iteration_length).toBe(1);
    expect(settings.velocity_averaged_over).toBe(3);
    expect(settings.initial_velocity).toBe(10);
    expect(settings.automatic_planning).toBe(true);
  });

  it("rewrites estimates to the nearest value when a built-in scale changes", () => {
    const storyId = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 5 });
    withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { point_scale: "0,1,2,4,8" }));
    const row = db.$client.query("select estimate from stories where id = ?").get(storyId) as { estimate: number };
    expect(row.estimate).toBe(4);
  });

  it("refuses a start date that disagrees with the week start day", () => {
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { start_date: "2026-09-15" })),
    ).toThrow(/start_date/);
  });

  it("refuses an unknown IANA time zone", () => {
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { time_zone: "Mars/Olympus" })),
    ).toThrow(/time_zone_invalid/);
  });

  it("refuses to turn bug and chore estimation back off", () => {
    withProject(db, owner, projectId, "project:update", (tx) =>
      updateProject(tx, { bugs_and_chores_are_estimatable: true }),
    );
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) =>
        updateProject(tx, { bugs_and_chores_are_estimatable: false }),
      ),
    ).toThrow(/bugs_and_chores_estimation_is_one_way/);
  });

  it("refuses to leave a custom scale for a built-in one", () => {
    withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { point_scale: "0,1,3,7" }));
    expect(() =>
      withProject(db, owner, projectId, "project:update", (tx) => updateProject(tx, { point_scale: "0,1,2,3" })),
    ).toThrow(/point_scale_custom_is_one_way/);
  });

  it("clears iteration overrides when the calendar moves", () => {
    db.$client.run(
      "insert into iteration_overrides (project_id, number, length, team_strength, created_at, updated_at) values (?,?,?,?,?,?)",
      [projectId, 2, 2, 1, Date.now(), Date.now()],
    );
    withProject(db, owner, projectId, "project:update", (tx) =>
      updateProject(tx, { start_date: "2026-09-21" }),
    );
    const left = db.$client.query("select count(*) as n from iteration_overrides").get() as { n: number };
    expect(left.n).toBe(0);
  });
});
```

The last three encode core-model §2.2.2 ("any → custom is one-way"), §1.4.2 ("cannot be turned off again") and §2.3.4 ("changing start day or start date … resets iteration overrides to defaults").

- [ ] **Step 6: Run it and watch it fail**

Run: `cd apps/server && bun test test/projects.test.ts`
Expected: FAIL — `readProject` still returns the doc-8 `ProjectDetail`.

- [ ] **Step 7: Rewrite the service**

In `apps/server/src/services/projects.ts`, replace `ProjectDetail`/`ProjectPatch`/`readProject`/`updateProject` with the `ProjectSettings` shape from the Interfaces block. Key bodies:

```ts
export interface ProjectSettingsPatch {
  name?: string;
  description?: string | null;
  point_scale?: string;
  bugs_and_chores_are_estimatable?: boolean;
  iteration_length?: number;
  week_start_day?: number;
  start_date?: string;
  time_zone?: string;
  velocity_averaged_over?: number;
  initial_velocity?: number;
  number_of_done_iterations_to_show?: number;
  automatic_planning?: boolean;
  enable_tasks?: boolean;
  show_story_priority?: boolean;
}

function assertKnownTimeZone(zone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new HttpError(400, "time_zone_invalid");
  }
}

export function updateProject(tx: ProjectTx, patch: ProjectSettingsPatch): ProjectSettings {
  const current = readProject(tx);
  const set: Record<string, unknown> = {};
  const original: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  // …name/description/booleans map straight across…
  if (patch.bugs_and_chores_are_estimatable === false && current.bugs_and_chores_are_estimatable) {
    throw new HttpError(409, "bugs_and_chores_estimation_is_one_way");
  }
  if (patch.point_scale !== undefined && patch.point_scale !== current.point_scale) {
    let parsed: number[];
    try {
      parsed = parsePointScale(patch.point_scale);
    } catch {
      throw new HttpError(400, "point_scale_invalid");
    }
    if (current.point_scale_is_custom && !isCustomPointScale(patch.point_scale)) {
      throw new HttpError(409, "point_scale_custom_is_one_way");
    }
    // Built-in → built-in rewrites every estimate, accepted stories included (core-model §2.2.2);
    // a move to a custom scale preserves them.
    if (!current.point_scale_is_custom && !isCustomPointScale(patch.point_scale)) {
      for (const row of tx.tx
        .select({ id: stories.id, estimate: stories.estimate })
        .from(stories)
        .where(and(eq(stories.projectId, tx.projectId), isNotNull(stories.estimate)))
        .all()) {
        tx.tx
          .update(stories)
          .set({ estimate: nearestOnScale(row.estimate!, parsed) })
          .where(and(eq(stories.id, row.id), eq(stories.projectId, tx.projectId)))
          .run();
      }
    }
    set.pointScale = patch.point_scale;
  }
  if (patch.time_zone !== undefined) assertKnownTimeZone(patch.time_zone);
  const calendarMoved =
    (patch.start_date !== undefined && patch.start_date !== current.start_date) ||
    (patch.week_start_day !== undefined && patch.week_start_day !== current.week_start_day) ||
    (patch.iteration_length !== undefined && patch.iteration_length !== current.iteration_length);
  // …copy every remaining field into `set`, and `original`/`next` for the activity payload…
  if (Object.keys(set).length === 0) return current;
  tx.tx.update(projects).set(set as never).where(eq(projects.id, tx.projectId)).run();
  if (calendarMoved) {
    // core-model §2.3.4: moving the calendar recalculates every iteration, so the overrides
    // attached to the old numbering no longer describe anything.
    tx.tx.delete(iterationOverrides).where(eq(iterationOverrides.projectId, tx.projectId)).run();
  }
  recordActivity(tx, {
    kind: "project_update_activity",
    message: "edited the project settings",
    highlight: "edited",
    changes: [{ kind: "project", id: tx.projectId, change_type: "update", original_values: original, new_values: next }],
    primaryResources: [{ kind: "project", id: tx.projectId }],
  });
  return readProject(tx);
}
```

A CHECK or trigger violation surfacing from the update (`iteration_length` out of range, `start_date` off the week start day) is mapped to `HttpError(400, …)` by a `try/catch` around the `update` that re-throws anything not matching `/CHECK constraint failed|RAISE/`; use the message text to pick the code (`iteration_length_invalid`, `start_date_invalid`, `week_start_day_invalid`, `velocity_averaged_over_invalid`).

`createProject` gains the calendar defaults: `startDate` defaults to the most recent Monday on or before today in the given zone (`timeZone` defaults to `"UTC"`), so the trigger is satisfied without asking the creator.

- [ ] **Step 8: Write the memberships service and its test**

Create `apps/server/test/memberships.test.ts` covering: a viewer may list; a member may not change a role (403 comes from the matrix, so this test asserts the *service* refusals only); the sole owner cannot be demoted or removed (`409 last_owner`); `leaveProject` removes the actor's own row; removing a member drops their story owner/follower rows (the Task 5 trigger). Then create `apps/server/src/services/memberships.ts` implementing the Interfaces block, with `recordActivity` calls using `project_membership_update_activity` / `project_membership_delete_activity`.

- [ ] **Step 9: Replace `PATCH` with `PUT` on the project and register the membership routes**

In `apps/server/src/routes/projects.ts`: rename the `PATCH /api/projects/:id` handler to `.put(…)` (Tracker's v5 uses PUT), validate the body against `ProjectSettingsPatch` with the same reject-unknown-keys discipline the phase-1 story routes used, and add:

```ts
.get("/api/projects/:id/memberships", (c) =>
  c.json(withProject(db, actorOf(c), c.req.param("id"), "member:read", (tx) => listMemberships(tx))),
)
.put("/api/projects/:id/memberships/:userId", async (c) => {
  const input = await body(c);
  return c.json(
    withProjectChange(deps, actorOf(c), c.req.param("id"), "member:change-role", (tx) =>
      changeRole(tx, c.req.param("userId"), requireRole(input.role)),
    ),
  );
})
.delete("/api/projects/:id/memberships/:userId", (c) => {
  withProjectChange(deps, actorOf(c), c.req.param("id"), "member:remove", (tx) =>
    removeMember(tx, c.req.param("userId")),
  );
  return c.body(null, 204);
})
```

`ROUTE_ACTIONS` gains:

```ts
"PUT /api/projects/:id": "project:update",
"GET /api/projects/:id/memberships": "member:read",
"PUT /api/projects/:id/memberships/:userId": "member:change-role",
"DELETE /api/projects/:id/memberships/:userId": "member:remove",
```
and loses `"PATCH /api/projects/:id"`.

`matrix-fixtures.ts` gains, using a `memberUserId` added to `MatrixContext` (a seeded member who is **not** the sole owner, so the matrix's owner row does not hit `409 last_owner`):

```ts
"PUT /api/projects/:id": { body: { name: "renamed by the matrix" } },
"PUT /api/projects/:id/memberships/:userId": { params: { userId: ctx.memberUserId }, body: { role: "viewer" } },
"DELETE /api/projects/:id/memberships/:userId": { params: { userId: ctx.memberUserId } },
```
`DELETE …/memberships/:userId` joins `DESTRUCTIVE` in `route-matrix.test.ts` so each role gets a fresh project.

- [ ] **Step 10: Run everything**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

Run: `pnpm --filter @storylane/core test`
Expected: PASS.

Run: `pnpm --filter @storylane/server lint`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): Tracker project settings, point scales and memberships

point_scale is the comma-separated string Tracker stores, with
point_scale_is_custom derived on read; a built-in to built-in change
rewrites every estimate to the nearest value, custom is one-way, and moving
the calendar clears the iteration overrides attached to the old numbering.
PUT replaces PATCH on the project, matching v5.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 8: Story state rules in `packages/core`, then story CRUD and transitions

**Files:**
- Create: `packages/core/src/story.ts`, `packages/core/src/story.test.ts`, `apps/server/src/services/stories.ts`, `apps/server/src/routes/stories.ts`, `apps/server/test/stories.test.ts`, `apps/server/test/stories-routes.test.ts`
- Modify: `packages/core/src/index.ts`, `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`, `apps/server/test/route-matrix.test.ts`, `apps/server/test/types.test-d.ts`

**Interfaces:**
- Consumes: Task 5's `stories` table and enums, Task 6's `recordActivity`, Task 7's `parsePointScale` / `isAllowedEstimate`.
- Produces:
  ```ts
  // packages/core/src/story.ts  — the rules; the DB enums stay declared in the schema module
  export type StoryType = "feature" | "bug" | "chore" | "release";
  export type StoryState = "unscheduled" | "unstarted" | "planned" | "started" | "finished" | "delivered" | "accepted" | "rejected";
  export type StoryList = "backlog" | "icebox";
  export function statesFor(type: StoryType): readonly StoryState[];
  export function isValidTransition(type: StoryType, from: StoryState, to: StoryState): boolean;
  export function isEstimable(type: StoryType, bugsAndChoresAreEstimatable: boolean): boolean;
  export function estimationGateBlocks(input: {
    storyType: StoryType; estimate: number | null; targetState: StoryState; bugsAndChoresAreEstimatable: boolean;
  }): boolean;
  export function listForState(state: StoryState): StoryList;

  // apps/server/src/services/stories.ts
  export interface StoryRow {
    id: string; number: number; name: string; description: string | null;
    story_type: StoryType; current_state: StoryState; estimate: number | null;
    accepted_at: number | null; deadline: number | null; story_priority: StoryPriority;
    list: StoryList; position: number; requested_by_id: string | null;
    owner_ids: string[]; label_ids: string[]; follower_ids: string[];
    created_at: number; updated_at: number;
  }
  export function listStories(tx: ProjectTx, filter?: StoryFilter): StoryRow[];
  export function readStory(tx: ProjectTx, storyId: string): StoryRow;
  export function createStory(tx: ProjectTx, input: StoryInput): StoryRow;
  export function updateStory(tx: ProjectTx, storyId: string, patch: StoryPatch): StoryRow;
  export function deleteStory(tx: ProjectTx, storyId: string): void;
  export interface StoryFilter { withState?: StoryState[]; withStoryType?: StoryType[]; withLabel?: string; limit?: number; offset?: number }
  export interface StoryInput { name: string; description?: string | null; story_type?: StoryType; current_state?: StoryState; estimate?: number | null; deadline?: number | null; story_priority?: StoryPriority; before_id?: string | null; after_id?: string | null }
  export type StoryPatch = Partial<Omit<StoryInput, "name">> & { name?: string };
  ```
- Routes added: `GET|POST /api/projects/:id/stories`, `GET|PUT|DELETE /api/projects/:id/stories/:storyId`. The `PUT` carries both field edits and the move (Task 9 adds `before_id`/`after_id`/`group` handling to the same handler, which is how Tracker's v5 expresses a move).

**The transition table** (core-model §1.2, §1.3). Rows are the current state, cells the states each type may move to. `accepted` is terminal for every type.

| from | feature / bug | chore | release |
|---|---|---|---|
| `unscheduled` | `unstarted`, `planned` | `unstarted`, `planned` | `unstarted`, `planned` |
| `unstarted` | `unscheduled`, `planned`, `started` | `unscheduled`, `planned`, `started` | `unscheduled`, `planned`, `finished` |
| `planned` | `unscheduled`, `unstarted`, `started` | `unscheduled`, `unstarted`, `started` | `unscheduled`, `unstarted`, `finished` |
| `started` | `unstarted`, `finished` | `unstarted`, `accepted` | — (a release has no `started`) |
| `finished` | `started`, `delivered` | — (a chore has no `finished`) | `delivered`, `accepted` |
| `delivered` | `accepted`, `rejected` | — | `accepted`, `rejected` |
| `rejected` | `started` | `started` | `finished` |
| `accepted` | — | — | — |

- [ ] **Step 1: Write the failing core test**

Create `packages/core/src/story.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimationGateBlocks, isEstimable, isValidTransition, listForState, statesFor } from "./story";

describe("statesFor", () => {
  it("drops started for a release and finished for a chore", () => {
    expect(statesFor("release")).not.toContain("started");
    expect(statesFor("chore")).not.toContain("finished");
    expect(statesFor("feature")).toHaveLength(8);
  });
});

describe("isValidTransition", () => {
  it("walks a feature through the full cycle", () => {
    expect(isValidTransition("feature", "unscheduled", "unstarted")).toBe(true);
    expect(isValidTransition("feature", "unstarted", "started")).toBe(true);
    expect(isValidTransition("feature", "started", "finished")).toBe(true);
    expect(isValidTransition("feature", "finished", "delivered")).toBe(true);
    expect(isValidTransition("feature", "delivered", "accepted")).toBe(true);
    expect(isValidTransition("feature", "delivered", "rejected")).toBe(true);
    expect(isValidTransition("feature", "rejected", "started")).toBe(true);
  });

  it("accepts a chore straight from started", () => {
    expect(isValidTransition("chore", "started", "accepted")).toBe(true);
    expect(isValidTransition("chore", "started", "finished")).toBe(false);
  });

  it("finishes a release without starting it", () => {
    expect(isValidTransition("release", "unstarted", "finished")).toBe(true);
    expect(isValidTransition("release", "unstarted", "started")).toBe(false);
  });

  it("makes accepted terminal and refuses a jump", () => {
    expect(isValidTransition("feature", "accepted", "started")).toBe(false);
    expect(isValidTransition("feature", "unstarted", "delivered")).toBe(false);
  });
});

describe("isEstimable / estimationGateBlocks", () => {
  it("estimates features always and bugs and chores only when the project says so", () => {
    expect(isEstimable("feature", false)).toBe(true);
    expect(isEstimable("bug", false)).toBe(false);
    expect(isEstimable("bug", true)).toBe(true);
    expect(isEstimable("release", true)).toBe(false);
  });

  it("blocks an unestimated estimable story from started and beyond", () => {
    const base = { estimate: null, bugsAndChoresAreEstimatable: false } as const;
    expect(estimationGateBlocks({ ...base, storyType: "feature", targetState: "started" })).toBe(true);
    expect(estimationGateBlocks({ ...base, storyType: "feature", targetState: "unstarted" })).toBe(false);
    expect(estimationGateBlocks({ ...base, storyType: "chore", targetState: "started" })).toBe(false);
    expect(estimationGateBlocks({ ...base, storyType: "chore", targetState: "started", bugsAndChoresAreEstimatable: true })).toBe(true);
    expect(estimationGateBlocks({ estimate: 3, bugsAndChoresAreEstimatable: false, storyType: "feature", targetState: "started" })).toBe(false);
  });
});

describe("listForState", () => {
  it("maps unscheduled to the icebox and everything else to the backlog list", () => {
    expect(listForState("unscheduled")).toBe("icebox");
    for (const state of ["unstarted", "planned", "started", "finished", "delivered", "accepted", "rejected"] as const) {
      expect(listForState(state)).toBe("backlog");
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/core && pnpm exec vitest run src/story.test.ts`
Expected: FAIL — "Failed to resolve import ./story".

- [ ] **Step 3: Write `packages/core/src/story.ts`**

```ts
export type StoryType = "feature" | "bug" | "chore" | "release";
export type StoryState =
  | "unscheduled" | "unstarted" | "planned" | "started" | "finished" | "delivered" | "accepted" | "rejected";
export type StoryList = "backlog" | "icebox";

/** Per-type transitions (core-model §1.2 rules 6-8). A release skips started; a chore skips finished. */
const TRANSITIONS: Record<StoryType, Partial<Record<StoryState, readonly StoryState[]>>> = {
  feature: {
    unscheduled: ["unstarted", "planned"],
    unstarted: ["unscheduled", "planned", "started"],
    planned: ["unscheduled", "unstarted", "started"],
    started: ["unstarted", "finished"],
    finished: ["started", "delivered"],
    delivered: ["accepted", "rejected"],
    rejected: ["started"],
    accepted: [],
  },
  bug: {
    unscheduled: ["unstarted", "planned"],
    unstarted: ["unscheduled", "planned", "started"],
    planned: ["unscheduled", "unstarted", "started"],
    started: ["unstarted", "finished"],
    finished: ["started", "delivered"],
    delivered: ["accepted", "rejected"],
    rejected: ["started"],
    accepted: [],
  },
  chore: {
    unscheduled: ["unstarted", "planned"],
    unstarted: ["unscheduled", "planned", "started"],
    planned: ["unscheduled", "unstarted", "started"],
    started: ["unstarted", "accepted"],
    rejected: ["started"],
    accepted: [],
  },
  release: {
    unscheduled: ["unstarted", "planned"],
    unstarted: ["unscheduled", "planned", "finished"],
    planned: ["unscheduled", "unstarted", "finished"],
    finished: ["delivered", "accepted"],
    delivered: ["accepted", "rejected"],
    rejected: ["finished"],
    accepted: [],
  },
};

const ALL_STATES: readonly StoryState[] = [
  "unscheduled", "unstarted", "planned", "started", "finished", "delivered", "accepted", "rejected",
];

export function statesFor(type: StoryType): readonly StoryState[] {
  const reachable = new Set<StoryState>(Object.keys(TRANSITIONS[type]) as StoryState[]);
  for (const targets of Object.values(TRANSITIONS[type])) for (const t of targets ?? []) reachable.add(t);
  return ALL_STATES.filter((s) => reachable.has(s));
}

export function isValidTransition(type: StoryType, from: StoryState, to: StoryState): boolean {
  return (TRANSITIONS[type][from] ?? []).includes(to);
}

export function isEstimable(type: StoryType, bugsAndChoresAreEstimatable: boolean): boolean {
  if (type === "feature") return true;
  if (type === "release") return false;
  return bugsAndChoresAreEstimatable;
}

const STARTED_OR_LATER: readonly StoryState[] = ["started", "finished", "delivered", "accepted", "rejected"];

export function estimationGateBlocks(input: {
  storyType: StoryType;
  estimate: number | null;
  targetState: StoryState;
  bugsAndChoresAreEstimatable: boolean;
}): boolean {
  if (input.estimate !== null) return false;
  if (!isEstimable(input.storyType, input.bugsAndChoresAreEstimatable)) return false;
  return STARTED_OR_LATER.includes(input.targetState);
}

/** unscheduled and the Icebox are the same fact (core-model §1.2 rule 2). */
export function listForState(state: StoryState): StoryList {
  return state === "unscheduled" ? "icebox" : "backlog";
}
```

Add `export * from "./story";` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run the core test**

Run: `cd packages/core && pnpm exec vitest run src/story.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Pin the two enum declarations together**

The DB enum lives in `apps/server/src/db/schema/stories.ts` (drizzle-kit must be able to read the schema without resolving a workspace package) and the rules live in core. Add to `apps/server/test/types.test-d.ts`:

```ts
import type { StoryState as DbStoryState, StoryType as DbStoryType, StoryList as DbStoryList } from "../src/db/schema";
import type { StoryState as CoreStoryState, StoryType as CoreStoryType, StoryList as CoreStoryList } from "@storylane/core";

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
// A value of type `never` cannot be produced, so a drift between the two declarations fails tsc.
export const storyStatesAgree: Exact<DbStoryState, CoreStoryState> = true;
export const storyTypesAgree: Exact<DbStoryType, CoreStoryType> = true;
export const storyListsAgree: Exact<DbStoryList, CoreStoryList> = true;
```

- [ ] **Step 6: Write the failing service test**

Create `apps/server/test/stories.test.ts` covering, with `withProject(db, owner, projectId, "story:write", …)`:

1. `createStory` assigns `#1`, `#2` per project, lands in the Icebox with `current_state: "unscheduled"`, and sets `requested_by_id` to the actor.
2. Creating with `current_state: "unstarted"` lands in the `backlog` list instead.
3. `updateStory` refuses an estimate off the project's scale with `400 points_off_scale`.
4. `updateStory` refuses an invalid transition with `409 invalid_transition` (`unstarted → delivered`).
5. Starting an unestimated feature raises `409 estimate_required`; starting an unestimated chore does not.
6. Accepting sets `accepted_at`; moving back out of `accepted` is refused (terminal).
7. Accepting a story flips `list` to `backlog` and leaves it there — Done is derived from `accepted_at`, nothing moves the row.
8. Setting `current_state: "unscheduled"` moves the story to the Icebox list and to the end of it.
9. Every mutation writes exactly one activity row, and the story's own activity (`storyActivity`) finds it.
10. `deleteStory` removes the row and leaves the activity rows in place (their `activity_resources` entry is cascaded, the `activities` row is not).
11. `listStories` filters by `withState` and `withStoryType`.

Each assertion uses the real service, never raw SQL, except when checking a column the service does not return.

- [ ] **Step 7: Run it and watch it fail**

Run: `cd apps/server && bun test test/stories.test.ts`
Expected: FAIL — `../src/services/stories` does not exist.

- [ ] **Step 8: Write the service**

`apps/server/src/services/stories.ts`. The shape follows the phase-1 service that was deleted in Task 1 — a `COLUMNS` projection, a private `readOne`, `HttpError` for every refusal — with these rules:

- `createStory`: `name` trimmed and required (`400 name_required`); `number` is `MAX+1` inside the transaction; `estimate` is checked against `parsePointScale(project.point_scale)` (`400 points_off_scale`); `current_state` defaults to `"unscheduled"`; `list` is always `listForState(current_state)` — never taken from the client; `position` comes from `placeInList` (Task 9) or, until then, `MAX(position) + 1024` within the list; `accepted_at` is set only when the state is `accepted`; `deadline` is refused on a non-release (`400 deadline_release_only`). Activity: `story_create_activity`.
- `updateStory`: loads the current row first. A `current_state` change must satisfy `isValidTransition` (`409 invalid_transition`) and `estimationGateBlocks` (`409 estimate_required`); it sets `accepted_at` when entering `accepted`, clears it when leaving (the DB trigger enforces the pairing either way), and recomputes `list` through `listForState` — a story entering `unscheduled` also goes to the end of the Icebox, a story leaving it to the end of the backlog list. Starting a story adds the actor as an owner; `addOwner` arrives in Task 10, which wires that one call in its own Step 4 — this task leaves the transition itself complete without it. Activity: `story_update_activity` with `changes[0].original_values` / `new_values` holding only the fields that moved.
- `deleteStory`: deletes the row (children cascade) and writes `story_delete_activity` whose `changes[0]` carries `{ kind: "story", id, number, change_type: "delete", original_values: { name, current_state } }`, with no `primary_resources` entry for the gone story — a reader must not link to it.

- [ ] **Step 9: Write the routes**

`apps/server/src/routes/stories.ts`, following the deleted phase-1 file's validation discipline exactly: a `rejectUnknownKeys` allowlist, one `optionalX` validator per field, every check inside the `withProjectChange` callback so authorization answers first.

```ts
"GET /api/projects/:id/stories": "story:read",
"POST /api/projects/:id/stories": "story:write",
"GET /api/projects/:id/stories/:storyId": "story:read",
"PUT /api/projects/:id/stories/:storyId": "story:write",
"DELETE /api/projects/:id/stories/:storyId": "story:delete",
```

Add the matching `matrix-fixtures.ts` entries (a seeded `storyId`, a `{ name: "Matrix" }` body for `PUT`, `{ name: "Matrix story" }` for `POST`) and put `DELETE /api/projects/:id/stories/:storyId` in `DESTRUCTIVE`.

- [ ] **Step 10: Run the suites**

Run: `cd apps/server && bun test test/stories.test.ts test/stories-routes.test.ts test/route-matrix.test.ts`
Expected: PASS.

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

Run: `pnpm --filter @storylane/server typecheck`
Expected: no errors — this is where `types.test-d.ts` catches an enum drift.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): stories with Tracker's eight states and per-type transitions

A release has no started state, a chore no finished state, accepted is
terminal and carries accepted_at, and an estimable story cannot pass
started without an estimate. The list column follows the state: unscheduled
is exactly the Icebox.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 9: Story ordering — sparse positions moved by `before_id` / `after_id`

**Files:**
- Create: `apps/server/src/services/ordering.ts`, `apps/server/test/ordering.test.ts`, `apps/server/test/ordering-concurrency.test.ts`
- Modify: `apps/server/src/services/stories.ts`, `apps/server/src/routes/stories.ts`, `apps/server/test/stories-routes.test.ts`

**Interfaces:**
- Consumes: Task 5's `UNIQUE (project_id, list, position)`, Task 8's `StoryRow`.
- Produces:
  ```ts
  export const POSITION_GAP = 1024;
  export interface MoveRequest {
    /** The target list. Absent means "keep the list the state implies". */
    group?: "scheduled" | "unscheduled" | "current";
    /** The story this one comes after (its predecessor). Null/absent = the head of the list. */
    after_id?: string | null;
    /** The story this one comes before (its successor). Null/absent = the tail of the list. */
    before_id?: string | null;
  }
  export function placeInList(tx: ProjectTx, storyId: string, list: StoryList, move: MoveRequest): number;
  export function appendToList(tx: ProjectTx, list: StoryList): number;
  ```
  `placeInList` writes the story's `position` (and nothing else) and returns it. `group` maps to a list: `unscheduled` → `icebox`, `scheduled`/`current` → `backlog`; `current` is additionally refused with `409 manual_planning_required` while `projects.automatic_planning` is on (Assumption 7).

**Why not `reorder`.** The deleted helper renumbered a whole scope from a full id array the client sent. Tracker's Backlog is one list of hundreds of stories that Current is merely the head of, so the client never holds the whole list, and two concurrent drags would each overwrite the other's ordering wholesale. `reorder` stays in `db/tx.ts` for the short lists — tasks, labels, epics, review types.

- [ ] **Step 1: Write the failing ordering test**

Create `apps/server/test/ordering.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { makeTestDb, seedProject, seedStory, seedUser } from "./harness";
import { withProject } from "../src/db/tx";
import { POSITION_GAP, placeInList } from "../src/services/ordering";
import { stories } from "../src/db/schema";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let projectId: string;

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  projectId = seedProject(db, owner);
});

const order = () =>
  db
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, projectId), eq(stories.list, "icebox")))
    .orderBy(stories.position)
    .all()
    .map((r) => r.id);

describe("placeInList", () => {
  it("appends with a gap when neither neighbour is given", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const positions = db
      .select({ p: stories.position })
      .from(stories)
      .where(eq(stories.projectId, projectId))
      .orderBy(stories.position)
      .all()
      .map((r) => r.p);
    expect(positions).toEqual([0, POSITION_GAP]);
    expect(order()).toEqual([a, b]);
  });

  it("moves a story between two neighbours without touching them", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const c = seedStory(db, projectId);
    const before = db.select({ id: stories.id, p: stories.position }).from(stories).all();
    withProject(db, owner, projectId, "story:write", (tx) => placeInList(tx, c, "icebox", { after_id: a, before_id: b }));
    expect(order()).toEqual([a, c, b]);
    const after = new Map(db.select({ id: stories.id, p: stories.position }).from(stories).all().map((r) => [r.id, r.p]));
    for (const row of before) if (row.id !== c) expect(after.get(row.id)).toBe(row.p);
  });

  it("places at the head when only before_id is given, and at the tail when only after_id is", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    withProject(db, owner, projectId, "story:write", (tx) => placeInList(tx, b, "icebox", { before_id: a }));
    expect(order()).toEqual([b, a]);
    withProject(db, owner, projectId, "story:write", (tx) => placeInList(tx, b, "icebox", { after_id: a }));
    expect(order()).toEqual([a, b]);
  });

  it("renumbers the list only when the gap between neighbours runs out", () => {
    const a = seedStory(db, projectId, { position: 10 });
    const b = seedStory(db, projectId, { position: 11 });
    const c = seedStory(db, projectId, { position: 12 });
    withProject(db, owner, projectId, "story:write", (tx) => placeInList(tx, c, "icebox", { after_id: a, before_id: b }));
    expect(order()).toEqual([a, c, b]);
    const positions = db
      .select({ p: stories.position })
      .from(stories)
      .where(eq(stories.projectId, projectId))
      .orderBy(stories.position)
      .all()
      .map((r) => r.p);
    expect(positions).toEqual([0, POSITION_GAP, POSITION_GAP * 2]);
  });

  it("refuses a neighbour that is in the other list", () => {
    const iceboxStory = seedStory(db, projectId, { list: "icebox" });
    const backlogStory = seedStory(db, projectId, { list: "backlog", currentState: "unstarted" });
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) =>
        placeInList(tx, iceboxStory, "icebox", { after_id: backlogStory }),
      ),
    ).toThrow(/neighbour_not_in_list/);
  });

  it("refuses a neighbour from another project", () => {
    const other = seedProject(db, owner);
    const foreign = seedStory(db, other);
    const mine = seedStory(db, projectId);
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => placeInList(tx, mine, "icebox", { after_id: foreign })),
    ).toThrow(/not_found/);
  });

  it("refuses contradictory neighbours", () => {
    const a = seedStory(db, projectId);
    const b = seedStory(db, projectId);
    const c = seedStory(db, projectId);
    expect(() =>
      withProject(db, owner, projectId, "story:write", (tx) => placeInList(tx, c, "icebox", { after_id: b, before_id: a })),
    ).toThrow(/neighbours_out_of_order/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/server && bun test test/ordering.test.ts`
Expected: FAIL — `../src/services/ordering` does not exist.

- [ ] **Step 3: Write `apps/server/src/services/ordering.ts`**

```ts
import { and, asc, eq, sql } from "drizzle-orm";
import { projects, stories, type StoryList } from "../db/schema";
import { HttpError } from "../http-error";
import type { ProjectTx } from "../db/tx";

/**
 * Sparse spacing, so an ordinary drop between two neighbours is one UPDATE. Wide enough that a
 * list is renumbered roughly once per ten consecutive drops into the same seam, narrow enough
 * that a 32-bit position still holds two million stories.
 */
export const POSITION_GAP = 1024;

export interface MoveRequest {
  group?: "scheduled" | "unscheduled" | "current";
  after_id?: string | null;
  before_id?: string | null;
}

export function listForGroup(tx: ProjectTx, group: MoveRequest["group"]): StoryList | undefined {
  if (group === undefined) return undefined;
  if (group === "unscheduled") return "icebox";
  if (group === "current") {
    const automatic = tx.tx
      .select({ v: projects.automaticPlanning })
      .from(projects)
      .where(eq(projects.id, tx.projectId))
      .get();
    // Current is the head of the backlog list, cut by planning: while planning is automatic a
    // client cannot pin a story there (Assumption 7).
    if (automatic?.v) throw new HttpError(409, "manual_planning_required");
  }
  return "backlog";
}

function neighbourPosition(tx: ProjectTx, list: StoryList, id: string): number {
  const row = tx.tx
    .select({ list: stories.list, position: stories.position })
    .from(stories)
    .where(and(eq(stories.id, id), eq(stories.projectId, tx.projectId)))
    .get();
  if (!row) throw new HttpError(404, "not_found");
  if (row.list !== list) throw new HttpError(400, "neighbour_not_in_list");
  return row.position;
}

/** Two passes through negative positions: SQLite has no deferrable UNIQUE. */
function renumber(tx: ProjectTx, list: StoryList): void {
  const ids = tx.tx
    .select({ id: stories.id })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.list, list)))
    .orderBy(asc(stories.position))
    .all()
    .map((r) => r.id);
  ids.forEach((id, rank) => {
    tx.tx
      .update(stories)
      .set({ position: -rank - 1 })
      .where(and(eq(stories.id, id), eq(stories.projectId, tx.projectId)))
      .run();
  });
  ids.forEach((id, rank) => {
    tx.tx
      .update(stories)
      .set({ position: rank * POSITION_GAP })
      .where(and(eq(stories.id, id), eq(stories.projectId, tx.projectId)))
      .run();
  });
}

export function appendToList(tx: ProjectTx, list: StoryList): number {
  const row = tx.tx
    .select({ p: sql<number | null>`max(${stories.position})` })
    .from(stories)
    .where(and(eq(stories.projectId, tx.projectId), eq(stories.list, list)))
    .get();
  return row?.p === null || row?.p === undefined ? 0 : row.p + POSITION_GAP;
}

/**
 * Tracker's own move vocabulary (core-model §1.8): `after_id` is the predecessor, `before_id`
 * the successor, and the client never sends the whole list. Positions are read *inside* this
 * transaction, so a client working from a stale snapshot still lands next to the neighbours it
 * named rather than overwriting an interleaved move.
 */
export function placeInList(tx: ProjectTx, storyId: string, list: StoryList, move: MoveRequest): number {
  const afterId = move.after_id ?? null;
  const beforeId = move.before_id ?? null;
  if (afterId === storyId || beforeId === storyId) throw new HttpError(400, "neighbour_is_self");
  if (afterId === null && beforeId === null) return write(tx, storyId, appendToList(tx, list), list);

  let lower = afterId === null ? null : neighbourPosition(tx, list, afterId);
  let upper = beforeId === null ? null : neighbourPosition(tx, list, beforeId);
  if (lower !== null && upper !== null && lower >= upper) throw new HttpError(400, "neighbours_out_of_order");

  let position = between(tx, list, lower, upper);
  if (position === null) {
    // The seam is full. Renumbering is the exception, not the write path: it touches the whole
    // list, and it happens inside this same transaction so no reader sees half a renumbering.
    renumber(tx, list);
    lower = afterId === null ? null : neighbourPosition(tx, list, afterId);
    upper = beforeId === null ? null : neighbourPosition(tx, list, beforeId);
    position = between(tx, list, lower, upper);
    if (position === null) throw new Error("positions exhausted after renumbering");
  }
  return write(tx, storyId, position, list);
}

function between(tx: ProjectTx, list: StoryList, lower: number | null, upper: number | null): number | null {
  if (lower === null && upper === null) return appendToList(tx, list);
  if (lower === null) return upper! - POSITION_GAP >= 0 ? upper! - POSITION_GAP : upper! > 0 ? Math.floor(upper! / 2) : null;
  if (upper === null) return lower + POSITION_GAP;
  const mid = Math.floor((lower + upper) / 2);
  return mid > lower && mid < upper ? mid : null;
}

function write(tx: ProjectTx, storyId: string, position: number, list: StoryList): number {
  tx.tx
    .update(stories)
    .set({ position, list })
    .where(and(eq(stories.id, storyId), eq(stories.projectId, tx.projectId)))
    .run();
  return position;
}
```

- [ ] **Step 4: Run the ordering test**

Run: `cd apps/server && bun test test/ordering.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the concurrency test**

Create `apps/server/test/ordering-concurrency.test.ts`. It uses a file database rather than `:memory:` so two connections really contend, and it interleaves the *client's* view: both callers compute their move from the same snapshot, and both moves must land.

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDatabase } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { seedProject, seedStory, seedUser } from "./harness";
import { withProject } from "../src/db/tx";
import { placeInList } from "../src/services/ordering";
import { stories } from "../src/db/schema";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("concurrent moves", () => {
  it("lands both moves, loses neither, and keeps positions unique", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-order-"));
    dirs.push(dir);
    const path = join(dir, "storylane.db");
    const writer = openDatabase(path);
    runMigrations(writer);
    const owner = seedUser(writer, "owner@example.test");
    const projectId = seedProject(writer, owner);
    const [a, b, c, d] = [
      seedStory(writer, projectId, { name: "a" }),
      seedStory(writer, projectId, { name: "b" }),
      seedStory(writer, projectId, { name: "c" }),
      seedStory(writer, projectId, { name: "d" }),
    ];

    // Both callers decided from the same snapshot [a, b, c, d]: one drags d between a and b,
    // the other drags c between a and b. Neither sends positions, only the neighbours it saw.
    const second = openDatabase(path);
    withProject(writer, owner, projectId, "story:write", (tx) =>
      placeInList(tx, d, "icebox", { after_id: a, before_id: b }),
    );
    withProject(second, owner, projectId, "story:write", (tx) =>
      placeInList(tx, c, "icebox", { after_id: a, before_id: b }),
    );

    const order = writer
      .select({ id: stories.id, position: stories.position })
      .from(stories)
      .where(and(eq(stories.projectId, projectId), eq(stories.list, "icebox")))
      .orderBy(stories.position)
      .all();
    expect(order).toHaveLength(4);
    expect(new Set(order.map((r) => r.position)).size).toBe(4);
    const ids = order.map((r) => r.id);
    // Both moves are honoured: each landed after a and before b, in the order they committed.
    expect(ids[0]).toBe(a);
    expect(ids[ids.length - 1]).toBe(b);
    expect(ids.slice(1, 3).sort()).toEqual([c, d].sort());
    writer.$client.close();
    second.$client.close();
  });

  it("survives a seam that runs out, renumbering inside the transaction", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-order-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "storylane.db"));
    runMigrations(db);
    const owner = seedUser(db, "owner@example.test");
    const projectId = seedProject(db, owner);
    const head = seedStory(db, projectId, { position: 0 });
    const tail = seedStory(db, projectId, { position: 1 });
    const movers = [2, 3, 4].map((p) => seedStory(db, projectId, { position: p * 1000 }));
    for (const mover of movers) {
      withProject(db, owner, projectId, "story:write", (tx) =>
        placeInList(tx, mover, "icebox", { after_id: head, before_id: tail }),
      );
    }
    const rows = db
      .select({ id: stories.id, position: stories.position })
      .from(stories)
      .where(eq(stories.projectId, projectId))
      .orderBy(stories.position)
      .all();
    expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
    expect(rows[0]!.id).toBe(head);
    expect(rows[rows.length - 1]!.id).toBe(tail);
    db.$client.close();
  });
});
```

- [ ] **Step 6: Run it**

Run: `cd apps/server && bun test test/ordering-concurrency.test.ts`
Expected: PASS (2 tests). A failure on the first case means `placeInList` read a position from outside its transaction; on the second, that `between` handed back a colliding value instead of renumbering.

- [ ] **Step 7: Wire the move into the story service and route**

In `services/stories.ts`: `createStory` calls `placeInList(tx, id, list, { after_id, before_id })` when either is given and `appendToList` otherwise; `updateStory` calls `placeInList` when the patch carries `group`, `before_id` or `after_id`, resolving the target list as `listForGroup(tx, group) ?? listForState(nextState)`. A move writes `story_move_activity`; a field edit writes `story_update_activity`; a PUT that does both writes one row of each.

In `routes/stories.ts`: add `group`, `before_id` and `after_id` to the `PUT` allowlist (and `before_id`/`after_id` to `POST`), validating `group` against `["scheduled", "unscheduled", "current"]` with `400 group_invalid`.

Add a `stories-routes.test.ts` case asserting `PUT /stories/:id` with `{ after_id, before_id }` reorders and returns the new `position`, and one asserting `{ group: "current" }` answers 409 while automatic planning is on.

- [ ] **Step 8: Run everything**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

Run: `pnpm --filter @storylane/server lint`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/services apps/server/src/routes apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): before_id/after_id story ordering over sparse positions

Two ordered lists per project, moved the way Tracker's API moves them: the
client names the neighbours it saw, the server reads their positions inside
the transaction and renumbers only when a seam runs out. Two interleaved
drags both land instead of one overwriting the other's whole list.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 10: Story owners and followers

**Files:**
- Create: `apps/server/src/services/story-people.ts`, `apps/server/test/story-people.test.ts`
- Modify: `apps/server/src/services/stories.ts`, `apps/server/src/routes/stories.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`

**Interfaces:**
- Consumes: Task 5's `storyOwners` / `storyFollowers`, Task 8's `readStory`.
- Produces:
  ```ts
  export function addOwner(tx: ProjectTx, storyId: string, userId: string): string[];      // the story's owner_ids after the change
  export function removeOwner(tx: ProjectTx, storyId: string, userId: string): string[];
  export function addFollower(tx: ProjectTx, storyId: string, userId: string): string[];
  export function removeFollower(tx: ProjectTx, storyId: string, userId: string): string[];
  /** Requester, owners, commenters and @mentioned people follow automatically (core-model §1.5.2). */
  export function ensureFollowing(tx: ProjectTx, storyId: string, userId: string): void;
  ```
- Routes added: `POST|DELETE /api/projects/:id/stories/:storyId/owners/:userId` (`story:write`), `POST|DELETE /api/projects/:id/stories/:storyId/followers/:userId` (`follower:write`).

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/story-people.test.ts` asserting:

```ts
it("adds the clicker as an owner when a story starts", () => {
  const storyId = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 1 });
  const story = withProject(db, member, projectId, "story:write", (tx) =>
    updateStory(tx, storyId, { current_state: "started" }),
  );
  expect(story.owner_ids).toEqual([(member as { userId: string }).userId]);
});

it("refuses an owner who is not a member of the project", () => {
  const outsider = seedUser(db, "outsider@example.test") as { userId: string };
  const storyId = seedStory(db, projectId);
  expect(() =>
    withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, outsider.userId)),
  ).toThrow(/owner_not_member/);
});

it("is idempotent in both directions", () => {
  const storyId = seedStory(db, projectId);
  const id = (owner as { userId: string }).userId;
  withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, id));
  const twice = withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, id));
  expect(twice).toEqual([id]);
  withProject(db, owner, projectId, "story:write", (tx) => removeOwner(tx, storyId, id));
  const gone = withProject(db, owner, projectId, "story:write", (tx) => removeOwner(tx, storyId, id));
  expect(gone).toEqual([]);
});

it("makes an owner a follower but not the other way round", () => {
  const storyId = seedStory(db, projectId);
  const id = (owner as { userId: string }).userId;
  withProject(db, owner, projectId, "story:write", (tx) => addOwner(tx, storyId, id));
  expect(withProject(db, owner, projectId, "story:read", (tx) => readStory(tx, storyId)).follower_ids).toEqual([id]);
  withProject(db, owner, projectId, "follower:write", (tx) => removeFollower(tx, storyId, id));
  expect(withProject(db, owner, projectId, "story:read", (tx) => readStory(tx, storyId)).owner_ids).toEqual([id]);
});

it("lets a viewer follow only itself", () => {
  const storyId = seedStory(db, projectId);
  const viewerId = (viewer as { userId: string }).userId;
  expect(() =>
    withProject(db, viewer, projectId, "follower:write", (tx) => addFollower(tx, storyId, viewerId)),
  ).not.toThrow();
  expect(() =>
    withProject(db, viewer, projectId, "follower:write", (tx) => addFollower(tx, storyId, (owner as { userId: string }).userId)),
  ).toThrow(/forbidden/);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/server && bun test test/story-people.test.ts`
Expected: FAIL — `../src/services/story-people` does not exist.

- [ ] **Step 3: Write the service**

`addOwner` inserts with `onConflictDoNothing`, maps a `FOREIGN KEY constraint failed` to `HttpError(400, "owner_not_member")` the way the deleted phase-1 service mapped its assignee FK, then calls `ensureFollowing`, then writes `story_update_activity` with `changes[0].new_values.owner_ids`. The viewer rule lives here:

```ts
/** The matrix grants a viewer follower:write; the self-restriction is not expressible there. */
function assertMayActOnBehalfOf(tx: ProjectTx, userId: string): void {
  if (tx.role !== "viewer") return;
  if (tx.actor.kind === "user" && tx.actor.userId === userId) return;
  throw new HttpError(403, "forbidden");
}
```

- [ ] **Step 4: Hook Start into ownership**

In `services/stories.ts` `updateStory`, after a successful transition into `started`, call `addOwner(tx, storyId, actorUserId(tx))` (core-model §1.2 rule 6). Also call `ensureFollowing` for the requester at create time (§1.5.2).

- [ ] **Step 5: Routes, manifest, fixtures**

```ts
"POST /api/projects/:id/stories/:storyId/owners/:userId": "story:write",
"DELETE /api/projects/:id/stories/:storyId/owners/:userId": "story:write",
"POST /api/projects/:id/stories/:storyId/followers/:userId": "follower:write",
"DELETE /api/projects/:id/stories/:storyId/followers/:userId": "follower:write",
```
The follower fixtures must name the *acting* user so the viewer row passes (`params: { storyId, userId: ctx.selfUserId }` is wrong — the matrix runs as five different actors). Give the follower rows their own fixture whose `userId` is `ctx.ownerUserId`, and cover the viewer's own follow in `story-people.test.ts` instead; the matrix row for a viewer then asserts 200 for *another* user only if the service allows it — it does not, so set the follower rows' fixture `userId` to a seeded **member** and record in `spec/permissions.md` notes that the matrix row for `follower:write`/viewer is exercised through the service test. If that makes the matrix row fail, change the fixture to name the acting viewer by using `ctx.viewerUserId` and asserting 200 across roles; do not weaken the service rule.

- [ ] **Step 6: Run everything and commit**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

```bash
git add apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): story owners and followers

Start makes the clicker an owner, an owner follows automatically, and a
viewer may follow only itself - the one write the role matrix grants a
viewer, with the self-restriction enforced in the service.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 11: Labels, story labels and epics

**Files:**
- Create: `apps/server/src/services/labels.ts`, `apps/server/src/routes/labels.ts`, `apps/server/test/labels.test.ts`, `apps/server/test/epics.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`

**Interfaces:**
- Consumes: Task 5's `labels` / `storyLabels` / `epics`, `reorder` from `db/tx.ts`.
- Produces:
  ```ts
  export interface LabelRow { id: string; name: string; created_at: number; updated_at: number; counts: LabelCounts }
  export interface LabelCounts {
    number_of_stories_by_state: Record<StoryState, number>;
    sum_of_story_estimates_by_state: Record<StoryState, number>;
    number_of_zero_point_stories_by_state: Record<StoryState, number>;
  }
  export function listLabels(tx: ProjectTx): LabelRow[];
  export function createLabel(tx: ProjectTx, name: string): LabelRow;
  export function renameLabel(tx: ProjectTx, labelId: string, name: string): LabelRow;
  export function deleteLabel(tx: ProjectTx, labelId: string): void;
  export function attachLabel(tx: ProjectTx, storyId: string, name: string): string[];   // label_ids after
  export function detachLabel(tx: ProjectTx, storyId: string, labelId: string): string[];
  export interface EpicRow { id: string; name: string; description: string | null; label_id: string; position: number; past_done_stories_count: number; past_done_story_estimates: number; completed_at: number | null }
  export function listEpics(tx: ProjectTx): EpicRow[];
  export function createEpic(tx: ProjectTx, input: { name: string; description?: string | null; label_name?: string }): EpicRow;
  export function updateEpic(tx: ProjectTx, epicId: string, patch: { name?: string; description?: string | null }): EpicRow;
  export function moveEpic(tx: ProjectTx, epicId: string, move: { before_id?: string | null; after_id?: string | null }): EpicRow[];
  export function deleteEpic(tx: ProjectTx, epicId: string): void;
  ```
- Routes added: `GET|POST /api/projects/:id/labels` (`label:write` for POST, `story:read` for GET), `PUT|DELETE /api/projects/:id/labels/:labelId`, `POST /api/projects/:id/stories/:storyId/labels`, `DELETE /api/projects/:id/stories/:storyId/labels/:labelId`, `GET|POST /api/projects/:id/epics`, `PUT|DELETE /api/projects/:id/epics/:epicId`.

- [ ] **Step 1: Write the failing tests**

`apps/server/test/labels.test.ts`:

```ts
it("creates a label by name when a story is labelled with a new one", () => {
  const storyId = seedStory(db, projectId);
  const ids = withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "needs design"));
  expect(ids).toHaveLength(1);
  expect(withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx)).map((l) => l.name)).toEqual(["needs design"]);
});

it("reuses an existing label case-insensitively instead of creating a twin", () => {
  const storyId = seedStory(db, projectId);
  withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "UX"));
  withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "ux"));
  expect(withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx))).toHaveLength(1);
});

it("counts stories, estimates and zero-point stories by state", () => {
  const a = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 3 });
  const b = seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate: 0 });
  withProject(db, owner, projectId, "label:write", (tx) => {
    attachLabel(tx, a, "ux");
    attachLabel(tx, b, "ux");
  });
  const [label] = withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx));
  expect(label!.counts.number_of_stories_by_state.unstarted).toBe(2);
  expect(label!.counts.sum_of_story_estimates_by_state.unstarted).toBe(3);
  expect(label!.counts.number_of_zero_point_stories_by_state.unstarted).toBe(1);
});

it("refuses to delete a label an epic is built on", () => {
  const epic = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
  expect(() =>
    withProject(db, owner, projectId, "label:delete", (tx) => deleteLabel(tx, epic.label_id)),
  ).toThrow(/label_backs_an_epic/);
});
```

`apps/server/test/epics.test.ts`:

```ts
it("mints a label named after the epic when none is given", () => {
  const epic = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
  const labels = withProject(db, owner, projectId, "story:read", (tx) => listLabels(tx));
  expect(labels.map((l) => l.id)).toContain(epic.label_id);
  expect(labels.find((l) => l.id === epic.label_id)!.name).toBe("onboarding");
});

it("refuses a second epic on the same label", () => {
  const first = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
  expect(() =>
    withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Other", label_name: "onboarding" })),
  ).toThrow(/label_backs_an_epic/);
  expect(first.position).toBe(0);
});

it("reports progress from the accepted stories carrying its label", () => {
  const storyId = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 5 });
  const epic = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "Onboarding" }));
  withProject(db, owner, projectId, "label:write", (tx) => attachLabel(tx, storyId, "onboarding"));
  withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, storyId, { current_state: "accepted" }));
  const [read] = withProject(db, owner, projectId, "story:read", (tx) => listEpics(tx));
  expect(read!.past_done_stories_count).toBe(1);
  expect(read!.past_done_story_estimates).toBe(5);
  expect(read!.completed_at).not.toBeNull();
});

it("reorders epics with before_id/after_id and keeps positions dense", () => {
  const a = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "A" }));
  const b = withProject(db, owner, projectId, "epic:write", (tx) => createEpic(tx, { name: "B" }));
  const order = withProject(db, owner, projectId, "epic:write", (tx) => moveEpic(tx, b.id, { before_id: a.id }));
  expect(order.map((e) => e.name)).toEqual(["B", "A"]);
  expect(order.map((e) => e.position)).toEqual([0, 1]);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/server && bun test test/labels.test.ts test/epics.test.ts`
Expected: FAIL — `../src/services/labels` does not exist.

- [ ] **Step 3: Write the service**

Notes that shape the implementation:

- Label names are stored as given but matched case-insensitively (`UNIQUE (project_id, name COLLATE NOCASE)`); `attachLabel` does a NOCASE lookup first and inserts only on a miss, so the unique index is a backstop, not the control flow.
- `createEpic` creates the label when `label_name` is absent, using the epic's name lower-cased; if the named label already backs an epic, `409 label_backs_an_epic`. `deleteLabel` raises the same code rather than letting the `ON DELETE RESTRICT` foreign key surface as a 500.
- `counts` is one grouped query per project (`GROUP BY story_labels.label_id, stories.current_state`), not a query per label — the Labels panel (step 6) lists every label at once.
- Epic order is dense and uses `reorder(tx, epics, eq(epics.projectId, tx.projectId), orderedIds)`: the list is short (core-model §4.2 rule 2 says Tracker moves epics with before/after ids, but the storage is our choice, and a whole-list renumber of a dozen rows is cheaper than sparse bookkeeping).
- Activity: `label_create_activity`, `label_update_activity`, `label_delete_activity`, `epic_create_activity`, `epic_update_activity`, `epic_move_activity`, `epic_delete_activity`. Attaching or detaching a label on a story writes `story_update_activity` with `label_ids` in `original_values`/`new_values` — it is a story edit, not a label edit.

- [ ] **Step 4: Routes, manifest, fixtures, then run and commit**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

```bash
git add apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): labels, story labels and epics

An epic has a label and a story is in the epic exactly when it carries that
label, so there is no epic_id on a story. Label counts are the three
by-state maps Tracker exposes, computed in one grouped query.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 12: Story tasks

**Files:**
- Create: `apps/server/src/services/tasks.ts`, `apps/server/test/tasks.test.ts`
- Create: `apps/server/src/routes/story-parts.ts` (this task starts the file; Tasks 13–15 extend it)
- Modify: `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TaskRow { id: string; story_id: string; description: string; complete: boolean; position: number; created_at: number; updated_at: number }
  export function listTasks(tx: ProjectTx, storyId: string): TaskRow[];
  export function createTask(tx: ProjectTx, storyId: string, input: { description: string; position?: number }): TaskRow;
  export function updateTask(tx: ProjectTx, taskId: string, patch: { description?: string; complete?: boolean; position?: number }): TaskRow;
  export function deleteTask(tx: ProjectTx, taskId: string): void;
  ```
  `position` is 1-based on the wire (Tracker's own numbering) and dense 0-based in the column; the service converts at both edges, and this is the only place that conversion exists.
- Routes: `GET|POST /api/projects/:id/stories/:storyId/tasks` and `PUT|DELETE /api/projects/:id/stories/:storyId/tasks/:taskId`, all `task:write` except the `GET` (`story:read`).

- [ ] **Step 1: Write the failing test**

`apps/server/test/tasks.test.ts`:

```ts
it("appends tasks and numbers them from 1 on the wire", () => {
  const storyId = seedStory(db, projectId);
  const a = withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: "first" }));
  const b = withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: "second" }));
  expect([a.position, b.position]).toEqual([1, 2]);
});

it("moves a task to a given position and closes the gap it left", () => {
  const storyId = seedStory(db, projectId);
  const ids = ["a", "b", "c"].map((d) =>
    withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: d })).id,
  );
  withProject(db, owner, projectId, "task:write", (tx) => updateTask(tx, ids[2]!, { position: 1 }));
  const after = withProject(db, owner, projectId, "story:read", (tx) => listTasks(tx, storyId));
  expect(after.map((t) => t.description)).toEqual(["c", "a", "b"]);
  expect(after.map((t) => t.position)).toEqual([1, 2, 3]);
});

it("refuses a position outside the list", () => {
  const storyId = seedStory(db, projectId);
  const task = withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: "a" }));
  expect(() => withProject(db, owner, projectId, "task:write", (tx) => updateTask(tx, task.id, { position: 0 }))).toThrow(
    /position_out_of_range/,
  );
});

it("refuses a task on a story in another project", () => {
  const other = seedProject(db, owner);
  const foreign = seedStory(db, other);
  expect(() =>
    withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, foreign, { description: "a" })),
  ).toThrow(/not_found/);
});

it("closes the gap when a task is deleted", () => {
  const storyId = seedStory(db, projectId);
  const ids = ["a", "b", "c"].map((d) =>
    withProject(db, owner, projectId, "task:write", (tx) => createTask(tx, storyId, { description: d })).id,
  );
  withProject(db, owner, projectId, "task:write", (tx) => deleteTask(tx, ids[0]!));
  expect(withProject(db, owner, projectId, "story:read", (tx) => listTasks(tx, storyId)).map((t) => t.position)).toEqual([1, 2]);
});
```

- [ ] **Step 2: Run it, watch it fail, then implement**

Run: `cd apps/server && bun test test/tasks.test.ts`
Expected: FAIL — module not found.

Implementation notes: every task read or write goes through `loadInProject(tx, stories, storyId)` first, so a story outside the project is a 404 before anything else; ordering uses `reorder(tx, tasks, eq(tasks.storyId, storyId), orderedIds)` with the scope exactly matching `UNIQUE (project_id, story_id, position)`. Activity: `task_create_activity`, `task_update_activity`, `task_delete_activity`, each with the story as a primary resource so the story panel picks them up.

- [ ] **Step 3: Run everything and commit**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

```bash
git add apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): story tasks

Dense 0-based positions in the column, 1-based on the wire the way Tracker
numbers them, reordered through the shared reorder helper.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 13: Comments and file attachments

**Files:**
- Create: `apps/server/src/services/comments.ts`, `apps/server/src/attachments/store.ts`, `apps/server/test/comments.test.ts`, `apps/server/test/attachments.test.ts`
- Modify: `apps/server/src/routes/story-parts.ts`, `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`, `apps/server/README.md`

**Interfaces:**
- Produces:
  ```ts
  // apps/server/src/attachments/store.ts — no DB access, no ProjectTx: pure filesystem.
  export interface AttachmentStore {
    /** Returns the path to record in file_attachments.storage_path, relative to the data dir. */
    put(projectId: string, attachmentId: string, bytes: ArrayBuffer): string;
    read(storagePath: string): Uint8Array;
    remove(storagePath: string): void;
  }
  export function createAttachmentStore(dataDir: string): AttachmentStore;
  export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

  // apps/server/src/services/comments.ts
  export interface CommentRow {
    id: string; story_id: string | null; epic_id: string | null; text: string; person_id: string;
    created_at: number; updated_at: number; file_attachments: FileAttachmentRow[];
  }
  export interface FileAttachmentRow { id: string; filename: string; content_type: string; size: number; uploader_id: string; created_at: number; download_url: string }
  export function listComments(tx: ProjectTx, parent: { storyId?: string; epicId?: string }): CommentRow[];
  export function createComment(tx: ProjectTx, parent: { storyId?: string; epicId?: string }, text: string): CommentRow;
  export function updateComment(tx: ProjectTx, commentId: string, text: string): CommentRow;
  export function deleteComment(tx: ProjectTx, commentId: string): { storagePaths: string[] };
  export function attachFile(tx: ProjectTx, commentId: string, meta: { id: string; filename: string; contentType: string; size: number; storagePath: string }): FileAttachmentRow;
  export function readAttachment(tx: ProjectTx, attachmentId: string): FileAttachmentRow & { storage_path: string };
  export function detachFile(tx: ProjectTx, attachmentId: string): { storagePath: string };
  /** @mention -> user ids, resolved against this project's members only. */
  export function mentionedUserIds(tx: ProjectTx, text: string): string[];
  ```
- Routes: `GET|POST /api/projects/:id/stories/:storyId/comments`, `PUT|DELETE /api/projects/:id/stories/:storyId/comments/:commentId`, `POST /api/projects/:id/stories/:storyId/comments/:commentId/attachments`, `GET|DELETE /api/projects/:id/attachments/:attachmentId`.

**Filesystem discipline.** The bytes are written **before** the transaction opens (the callback is synchronous and `Bun.write` is not), under `<dataDir>/attachments/<projectId>/<attachmentId>`; if the transaction then throws, the route deletes the orphan in its `catch` and rethrows. A delete is the mirror image: the transaction returns the storage paths it removed and the route unlinks them after it commits, so a rollback never destroys bytes a row still points at.

- [ ] **Step 1: Write the failing store test**

`apps/server/test/attachments.test.ts`:

```ts
it("writes under the data dir and reads back the same bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-att-"));
  const store = createAttachmentStore(dir);
  const path = store.put("p1", "a1", new TextEncoder().encode("hello").buffer);
  expect(path).toBe("attachments/p1/a1");
  expect(new TextDecoder().decode(store.read(path))).toBe("hello");
  store.remove(path);
  expect(() => store.read(path)).toThrow();
  rmSync(dir, { recursive: true, force: true });
});

it("refuses a storage path that escapes the data dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-att-"));
  const store = createAttachmentStore(dir);
  expect(() => store.read("../../etc/passwd")).toThrow(/outside the attachment store/);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Write the failing comment tests**

`apps/server/test/comments.test.ts` asserting: a comment makes its author a follower of the story; `@name` of a project member makes that member a follower and `@name` of a non-member does not; only the author may edit (`403 not_comment_author`); a member may delete their own comment and an owner may delete anyone's, while a member deleting someone else's gets `403 forbidden`; `updated_at` moves when an attachment is added or removed, not only when the text changes (core-model §7); deleting a comment returns the storage paths of its attachments.

- [ ] **Step 3: Run both, watch them fail, then implement**

Run: `cd apps/server && bun test test/attachments.test.ts test/comments.test.ts`
Expected: FAIL — modules not found.

`createAttachmentStore` resolves every path with `resolve(dataDir, "attachments", …)` and throws `Error("path is outside the attachment store")` when the result does not start with `resolve(dataDir, "attachments")` — the check is on the resolved path, never on the input string.

Activity: `comment_create_activity`, `comment_update_activity`, `comment_delete_activity`, each carrying both the comment and its story as primary resources.

- [ ] **Step 4: Routes**

The upload route parses the multipart body with `await c.req.parseBody()` **before** `withProjectChange`, refuses anything over `ATTACHMENT_MAX_BYTES` with `413 attachment_too_large`, writes the bytes, then opens the transaction. The download route streams `store.read(row.storage_path)` with the recorded `content_type` and `Content-Disposition: attachment; filename="…"` (always `attachment`, never `inline`: an HTML file uploaded to a comment must not execute on the app's origin).

```ts
"GET /api/projects/:id/stories/:storyId/comments": "story:read",
"POST /api/projects/:id/stories/:storyId/comments": "comment:create",
"PUT /api/projects/:id/stories/:storyId/comments/:commentId": "comment:update-own",
"DELETE /api/projects/:id/stories/:storyId/comments/:commentId": "comment:delete",
"POST /api/projects/:id/stories/:storyId/comments/:commentId/attachments": "attachment:write",
"GET /api/projects/:id/attachments/:attachmentId": "story:read",
"DELETE /api/projects/:id/attachments/:attachmentId": "attachment:delete",
```

Document the new on-disk layout in `apps/server/README.md` under Configuration: `$STORYLANE_DATA_DIR/attachments/<project id>/<attachment id>`.

- [ ] **Step 5: Run everything and commit**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

```bash
git add apps/server/src apps/server/test apps/server/README.md
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): comments with file attachments

Metadata in SQLite, bytes under $STORYLANE_DATA_DIR/attachments. The write
happens before the transaction and is cleaned up if it rolls back; the
delete happens after it commits, so a rollback never destroys bytes a row
still points at. Downloads are always Content-Disposition: attachment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 14: Blockers, resolved when the story they name is accepted

**Files:**
- Create: `apps/server/src/services/blockers.ts`, `apps/server/test/blockers.test.ts`
- Modify: `apps/server/src/services/stories.ts`, `apps/server/src/routes/story-parts.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BlockerRow { id: string; story_id: string; blocking_story_id: string | null; description: string; resolved: boolean; person_id: string; created_at: number; updated_at: number }
  export function listBlockers(tx: ProjectTx, storyId: string): BlockerRow[];
  export function createBlocker(tx: ProjectTx, storyId: string, description: string): BlockerRow;
  export function updateBlocker(tx: ProjectTx, blockerId: string, patch: { description?: string; resolved?: boolean }): BlockerRow;
  export function deleteBlocker(tx: ProjectTx, blockerId: string): void;
  /** Called by stories.ts when a story reaches `accepted` or is deleted (core-model §1.6.2). */
  export function resolveBlockersReferencing(tx: ProjectTx, storyId: string): number;
  /** The `#<n>` a description names, if that story exists in this project. */
  export function referencedStoryId(tx: ProjectTx, description: string): string | null;
  ```
- Routes: `GET|POST /api/projects/:id/stories/:storyId/blockers`, `PUT|DELETE /api/projects/:id/stories/:storyId/blockers/:blockerId` (`blocker:write`, `GET` is `story:read`).

- [ ] **Step 1: Write the failing test**

```ts
it("links a blocker to the story its description names", () => {
  const blocked = seedStory(db, projectId, { name: "blocked" });
  const blocking = seedStory(db, projectId, { name: "blocking", list: "backlog", currentState: "unstarted", estimate: 1 });
  const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
  const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
    createBlocker(tx, blocked, `waiting on #${number.number}`),
  );
  expect(blocker.blocking_story_id).toBe(blocking);
  expect(blocker.resolved).toBe(false);
});

it("leaves free text unlinked", () => {
  const blocked = seedStory(db, projectId);
  const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
    createBlocker(tx, blocked, "waiting on the vendor"),
  );
  expect(blocker.blocking_story_id).toBeNull();
});

it("ignores a #n from another project", () => {
  const other = seedProject(db, owner);
  seedStory(db, other, { name: "theirs" });
  const blocked = seedStory(db, projectId);
  const blocker = withProject(db, owner, projectId, "blocker:write", (tx) => createBlocker(tx, blocked, "blocked by #1"));
  // #1 in *this* project is the blocked story itself, and a blocker may not name its own story.
  expect(blocker.blocking_story_id).toBeNull();
});

it("resolves automatically when the referenced story is accepted", () => {
  const blocking = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 1 });
  const blocked = seedStory(db, projectId);
  const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
  const blocker = withProject(db, owner, projectId, "blocker:write", (tx) =>
    createBlocker(tx, blocked, `#${number.number}`),
  );
  withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, blocking, { current_state: "accepted" }));
  const after = withProject(db, owner, projectId, "story:read", (tx) => listBlockers(tx, blocked));
  expect(after.find((b) => b.id === blocker.id)!.resolved).toBe(true);
});

it("resolves when the referenced story is deleted", () => {
  const blocking = seedStory(db, projectId);
  const blocked = seedStory(db, projectId);
  const number = db.$client.query("select number from stories where id = ?").get(blocking) as { number: number };
  withProject(db, owner, projectId, "blocker:write", (tx) => createBlocker(tx, blocked, `#${number.number}`));
  withProject(db, owner, projectId, "story:delete", (tx) => deleteStory(tx, blocking));
  const after = withProject(db, owner, projectId, "story:read", (tx) => listBlockers(tx, blocked));
  expect(after[0]!.resolved).toBe(true);
  expect(after[0]!.blocking_story_id).toBeNull();
});
```

- [ ] **Step 2: Run it, watch it fail, implement**

`referencedStoryId` matches `/#(\d+)/` (the first occurrence), looks the number up **within this project**, and returns null when it misses or names the blocked story itself. `resolveBlockersReferencing` is called from `updateStory` on entry into `accepted` and from `deleteStory`; it sets `resolved = 1` (the FK's `ON DELETE SET NULL` clears the pointer on delete) and writes one `blocker_update_activity` per row it resolved, with the blocked story as a primary resource so the story panel shows it.

Accepting a story with unresolved blockers, reviews or incomplete tasks is **not** refused — Tracker raises a client-side confirmation instead (core-model §1.2 rule 10). Record that in `spec/data-model.md` (Task 22) so step 3's UI knows the confirmation is its job.

- [ ] **Step 3: Run everything and commit**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

```bash
git add apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): blockers that resolve when the story they name is accepted

A blocker is free text; a #n in it is resolved to a story id at write time
so acceptance and deletion can clear it without re-parsing prose. Accepting
with unresolved blockers is allowed - Tracker confirms, it does not refuse.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 15: Review types and reviews

**Files:**
- Create: `apps/server/src/services/reviews.ts`, `apps/server/test/reviews.test.ts`
- Modify: `apps/server/src/services/projects.ts` (seed the four built-in types at project creation), `apps/server/src/routes/story-parts.ts`, `apps/server/src/routes/projects.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BUILT_IN_REVIEW_TYPES: readonly string[];   // ["Test (QA)", "Design", "Code", "Security"]
  export interface ReviewTypeRow { id: string; name: string; hidden: boolean; position: number }
  export interface ReviewRow { id: string; story_id: string; review_type_id: string; reviewer_id: string | null; status: ReviewStatus; created_at: number; updated_at: number }
  export function seedReviewTypes(scope: ActivityScope): void;
  export function listReviewTypes(tx: ProjectTx): ReviewTypeRow[];
  export function createReviewType(tx: ProjectTx, name: string): ReviewTypeRow;
  export function updateReviewType(tx: ProjectTx, reviewTypeId: string, patch: { name?: string; hidden?: boolean }): ReviewTypeRow;
  export function listReviews(tx: ProjectTx, storyId: string): ReviewRow[];
  export function createReview(tx: ProjectTx, storyId: string, input: { review_type_id: string; reviewer_id?: string | null; status?: ReviewStatus }): ReviewRow;
  export function updateReview(tx: ProjectTx, reviewId: string, patch: { reviewer_id?: string | null; status?: ReviewStatus }): ReviewRow;
  export function deleteReview(tx: ProjectTx, reviewId: string): void;
  ```
- Routes: `GET|POST /api/projects/:id/review_types` (`story:read` / `review-type:write`), `PUT /api/projects/:id/review_types/:reviewTypeId` (`review-type:write`), `GET|POST /api/projects/:id/stories/:storyId/reviews`, `PUT|DELETE /api/projects/:id/stories/:storyId/reviews/:reviewId` (`review:write`).

- [ ] **Step 1: Write the failing test**

Assert: a new project has exactly the four built-in types in that order; `createReviewType` refuses a duplicate name case-insensitively (`409 review_type_exists`); there is no delete route or service function at all (a type is hidden, never deleted — core-model §1.7.1), and `updateReviewType({ hidden: true })` keeps existing reviews of that type readable; a review's reviewer must be a project member (`400 reviewer_not_member`); the same (story, type, reviewer) triple cannot be created twice (`409 review_exists`); `status` outside the four values is `400 review_status_invalid`.

- [ ] **Step 2: Run it, watch it fail, implement**

`seedReviewTypes` is called from `createProject`'s bootstrap transaction, beside the owner membership insert, and writes one `review_type_create_activity` for the set rather than four rows.

- [ ] **Step 3: Run everything and commit**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

```bash
git add apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): review types and per-story reviews

Four built-in types per project, renameable and hideable but never
deletable, plus (type, reviewer, status) triples on a story.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 16: Iteration overrides

**Files:**
- Create: `apps/server/src/services/iterations.ts`, `apps/server/src/routes/iterations.ts`, `apps/server/test/iteration-overrides.test.ts`
- Modify: `apps/server/src/app.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface IterationOverrideRow { number: number; length: number | null; team_strength: number }
  export function listIterationOverrides(tx: ProjectTx): IterationOverrideRow[];
  export function putIterationOverride(tx: ProjectTx, number: number, patch: { length?: number | null; team_strength?: number }): IterationOverrideRow;
  export function deleteIterationOverride(tx: ProjectTx, number: number): void;
  ```
- Routes: `GET /api/projects/:id/iteration_overrides` (`iteration:read`), `PUT|DELETE /api/projects/:id/iteration_overrides/:number` (`iteration:override`).

**Why this table has no id.** Every other project-scoped table is keyed `(id, project_id)` so a composite foreign key can bind a child to a parent in the same project. An iteration override has no children and no identity of its own: the iteration number *is* the identity, and the iteration itself is a computation, not a row. `loadInProject` therefore does not apply here — the service reads by `(project_id, number)` explicitly, which is the only exception in the schema and is recorded in `ARCHITECTURE.md` (Task 22).

- [ ] **Step 1: Write the failing test**

```ts
it("upserts by number rather than creating a second row", () => {
  withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 3, { length: 2 }));
  const row = withProject(db, owner, projectId, "iteration:override", (tx) =>
    putIterationOverride(tx, 3, { team_strength: 0.5 }),
  );
  expect(row).toEqual({ number: 3, length: 2, team_strength: 0.5 });
  expect(withProject(db, owner, projectId, "iteration:read", (tx) => listIterationOverrides(tx))).toHaveLength(1);
});

it("accepts a length of 1 to 99 and refuses anything else", () => {
  expect(() => withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 1, { length: 99 }))).not.toThrow();
  expect(() => withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 2, { length: 100 }))).toThrow(
    /length_invalid/,
  );
});

it("treats a null length as back to the project default", () => {
  withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 4, { length: 3 }));
  const row = withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 4, { length: null }));
  expect(row.length).toBeNull();
});

it("refuses iteration number zero and negatives", () => {
  expect(() => withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 0, { length: 1 }))).toThrow(
    /iteration_number_invalid/,
  );
});

it("records the activity Tracker records, with 'default' as the pre-override length", () => {
  withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 5, { length: 2 }));
  const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
  const last = rows[rows.length - 1]!;
  expect(last.kind).toBe("iteration_update_activity");
  expect(last.changes[0]!.kind).toBe("iteration_override");
  expect(last.changes[0]!.original_values).toEqual({ number: 5, length: "default", team_strength: 1 });
  expect(last.changes[0]!.new_values).toEqual({ number: 5, length: 2, team_strength: 1 });
});
```

The `"default"` sentinel is Tracker's own, straight from the worked example in core-model §5.1. The derived `finish` that its example also carries is deliberately **not** reproduced (Assumption 4).

- [ ] **Step 2: Run it, watch it fail, implement, run, commit**

Run: `cd apps/server && bun test test/iteration-overrides.test.ts`
Expected: FAIL, then PASS.

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

```bash
git add apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): iteration overrides

The only stored iteration data: length and team strength keyed by iteration
number. No iteration rows, no finalize step, no rollover.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 17: `packages/core/src/iterations.ts` — derived iteration windows

**Files:**
- Create: `packages/core/src/iterations.ts`, `packages/core/src/iterations.test.ts`, `spec/fixtures/iterations.json`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `./dates` (`parseDateOnly`, `formatDateOnly`, `isoWeekday`, `addDays`, `MS_PER_DAY`).
- Produces:
  ```ts
  export interface IterationOverride { number: number; length: number | null; teamStrength: number }
  export interface IterationCalendar {
    startDate: string;        // YYYY-MM-DD, falls on weekStartDay
    weekStartDay: number;     // ISO 1..7, 1 = Monday
    iterationLength: number;  // weeks, 1..4
    timeZone: string;         // IANA
    overrides: readonly IterationOverride[];
  }
  export interface IterationWindow {
    number: number;
    start: string;            // YYYY-MM-DD, inclusive
    finish: string;           // YYYY-MM-DD, EXCLUSIVE: the next window's start
    lengthInWeeks: number;
    teamStrength: number;
    startMs: number;          // midnight in the project zone
    finishMs: number;
  }
  export function zoneOffsetMs(instantMs: number, timeZone: string): number;
  export function zonedMidnightMs(date: string, timeZone: string): number;
  export function zonedDateOf(instantMs: number, timeZone: string): string;
  export function iterationWindows(calendar: IterationCalendar, throughNumber: number): IterationWindow[];
  export function iterationNumberAt(calendar: IterationCalendar, instantMs: number): number;
  export function currentIterationNumber(calendar: IterationCalendar, nowMs: number): number;
  ```
  `finish` is exclusive so `start <= t < finish` is the whole membership test and no day belongs to two iterations. Tracker's API serializes `finish` as a datetime equal to the next start, which is the same fact.

- [ ] **Step 1: Write the golden fixture**

Create `spec/fixtures/iterations.json`:

```json
{
  "_comment": "Golden fixture for derived iteration windows (docs/reference/tracker-notes/core-model.md sections 2.3 and 3.2). finish is EXCLUSIVE. 2026-09-14 and 2026-01-05 are Mondays; 2026-03-08 is the US DST spring-forward Sunday and 2026-11-01 the fall-back Sunday.",
  "cases": [
    {
      "name": "one-week iterations from a Monday, UTC",
      "calendar": { "start_date": "2026-09-14", "week_start_day": 1, "iteration_length": 1, "time_zone": "UTC", "overrides": [] },
      "through": 3,
      "expected": [
        { "number": 1, "start": "2026-09-14", "finish": "2026-09-21", "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "start": "2026-09-21", "finish": "2026-09-28", "length_in_weeks": 1, "team_strength": 1 },
        { "number": 3, "start": "2026-09-28", "finish": "2026-10-05", "length_in_weeks": 1, "team_strength": 1 }
      ]
    },
    {
      "name": "two-week iterations",
      "calendar": { "start_date": "2026-01-05", "week_start_day": 1, "iteration_length": 2, "time_zone": "UTC", "overrides": [] },
      "through": 2,
      "expected": [
        { "number": 1, "start": "2026-01-05", "finish": "2026-01-19", "length_in_weeks": 2, "team_strength": 1 },
        { "number": 2, "start": "2026-01-19", "finish": "2026-02-02", "length_in_weeks": 2, "team_strength": 1 }
      ]
    },
    {
      "name": "an override lengthens one iteration and shifts every later boundary",
      "calendar": {
        "start_date": "2026-09-14", "week_start_day": 1, "iteration_length": 1, "time_zone": "UTC",
        "overrides": [{ "number": 2, "length": 3, "team_strength": 0.5 }]
      },
      "through": 4,
      "expected": [
        { "number": 1, "start": "2026-09-14", "finish": "2026-09-21", "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "start": "2026-09-21", "finish": "2026-10-12", "length_in_weeks": 3, "team_strength": 0.5 },
        { "number": 3, "start": "2026-10-12", "finish": "2026-10-19", "length_in_weeks": 1, "team_strength": 1 },
        { "number": 4, "start": "2026-10-19", "finish": "2026-10-26", "length_in_weeks": 1, "team_strength": 1 }
      ]
    },
    {
      "name": "a team-strength-only override does not move a boundary",
      "calendar": {
        "start_date": "2026-09-14", "week_start_day": 1, "iteration_length": 1, "time_zone": "UTC",
        "overrides": [{ "number": 1, "length": null, "team_strength": 0 }]
      },
      "through": 2,
      "expected": [
        { "number": 1, "start": "2026-09-14", "finish": "2026-09-21", "length_in_weeks": 1, "team_strength": 0 },
        { "number": 2, "start": "2026-09-21", "finish": "2026-09-28", "length_in_weeks": 1, "team_strength": 1 }
      ]
    },
    {
      "name": "a Sunday week start",
      "calendar": { "start_date": "2026-09-13", "week_start_day": 7, "iteration_length": 1, "time_zone": "UTC", "overrides": [] },
      "through": 2,
      "expected": [
        { "number": 1, "start": "2026-09-13", "finish": "2026-09-20", "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "start": "2026-09-20", "finish": "2026-09-27", "length_in_weeks": 1, "team_strength": 1 }
      ]
    },
    {
      "name": "iterations stay seven wall days long across a DST spring forward",
      "calendar": { "start_date": "2026-03-02", "week_start_day": 1, "iteration_length": 1, "time_zone": "America/New_York", "overrides": [] },
      "through": 2,
      "expected": [
        { "number": 1, "start": "2026-03-02", "finish": "2026-03-09", "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "start": "2026-03-09", "finish": "2026-03-16", "length_in_weeks": 1, "team_strength": 1 }
      ]
    },
    {
      "name": "iterations stay seven wall days long across a DST fall back",
      "calendar": { "start_date": "2026-10-26", "week_start_day": 1, "iteration_length": 1, "time_zone": "America/New_York", "overrides": [] },
      "through": 2,
      "expected": [
        { "number": 1, "start": "2026-10-26", "finish": "2026-11-02", "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "start": "2026-11-02", "finish": "2026-11-09", "length_in_weeks": 1, "team_strength": 1 }
      ]
    }
  ],
  "number_at": [
    {
      "name": "midnight in the project zone belongs to the new iteration, not the old one",
      "calendar": { "start_date": "2026-09-14", "week_start_day": 1, "iteration_length": 1, "time_zone": "Asia/Tokyo", "overrides": [] },
      "cases": [
        { "at": "2026-09-14T00:00:00+09:00", "expected": 1 },
        { "at": "2026-09-20T23:59:59+09:00", "expected": 1 },
        { "at": "2026-09-21T00:00:00+09:00", "expected": 2 },
        { "at": "2026-09-20T15:00:00Z", "expected": 2 },
        { "at": "2026-09-13T00:00:00+09:00", "expected": 1 }
      ]
    }
  ]
}
```

The last `number_at` row is the deliberate floor: an instant *before* the project start still reports iteration 1, so a story accepted before the recorded start date lands in the first iteration (core-model §2.3.2 — Tracker's own `start_time` does the same thing by moving the start earlier).

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/iterations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fixture from "../../../spec/fixtures/iterations.json";
import { currentIterationNumber, iterationNumberAt, iterationWindows, zonedDateOf, zonedMidnightMs } from "./iterations";

const calendarOf = (raw: (typeof fixture.cases)[number]["calendar"]) => ({
  startDate: raw.start_date,
  weekStartDay: raw.week_start_day,
  iterationLength: raw.iteration_length,
  timeZone: raw.time_zone,
  overrides: raw.overrides.map((o) => ({ number: o.number, length: o.length, teamStrength: o.team_strength })),
});

describe("iterationWindows (spec/fixtures/iterations.json)", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const windows = iterationWindows(calendarOf(testCase.calendar), testCase.through);
      expect(
        windows.map((w) => ({
          number: w.number,
          start: w.start,
          finish: w.finish,
          length_in_weeks: w.lengthInWeeks,
          team_strength: w.teamStrength,
        })),
      ).toEqual(testCase.expected);
    });
  }
});

describe("iterationNumberAt (spec/fixtures/iterations.json)", () => {
  for (const group of fixture.number_at) {
    const calendar = calendarOf(group.calendar);
    for (const testCase of group.cases) {
      it(`${group.name}: ${testCase.at}`, () => {
        expect(iterationNumberAt(calendar, Date.parse(testCase.at))).toBe(testCase.expected);
      });
    }
  }
});

describe("zone arithmetic", () => {
  it("resolves a wall date to midnight in the project zone", () => {
    expect(zonedMidnightMs("2026-09-14", "UTC")).toBe(Date.parse("2026-09-14T00:00:00Z"));
    expect(zonedMidnightMs("2026-09-14", "Asia/Tokyo")).toBe(Date.parse("2026-09-13T15:00:00Z"));
    expect(zonedMidnightMs("2026-01-14", "America/New_York")).toBe(Date.parse("2026-01-14T05:00:00Z"));
  });

  it("reads an instant back as the wall date of the project zone", () => {
    expect(zonedDateOf(Date.parse("2026-09-13T15:00:00Z"), "Asia/Tokyo")).toBe("2026-09-14");
    expect(zonedDateOf(Date.parse("2026-09-13T14:59:59Z"), "Asia/Tokyo")).toBe("2026-09-13");
  });

  it("puts the current number at the window containing now", () => {
    const calendar = calendarOf(fixture.cases[0]!.calendar);
    expect(currentIterationNumber(calendar, Date.parse("2026-09-29T10:00:00Z"))).toBe(3);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd packages/core && pnpm exec vitest run src/iterations.test.ts`
Expected: FAIL — "Failed to resolve import ./iterations".

- [ ] **Step 4: Write the module**

```ts
import { addDays, formatDateOnly, parseDateOnly } from "./dates";

export interface IterationOverride { number: number; length: number | null; teamStrength: number }

export interface IterationCalendar {
  startDate: string;
  weekStartDay: number;
  iterationLength: number;
  timeZone: string;
  overrides: readonly IterationOverride[];
}

export interface IterationWindow {
  number: number;
  start: string;
  finish: string;
  lengthInWeeks: number;
  teamStrength: number;
  startMs: number;
  finishMs: number;
}

/**
 * The zone's offset at a given instant, via Intl rather than a tz database of our own. Positive
 * east of UTC.
 */
export function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const at = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  // "24" is how hourCycle h23 can render midnight in some environments.
  const asUtc = Date.UTC(at("year"), at("month") - 1, at("day"), at("hour") % 24, at("minute"), at("second"));
  return asUtc - instantMs;
}

/**
 * Two passes: the first offset is read at the naive instant, which is wrong by up to an hour on a
 * DST boundary; re-reading it at the corrected instant fixes that. A third pass cannot change the
 * answer, because the second reading is already inside the correct offset period.
 */
export function zonedMidnightMs(date: string, timeZone: string): number {
  const naive = parseDateOnly(date);
  const guess = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(guess, timeZone);
}

export function zonedDateOf(instantMs: number, timeZone: string): string {
  return formatDateOnly(instantMs + zoneOffsetMs(instantMs, timeZone));
}

function lengthOf(calendar: IterationCalendar, number: number): { length: number; teamStrength: number } {
  const override = calendar.overrides.find((o) => o.number === number);
  return {
    length: override?.length ?? calendar.iterationLength,
    teamStrength: override?.teamStrength ?? 1,
  };
}

/**
 * Walks forward from the project start. An override's length shifts every later boundary
 * (core-model §3.2 rule 2), so windows cannot be computed by arithmetic from the number alone.
 */
export function iterationWindows(calendar: IterationCalendar, throughNumber: number): IterationWindow[] {
  const windows: IterationWindow[] = [];
  let start = calendar.startDate;
  for (let number = 1; number <= throughNumber; number++) {
    const { length, teamStrength } = lengthOf(calendar, number);
    const finish = addDays(start, length * 7);
    windows.push({
      number,
      start,
      finish,
      lengthInWeeks: length,
      teamStrength,
      startMs: zonedMidnightMs(start, calendar.timeZone),
      finishMs: zonedMidnightMs(finish, calendar.timeZone),
    });
    start = finish;
  }
  return windows;
}

/**
 * The iteration containing an instant. An instant before the project start reports 1: a story
 * accepted earlier belongs to the first iteration rather than to no iteration at all.
 */
export function iterationNumberAt(calendar: IterationCalendar, instantMs: number): number {
  let start = calendar.startDate;
  let number = 1;
  // Bounded so a corrupt calendar cannot spin: 4000 one-week iterations is ~77 years.
  for (let guard = 0; guard < 4000; guard++) {
    const { length } = lengthOf(calendar, number);
    const finish = addDays(start, length * 7);
    if (instantMs < zonedMidnightMs(finish, calendar.timeZone)) return number;
    start = finish;
    number += 1;
  }
  return number;
}

export function currentIterationNumber(calendar: IterationCalendar, nowMs: number): number {
  return iterationNumberAt(calendar, nowMs);
}
```

- [ ] **Step 5: Run the test**

Run: `cd packages/core && pnpm exec vitest run src/iterations.test.ts`
Expected: PASS (all fixture cases plus the three zone-arithmetic tests).

- [ ] **Step 6: Export and commit**

Add `export * from "./iterations";` to `packages/core/src/index.ts`.

Run: `pnpm --filter @storylane/core test`
Expected: PASS.

```bash
git add packages/core/src spec/fixtures/iterations.json
```

```bash
git commit -m "$(cat <<'MSG'
feat(core): derived iteration windows

Iterations are a read-time computation from start date, week start day,
length and time zone, with overrides shifting every later boundary. Midnight
is midnight in the project zone, which is why the module carries its own
Intl-based offset arithmetic rather than assuming UTC.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 18: `packages/core/src/velocity.ts` — Tracker's published formula

**Files:**
- Create: `packages/core/src/velocity.ts`, `packages/core/src/velocity.test.ts`, `spec/fixtures/velocity.json`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DoneIteration { number: number; acceptedPoints: number; lengthInWeeks: number; teamStrength: number }
  export interface VelocityInput {
    doneIterations: readonly DoneIteration[];   // oldest first
    velocityAveragedOver: number;               // 1..4
    defaultIterationLength: number;             // weeks
    initialVelocity: number;
  }
  export function projectVelocity(input: VelocityInput): number;
  export function velocityVolatility(input: VelocityInput): number;   // relative standard deviation, %
  ```

**The formula** (core-model §3.3): `SUM(points / team_strength) / SUM(length_in_weeks)` over the selected iterations, excluding iterations with team strength 0 from *both* sums, multiplied by the project's default iteration length and floored. `initial_velocity` applies while no completed iteration exists, and again once the run of consecutive zero-point iterations reaches `velocity_averaged_over` (§3.3 rule 4). The selection is the most recent `velocity_averaged_over` iterations *after* dropping zero-strength ones.

- [ ] **Step 1: Write the golden fixture**

Create `spec/fixtures/velocity.json`:

```json
{
  "_comment": "Golden fixture for Tracker's published velocity formula (docs/reference/tracker-notes/core-model.md section 3.3). done_iterations are oldest first.",
  "cases": [
    {
      "name": "no completed iteration yet falls back to the initial velocity",
      "done_iterations": [],
      "velocity_averaged_over": 3, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 10
    },
    {
      "name": "a plain three-iteration average",
      "done_iterations": [
        { "number": 1, "accepted_points": 6, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "accepted_points": 9, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 3, "accepted_points": 12, "length_in_weeks": 1, "team_strength": 1 }
      ],
      "velocity_averaged_over": 3, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 9
    },
    {
      "name": "only the most recent N iterations count",
      "done_iterations": [
        { "number": 1, "accepted_points": 100, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "accepted_points": 6, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 3, "accepted_points": 8, "length_in_weeks": 1, "team_strength": 1 }
      ],
      "velocity_averaged_over": 2, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 7
    },
    {
      "name": "a ratio of sums, not an average of ratios: a long iteration weighs more",
      "done_iterations": [
        { "number": 1, "accepted_points": 20, "length_in_weeks": 2, "team_strength": 1 },
        { "number": 2, "accepted_points": 4, "length_in_weeks": 1, "team_strength": 1 }
      ],
      "velocity_averaged_over": 2, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 8
    },
    {
      "name": "half strength inflates the contribution",
      "done_iterations": [{ "number": 1, "accepted_points": 5, "length_in_weeks": 1, "team_strength": 0.5 }],
      "velocity_averaged_over": 1, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 10
    },
    {
      "name": "over strength deflates it",
      "done_iterations": [{ "number": 1, "accepted_points": 10, "length_in_weeks": 1, "team_strength": 2 }],
      "velocity_averaged_over": 1, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 5
    },
    {
      "name": "zero strength drops the iteration from both sums and reaches further back",
      "done_iterations": [
        { "number": 1, "accepted_points": 8, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "accepted_points": 0, "length_in_weeks": 1, "team_strength": 0 },
        { "number": 3, "accepted_points": 4, "length_in_weeks": 1, "team_strength": 1 }
      ],
      "velocity_averaged_over": 2, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 6
    },
    {
      "name": "the displayed value scales by the project's default iteration length",
      "done_iterations": [
        { "number": 1, "accepted_points": 10, "length_in_weeks": 2, "team_strength": 1 },
        { "number": 2, "accepted_points": 14, "length_in_weeks": 2, "team_strength": 1 }
      ],
      "velocity_averaged_over": 2, "default_iteration_length": 2, "initial_velocity": 10,
      "expected": 12
    },
    {
      "name": "the result is floored, never rounded",
      "done_iterations": [
        { "number": 1, "accepted_points": 5, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "accepted_points": 6, "length_in_weeks": 1, "team_strength": 1 }
      ],
      "velocity_averaged_over": 2, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 5
    },
    {
      "name": "a run of zero-point iterations as long as the strategy falls back to the initial velocity",
      "done_iterations": [
        { "number": 1, "accepted_points": 30, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "accepted_points": 0, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 3, "accepted_points": 0, "length_in_weeks": 1, "team_strength": 1 }
      ],
      "velocity_averaged_over": 2, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 10
    },
    {
      "name": "a shorter run of zero-point iterations does not",
      "done_iterations": [
        { "number": 1, "accepted_points": 30, "length_in_weeks": 1, "team_strength": 1 },
        { "number": 2, "accepted_points": 0, "length_in_weeks": 1, "team_strength": 1 }
      ],
      "velocity_averaged_over": 3, "default_iteration_length": 1, "initial_velocity": 10,
      "expected": 15
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`packages/core/src/velocity.test.ts` iterates `fixture.cases` exactly the way Task 17's test iterates its own, mapping snake_case to camelCase, plus two hand-written cases for `velocityVolatility`: an unvarying history is `0`, and `[4, 8]` over one-week full-strength iterations is `33` (the relative standard deviation of the per-iteration velocities, floored).

- [ ] **Step 3: Run it, watch it fail, then write the module**

```ts
export interface DoneIteration { number: number; acceptedPoints: number; lengthInWeeks: number; teamStrength: number }

export interface VelocityInput {
  doneIterations: readonly DoneIteration[];
  velocityAveragedOver: number;
  defaultIterationLength: number;
  initialVelocity: number;
}

/** Zero strength excludes an iteration entirely — from the numerator and the denominator both. */
function selected(input: VelocityInput): DoneIteration[] {
  const window = Math.max(1, Math.floor(input.velocityAveragedOver));
  return input.doneIterations.filter((i) => i.teamStrength > 0).slice(-window);
}

export function projectVelocity(input: VelocityInput): number {
  const window = selected(input);
  if (window.length === 0) return input.initialVelocity;
  // A team that has accepted nothing for as many iterations as the strategy covers has no
  // measured velocity left to average, so the initial value takes over again (§3.3 rule 4).
  if (window.length >= Math.max(1, Math.floor(input.velocityAveragedOver)) && window.every((i) => i.acceptedPoints === 0)) {
    return input.initialVelocity;
  }
  const points = window.reduce((total, i) => total + i.acceptedPoints / i.teamStrength, 0);
  const weeks = window.reduce((total, i) => total + i.lengthInWeeks, 0);
  if (weeks === 0) return input.initialVelocity;
  return Math.floor((points / weeks) * input.defaultIterationLength);
}

/** Relative standard deviation of the per-iteration velocities, as a whole-number percentage. */
export function velocityVolatility(input: VelocityInput): number {
  const window = selected(input);
  if (window.length < 2) return 0;
  const rates = window.map((i) => (i.acceptedPoints / i.teamStrength / i.lengthInWeeks) * input.defaultIterationLength);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean === 0) return 0;
  const variance = rates.reduce((total, r) => total + (r - mean) ** 2, 0) / rates.length;
  return Math.floor((Math.sqrt(variance) / mean) * 100);
}
```

- [ ] **Step 4: Run, export, commit**

Run: `cd packages/core && pnpm exec vitest run src/velocity.test.ts`
Expected: PASS (11 fixture cases + 2 volatility cases).

Add `export * from "./velocity";` to `packages/core/src/index.ts`.

```bash
git add packages/core/src spec/fixtures/velocity.json
```

```bash
git commit -m "$(cat <<'MSG'
feat(core): Tracker's published velocity formula

A ratio of sums over the last N done iterations, normalized by team
strength, scaled by the default iteration length and floored. Zero-strength
iterations drop out of both sums; a run of empty iterations as long as the
strategy falls back to the initial velocity.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 19: `packages/core/src/planning.ts` — the Current / Backlog cut

**Files:**
- Create: `packages/core/src/planning.ts`, `packages/core/src/planning.test.ts`, `spec/fixtures/planning.json`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `./story` (`StoryState`, `StoryType`).
- Produces:
  ```ts
  export interface PlannableStory { id: string; estimate: number | null; storyType: StoryType; currentState: StoryState }
  export interface PlanInput {
    /** The backlog list in position order — Current is its head, not a separate list. */
    stories: readonly PlannableStory[];
    currentIterationNumber: number;
    /** Points available per iteration; index 0 is Current. Derived from velocity, length and team strength. */
    capacities: readonly number[];
    automaticPlanning: boolean;
  }
  export interface PlannedIteration { number: number; storyIds: string[]; points: number }
  export interface Plan { current: PlannedIteration; future: PlannedIteration[]; unplanned: string[] }
  export function planIterations(input: PlanInput): Plan;
  export function iterationCapacity(velocity: number, lengthInWeeks: number, defaultIterationLength: number, teamStrength: number): number;
  ```

**The rules** (core-model §3.4, resolved by Assumption 1):

- `started`, `finished`, `delivered`, `accepted` and `rejected` stories are in Current wherever they sit in the list, and they consume its capacity. `accepted` stories stay in Current until the iteration rolls over; Done is a separate view keyed on `accepted_at`.
- Current then takes stories from the head of the remaining list: an **estimated** story while the running total is `< capacity`, an **unestimated** one while the total is `<= capacity`. The first refusal ends Current.
- Each future iteration takes only what fits: a story joins while `total + estimate <= capacity`. A story whose estimate alone exceeds the capacity takes an iteration by itself rather than being skipped.
- Unestimated stories in future iterations consume 0 points and always fit.
- With `automaticPlanning` false, Current is exactly the in-progress/accepted set plus the `planned` stories, in list order; the future iterations are still planned automatically from the rest.
- `unplanned` holds whatever is left once `capacities` runs out.

- [ ] **Step 1: Write the golden fixture**

Create `spec/fixtures/planning.json` with these cases (each `stories` entry is `{ id, estimate, story_type, current_state }`, each case carries `capacities`, `automatic_planning`, `current_iteration_number` and the expected `current` / `future` / `unplanned`):

1. `"current keeps taking while the running total is below velocity, then stops"` — capacities `[8]`, estimates `5, 2, 3, 1`, all `unstarted`. `a` joins at total 0, `b` at 5, `c` at 7 (still below 8, so it is admitted and carries the total to 10); `d` is refused because the total is no longer below 8. Expected `current.storyIds = ["a","b","c"]`, `current.points = 10`, `future`/`unplanned` holding `d`.
2. `"an unestimated chore still joins current at exactly velocity"` — capacities `[8]`, a 5 and a 3 (total 8) followed by an unestimated chore: the chore joins (8 ≤ 8), the next estimated story does not.
3. `"started work consumes current capacity even from far down the list"` — a `started` 13-point story sitting fifth in the list is in Current, and Current admits nothing after it.
4. `"accepted stories stay in current"` — an `accepted` story is in `current.storyIds` and its points count.
5. `"future iterations take only what fits"` — capacities `[0, 8, 8]`, estimates `5, 5, 3`: iteration 2 is `[5]`, iteration 3 is `[5, 3]`.
6. `"a story larger than one iteration gets an iteration to itself"` — capacities `[0, 8, 8]`, estimates `13, 2`: iteration 2 is `[13]`, iteration 3 is `[2]`.
7. `"unestimated stories cost nothing in a future iteration"` — capacities `[0, 3]`, an unestimated bug then a 3: both land in iteration 2.
8. `"manual planning puts only in-progress and planned stories in current"` — `automatic_planning: false`, one `started`, one `planned`, three `unstarted`: Current is the started and the planned one; the unstarted ones are planned into the future iterations.
9. `"what does not fit in the given capacities is unplanned"` — capacities `[8]`, four estimated stories: the overflow is listed in `unplanned`.
10. `"zero velocity plans nothing into current but still fills future iterations"` — capacities `[0, 5]`.

- [ ] **Step 2: Write the failing test, run it, then write the module**

`packages/core/src/planning.test.ts` iterates the fixture the same way Tasks 17–18 do.

```ts
const IN_CURRENT: readonly StoryState[] = ["started", "finished", "delivered", "accepted", "rejected"];

export function iterationCapacity(
  velocity: number,
  lengthInWeeks: number,
  defaultIterationLength: number,
  teamStrength: number,
): number {
  return (velocity / defaultIterationLength) * lengthInWeeks * teamStrength;
}

export function planIterations(input: PlanInput): Plan {
  const capacity = input.capacities[0] ?? 0;
  const current: PlannedIteration = { number: input.currentIterationNumber, storyIds: [], points: 0 };
  const remaining: PlannableStory[] = [];
  const claimed = new Set<string>();

  // In-progress work is in Current wherever it sits, and it consumes capacity (Assumption 1).
  for (const story of input.stories) {
    if (IN_CURRENT.includes(story.currentState) || (!input.automaticPlanning && story.currentState === "planned")) {
      current.storyIds.push(story.id);
      current.points += story.estimate ?? 0;
      claimed.add(story.id);
    }
  }
  for (const story of input.stories) if (!claimed.has(story.id)) remaining.push(story);

  let index = 0;
  if (input.automaticPlanning) {
    // The asymmetric rule: an estimated story needs room *before* it, an unestimated one only
    // needs the total not to have passed capacity yet. The first refusal ends Current, which is
    // therefore always a prefix of what is left.
    while (index < remaining.length) {
      const story = remaining[index]!;
      const admits = story.estimate === null ? current.points <= capacity : current.points < capacity;
      if (!admits) break;
      current.storyIds.push(story.id);
      current.points += story.estimate ?? 0;
      index += 1;
    }
  }

  const future: PlannedIteration[] = [];
  for (let offset = 1; offset < input.capacities.length; offset++) {
    const room = input.capacities[offset]!;
    const iteration: PlannedIteration = { number: input.currentIterationNumber + offset, storyIds: [], points: 0 };
    while (index < remaining.length) {
      const story = remaining[index]!;
      const cost = story.estimate ?? 0;
      // Strict fit, unlike Current. The one exception keeps an oversize story from stalling the
      // whole backlog: alone in an empty iteration it is planned anyway.
      const fits = iteration.points + cost <= room || (iteration.storyIds.length === 0 && cost > room);
      if (!fits) break;
      iteration.storyIds.push(story.id);
      iteration.points += cost;
      index += 1;
    }
    future.push(iteration);
  }

  return { current, future, unplanned: remaining.slice(index).map((s) => s.id) };
}
```

- [ ] **Step 3: Run, export, commit**

Run: `cd packages/core && pnpm exec vitest run src/planning.test.ts`
Expected: PASS (10 fixture cases).

Add `export * from "./planning";` to `packages/core/src/index.ts`.

```bash
git add packages/core/src spec/fixtures/planning.json
```

```bash
git commit -m "$(cat <<'MSG'
feat(core): the automatic-planning cut

Current is the head of the backlog list, filled by Tracker's asymmetric
overflow rule; future iterations take only what fits. The remaining
unknowns from the reference note - whether in-progress work consumes
capacity, and what happens to a story bigger than an iteration - are
decided here and recorded as assumptions in the plan and in spec/velocity.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 20: Serve derived iterations, velocity and the planned cut

**Files:**
- Modify: `apps/server/src/services/iterations.ts`, `apps/server/src/routes/iterations.ts`, `apps/server/src/services/projects.ts`, `apps/server/src/authz/route-manifest.ts`, `apps/server/test/matrix-fixtures.ts`
- Create: `apps/server/test/iterations.test.ts`

**Interfaces:**
- Consumes: Tasks 17–19's `iterationWindows`, `iterationNumberAt`, `currentIterationNumber`, `projectVelocity`, `velocityVolatility`, `planIterations`, `iterationCapacity`.
- Produces:
  ```ts
  export interface IterationRow {
    number: number; start: string; finish: string; length: number; team_strength: number;
    story_ids: string[]; points: number; accepted_points: number; effective_points: number; velocity: number;
  }
  export type IterationScope = "done" | "current" | "backlog" | "current_backlog" | "done_current";
  export function readCalendar(tx: ProjectTx): IterationCalendar;
  export function listIterations(tx: ProjectTx, opts: { scope?: IterationScope; offset?: number; limit?: number; now?: number }): IterationRow[];
  export function readVelocity(tx: ProjectTx, now?: number): { current_velocity: number; current_volatility: number; current_iteration_number: number };
  ```
- Route added: `GET /api/projects/:id/iterations` (`iteration:read`). `readProject` (Task 7) replaces its placeholder `current_iteration_number: 1` with `readVelocity(tx).current_iteration_number` and gains `current_velocity` / `current_volatility`.

**How the three pieces compose.** `readCalendar` reads the project row and its overrides. Done iterations are the windows before the current number; each one's `accepted_points` is `SUM(estimate)` over stories whose `accepted_at` falls in the window (`start_ms <= accepted_at < finish_ms`) — one query with a `CASE` per window is wrong at scale, so read every accepted story's `(estimate, accepted_at)` once and bucket them in TypeScript with `iterationNumberAt`. `projectVelocity` turns those into the number; `iterationCapacity` turns the number into per-iteration capacities; `planIterations` cuts the backlog list. Nothing is stored.

- [ ] **Step 1: Write the failing test**

`apps/server/test/iterations.test.ts`:

```ts
it("puts an accepted story in the iteration its accepted_at falls in", () => {
  // The project starts 2026-09-14 (Monday, UTC, one-week iterations) — see seedProject.
  const storyId = seedStory(db, projectId, { list: "backlog", currentState: "delivered", estimate: 3 });
  withProject(db, owner, projectId, "story:write", (tx) => updateStory(tx, storyId, { current_state: "accepted" }));
  db.$client.run("update stories set accepted_at = ? where id = ?", [Date.parse("2026-09-23T09:00:00Z"), storyId]);
  const done = withProject(db, owner, projectId, "iteration:read", (tx) =>
    listIterations(tx, { scope: "done", now: Date.parse("2026-10-05T09:00:00Z") }),
  );
  const second = done.find((i) => i.number === 2)!;
  expect(second.accepted_points).toBe(3);
  expect(second.story_ids).toEqual([storyId]);
});

it("reports the initial velocity before any iteration has finished", () => {
  const v = withProject(db, owner, projectId, "iteration:read", (tx) =>
    readVelocity(tx, Date.parse("2026-09-15T09:00:00Z")),
  );
  expect(v.current_velocity).toBe(10);
  expect(v.current_iteration_number).toBe(1);
});

it("cuts current from the head of the backlog list using the velocity", () => {
  // Three 5-point stories, velocity 10 (the initial value) -> current takes all three:
  // 0 < 10, 5 < 10, 10 is not < 10 ... so the third is refused.
  const ids = [5, 5, 5].map((estimate) =>
    seedStory(db, projectId, { list: "backlog", currentState: "unstarted", estimate }),
  );
  const [current] = withProject(db, owner, projectId, "iteration:read", (tx) =>
    listIterations(tx, { scope: "current", now: Date.parse("2026-09-15T09:00:00Z") }),
  );
  expect(current!.story_ids).toEqual([ids[0]!, ids[1]!]);
  expect(current!.points).toBe(10);
});

it("keeps an override's length and team strength on the window it names", () => {
  withProject(db, owner, projectId, "iteration:override", (tx) => putIterationOverride(tx, 1, { length: 2, team_strength: 0.5 }));
  const [first] = withProject(db, owner, projectId, "iteration:read", (tx) =>
    listIterations(tx, { scope: "current_backlog", now: Date.parse("2026-09-15T09:00:00Z") }),
  );
  expect(first!.length).toBe(2);
  expect(first!.team_strength).toBe(0.5);
  expect(first!.finish).toBe("2026-09-28");
});

it("returns done iterations oldest first and honours a negative offset as 'back from current'", () => {
  // core-model §3.1: for scope=done a negative offset counts back from Current.
  const rows = withProject(db, owner, projectId, "iteration:read", (tx) =>
    listIterations(tx, { scope: "done", offset: -2, now: Date.parse("2026-10-12T09:00:00Z") }),
  );
  expect(rows.map((r) => r.number)).toEqual([3, 4]);
});
```

- [ ] **Step 2: Run it, watch it fail, implement**

Run: `cd apps/server && bun test test/iterations.test.ts`
Expected: FAIL — `listIterations` / `readVelocity` are not exported.

`now` is a parameter with a `Date.now()` default so every test is deterministic; no other part of the service reads the clock.

- [ ] **Step 3: Route, manifest, fixture**

```ts
"GET /api/projects/:id/iterations": "iteration:read",
```
with a query string of `?scope=current_backlog` in the matrix fixture (a `GET` needs no body).

- [ ] **Step 4: Fill in the project settings placeholder**

In `services/projects.ts` `readProject`, replace `current_iteration_number: 1` with the real call and add the two derived fields:

```ts
const derived = readVelocity(tx);
return { ...row, current_iteration_number: derived.current_iteration_number, current_velocity: derived.current_velocity, current_volatility: derived.current_volatility };
```
Extend `ProjectSettings` with `current_velocity: number` and `current_volatility: number`, and update the Task 7 settings test to assert `current_velocity === 10` on a fresh project.

- [ ] **Step 5: Run everything and commit**

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

Run: `pnpm --filter @storylane/server lint`
Expected: no errors.

```bash
git add apps/server/src apps/server/test
```

```bash
git commit -m "$(cat <<'MSG'
feat(server): iterations, velocity and the planned cut, all derived on read

No iteration rows and no rollover: the windows come from the project
calendar, an accepted story belongs to the window its accepted_at falls in,
velocity is computed from those windows, and Current is the head of the
backlog list cut by that velocity.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 21: `packages/core/src/search-query.ts` — the query parser

**Files:**
- Create: `packages/core/src/search-query.ts`, `packages/core/src/search-query.test.ts`, `spec/fixtures/search-query.json`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SEARCH_KEYWORDS = [
    "name", "label", "epic", "epics", "type", "state", "estimate", "review", "review_status", "reviewer",
    "requester", "requested_by", "owner", "owned_by", "is", "has", "no", "mywork", "includedone",
    "id", "external_id", "integration",
    "created", "created_on", "created_since", "created_after", "created_before",
    "updated", "updated_on", "modified_since", "updated_since", "updated_after", "updated_before",
    "accepted", "accepted_on", "accepted_since", "accepted_after", "accepted_before",
  ] as const;
  export type SearchKeyword = (typeof SEARCH_KEYWORDS)[number];
  export type SearchTerm =
    | { kind: "text"; value: string; negated: boolean; quoted: boolean; pattern: "none" | "glob" | "regex" }
    | { kind: "keyword"; keyword: SearchKeyword; values: string[]; negated: boolean; quoted: boolean };
  export type SearchNode =
    | { kind: "term"; term: SearchTerm }
    | { kind: "and"; left: SearchNode; right: SearchNode }
    | { kind: "or"; left: SearchNode; right: SearchNode };
  export interface ParsedQuery { root: SearchNode | null; errors: string[] }
  export function parseSearchQuery(input: string): ParsedQuery;
  ```
  The parser produces a tree only; turning it into SQL is step 5's job, which is why nothing here touches the database.

**Grammar** (core-model §6.3, all six rules):
1. Whitespace separates terms and means AND. `AND` and `OR` are explicit, share one precedence level and group **left to right**, so `a OR b c` parses as `(a OR b) AND c`. Parentheses override.
2. Any term except a date term may be negated with a leading `-`. `no:<keyword>` is the absence spelling and parses as its own keyword term, not as a negation.
3. Double quotes make an exact phrase and are required for values containing spaces, dashes, underscores or parentheses. No space is allowed between a keyword's colon and its value — `owner: me` is the free text `owner:` followed by `me`, and the parser records `keyword_value_missing` in `errors`.
4. A comma lists alternatives inside one term, accepted only for `state`, `type`, `id` and `external_id` (the article is the narrower, tested claim); a comma anywhere else is part of the value.
5. `*` and `?` are globs on a bare term; a double-quoted term is never a pattern; `/…/` is a regular expression.
6. Dates are read in the searcher's zone and need a four-digit year; relative forms are `today`, `yesterday`, and `-<n><unit>` with unit in `h|hours|d|day|days|w|weeks`. A range is `a..b`.

- [ ] **Step 1: Write the golden fixture**

Create `spec/fixtures/search-query.json`, whose `cases` each hold `query` and an `expected` tree serialized in the same shape the parser returns. Cover at least:

`type:bug`; `-type:bug`; `state:started,finished`; `label:"needs design"`; `label:""` (the unlabeled sentinel, an empty-string value, not a missing one); `estimate:-1`; `no:label`; `is:blocked`; `has:attachment`; `owner:jo epic:"Onboarding"` (two ANDed terms); `type:bug OR type:chore`; `a OR b c` → `(a OR b) AND c`; `a OR (b c)` → `a OR (b AND c)`; `review:Design&pass`; `mywork:jo`; `includedone:true`; `created_since:-2w`; `accepted:2026-01-01..2026-03-31`; `ser*ze` (glob); `"ser*ze"` (no glob); `/seriali.e/` (regex); `owner: jo` (the error case, `errors: ["keyword_value_missing"]`); `unclosed "quote` (`errors: ["unterminated_quote"]`, with the tree still built from what was readable); `label:a,b` (the comma is part of the value, because `label` is not comma-separable).

- [ ] **Step 2: Write the failing test and run it**

`packages/core/src/search-query.test.ts` iterates the fixture, asserting `parseSearchQuery(query)` deep-equals `{ root: expected.root, errors: expected.errors ?? [] }`.

Run: `cd packages/core && pnpm exec vitest run src/search-query.test.ts`
Expected: FAIL — "Failed to resolve import ./search-query".

- [ ] **Step 3: Write the parser**

A hand-written two-stage parser: a tokenizer that walks the string once (handling quotes, parentheses, `/regex/` and the leading `-`), then a recursive-descent reader over the tokens with a single binary level for `AND`/`OR` that folds left. Never a single regular expression over the whole query: a quoted value may contain any of the operators, and a regex term may contain spaces.

Refusals are collected in `errors` rather than thrown — the search panel (step 5) shows what it understood plus what it could not, and a throw would leave the user with nothing.

- [ ] **Step 4: Run, export, commit**

Run: `cd packages/core && pnpm exec vitest run src/search-query.test.ts`
Expected: PASS (every fixture case).

Run: `pnpm --filter @storylane/core test`
Expected: PASS.

Add `export * from "./search-query";` to `packages/core/src/index.ts`.

```bash
git add packages/core/src spec/fixtures/search-query.json
```

```bash
git commit -m "$(cat <<'MSG'
feat(core): the Tracker search query parser

The full operator list from the reference note, producing a tree. Turning
the tree into SQL is step 5's job; parsing it is settled now so the model
and the panel cannot disagree later about what a query means.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Task 22: Rewrite the spec and the agent context to match the model

**Files:**
- Rewrite: `spec/data-model.md`, `spec/velocity.md`
- Modify: `ARCHITECTURE.md` (the hook-injected invariants above `<!-- hook:end -->`), `CLAUDE.md`, `REVIEW.md`, `SPEC.md` (the index), `spec/glossary.md`
- Backlog: one decision, created through the CLI

**Interfaces:**
- Consumes: everything Tasks 5–21 built. This task adds no code.
- Produces: a `spec/` that describes the shipped model and agent context that never names a deleted table.

- [ ] **Step 1: Rewrite `spec/data-model.md`**

One section per table in the Task 5 order, each stating its columns, its CHECKs and its guard triggers, plus three sections that are not tables:

- **"Assumptions"** — the twelve numbered decisions from this plan's Assumptions section, each with the `core-model.md` §9 item it resolves, so a later corpus find can overturn one deliberately.
- **"Divergences from Tracker"** — the account layer, public projects, billing, workspaces, third-party integrations, Google attachments, Atom feeds, incoming email, 2FA/SAML/SCIM (`core-model.md` §10), each with one line saying why a single self-hosted container does not carry it.
- **"Deferred"** — saved searches (step 7), analytics rollups (step 9), integrations and notifications (step 10), manual iteration markers (step 4), the two extra priority visibility flags (step 8).

Delete every paragraph about `project_states`, categories, containers, person-day capacity and rollover. Each section header states whether it is rewritten for the Tracker model or still pending (design §6's accepted trade-off).

Include the sentence that step 3's UI depends on: accepting a story with unresolved blockers, incomplete tasks or pending reviews is **allowed** by the API; the confirmation is the client's.

- [ ] **Step 2: Rewrite `spec/velocity.md`**

The derived model end to end: iteration windows from start date / week start day / length / time zone; overrides; the published velocity formula with the worked examples from `spec/fixtures/velocity.json`; the Current/Backlog cut with the examples from `spec/fixtures/planning.json`; the statement that there is no finalization, no rollover mutation and therefore none of the concurrency hazard the old document described; and a pointer to the two fixtures as the executable version of the rules.

- [ ] **Step 3: Fix the hook-injected invariants**

In `ARCHITECTURE.md`, above `<!-- hook:end -->` (the marker must survive — `scripts/session-context.sh` refuses to run without it):

- Delete: "**Read `project_states.category`, never the state name**" and "**Iteration rollover is lazy** on owner/member access; the worker drains the Slack outbox only".
- Replace the `Behaviour lives in services/` bullet's tail so it no longer names `container flags`.
- Add:
  - **Iterations are derived, never stored.** Windows come from the project's start date, week start day, length and time zone; only `iteration_overrides` is a row. There is no rollover and no finalize step.
  - **Story ordering is `before_id` / `after_id`** over two sparse-position lists per project (`services/ordering.ts`). `reorder()` is for short lists only — tasks, labels, epics, review types.
  - **Activity is Tracker-shaped**: one row per action with `kind` / `highlight` / `message` / `changes[]`, written only by `recordActivity`, bumping `projects.version`, which the SSE event carries.
  - **`iteration_overrides` is the one table keyed `(project_id, number)`** rather than `(id, project_id)`: the iteration number is the identity and the iteration itself is a computation.

Update the "Where things are" table below the marker for the new service files.

- [ ] **Step 4: Repoint CLAUDE.md and REVIEW.md at the reference notes**

In `CLAUDE.md`, the Critical Rules bullet currently reads "check original Pivotal Tracker's behavior first for tracker-mode interactions (Wayback procedure in that file)". Replace the Wayback pointer with `docs/reference/tracker-notes/` and state the design's gate: **a screen note is the gate for a screen — no screen is designed or implemented before `docs/reference/tracker-notes/<screen>.md` exists** (design §3.1). Note that the corpus itself (`docs/reference/tracker/`) is git-ignored and regenerated with `scripts/tracker-corpus/`.

In `REVIEW.md`, the "Behavior that silently diverges from `spec/` or from original Pivotal Tracker behavior" bullet gains the same pointer, and the `activity_logs` bullet becomes `activities` written through `recordActivity(scope, …)` inside the same transaction.

Update `SPEC.md`'s index rows for `data-model.md` and `velocity.md`, and `spec/glossary.md` for the terms that changed meaning: iteration (derived window, not a row), Current (the head of the backlog list, not a panel of its own), Done (an `accepted_at` view), velocity (points per default-length iteration), and the two deliberate model divergences (no account layer, no public projects).

- [ ] **Step 5: Record the decision in Backlog**

Read the workflow first — `backlog instructions overview` — then create the decision. It is a cross-cutting meta principle, which is what Backlog Decisions are for (project memory:機能設計は Document, 横断メタ原則は Decision):

```bash
backlog decision create "Iterations are derived; Tracker parity is the product rule" --status accepted
```

Then fill its body through the CLI (never by editing the file) with:

> **Context.** The 2026-07-18 doc-8 concept redesign gave Storylane its own domain: category states, person-day velocity, materialized iterations with a lazy rollover, a Storylane-designed My Work. The 2026-09-16 Tracker-parity rewrite replaces all of it.
>
> **Decision 1 — Tracker parity is the product rule.** Where Tracker's behaviour is known, Storylane matches it. A divergence is allowed only when it is recorded, with its reason, in `spec/data-model.md` "Divergences from Tracker". The account layer and public projects are the two recorded at the outset. `docs/reference/tracker-notes/` is the evidence; a screen note gates its screen.
>
> **Decision 2 — Iterations are derived, not stored.** Iteration `n` is the window computed from the project's start date, week start day, iteration length and time zone; a story belongs to a done iteration by its `accepted_at`. The only stored rows are `iteration_overrides`. There is no materialized iteration, no finalize step and no rollover mutation — so decision-2's "iteration rollover is lazy" no longer describes anything, and the `spec/velocity.md` finalization-concurrency hazard does not exist in this model.
>
> Supersedes the doc-8-derived parts of decision-2. Design: `docs/design/2026-09-16-tracker-parity-rewrite-design.md`.

Ask the owner before creating any Backlog **task** (standing rule); a decision recording an already-approved design is the exception this step relies on — if the owner would rather create it herself, hand her the command above and move on.

- [ ] **Step 6: Verify the spec guard still passes**

Run: `pnpm --filter @storylane/core test`
Expected: PASS — `permissions.test.ts` re-parses `spec/permissions.md`, so a stray edit to its table fails here.

Run: `cd apps/server && bun test`
Expected: PASS, 0 fail.

Run: `grep -rn "project_states\|rollover\|person-day\|container_rollup" spec ARCHITECTURE.md CLAUDE.md REVIEW.md SPEC.md`
Expected: no output outside a "Divergences"/"History" line that deliberately names the old model. Any other hit is a document this task missed.

- [ ] **Step 7: Commit**

```bash
git add spec ARCHITECTURE.md CLAUDE.md REVIEW.md SPEC.md .backlog
```

```bash
git commit -m "$(cat <<'MSG'
docs: rewrite the data model, velocity and agent context for Tracker parity

spec/data-model.md and spec/velocity.md describe the shipped schema and the
derived iteration model, with the assumptions that resolve the reference
note's open questions listed where a later corpus find can overturn them.
The hook-injected invariants no longer name project_states or rollover.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
MSG
)"
```

---

## Self-review

Run after the plan is written, before execution starts. Recorded here so the reviewer can see it was done.

**1. Spec coverage.** Design §2 "Discarded" → Tasks 1–3 (server domain, core modules, web board) and Task 4 (permission fixture rewrite). §2 "Kept" → nothing to do except `projects.version` (Task 5 column, Task 6 writer, Task 6 SSE payload). §3.2 story fields → Task 5; ordering → Tasks 5 and 9; epics → Task 11; estimation → Tasks 5, 7, 8; derived iterations → Tasks 5, 16, 17, 20; velocity and planning → Tasks 18–20; attachments to a story (tasks, comments, followers, blockers, reviews, story activity) → Tasks 6, 10, 12–15; activity → Task 6; roles → Task 4; search → Task 21. §4 migration squash → Task 5 Step 9; branch tags → Task 1 Step 1; agent-context revisions and decision-3 → Task 22. §4's CI publish-branch change is already committed on this branch (`57dcc24`) and is deliberately not repeated. §4's Backlog milestone re-scoping and the TASK-244/254 fold are owner decisions, named in the design and out of this plan's scope. Gaps: none found.

**2. Placeholder scan.** No "TBD", "implement later" or "add appropriate error handling". Tasks 11–16 and 21 describe their implementations in prose plus exact interfaces rather than reproducing every line — each one's *tests* are concrete, which is what an executor works against, and each one's public surface is fully typed above. The one forward reference in the plan (`readProject`'s `current_iteration_number: 1` placeholder in Task 7, filled in Task 20 Step 4) is named in both places.

**3. Type consistency.** `StoryState` / `StoryType` / `StoryList` are declared twice by design — once in the schema for drizzle-kit, once in `packages/core` for the rules — and Task 8 Step 5 pins them together with a compile-time `Exact<>` assertion. `recordActivity` takes `ActivityEntry` with `kind`/`message`/`highlight`/`changes`/`primaryResources` in every task that calls it. `placeInList(tx, storyId, list, move)` has the same four parameters in Tasks 9, 8 and 11. `POSITION_GAP` is used, not re-declared. Service row types are snake_case (the API shape) while service *functions* are camelCase; the schema columns stay camelCase in Drizzle and snake_case in SQL — consistent with the foundation.

**Fixed inline while reviewing:** Task 7's `createProject` needed a `startDate` default or every project creation would hit the new NOT NULL column and its trigger (added to Step 7). Task 5's `project_members` needed an explicit `UNIQUE (project_id, user_id)` for the composite foreign keys in `story_owners` / `story_followers` / `reviews` to resolve (added to Step 1). Task 10's follower matrix fixture cannot name an arbitrary user without contradicting the viewer self-restriction; Step 5 says what to do about it rather than leaving the executor to discover the conflict.

## Execution handoff

Two options, owner's call:

1. **Subagent-driven (recommended)** — a fresh subagent per task, reviewed between tasks. Tasks 4 and 5 stop for `/advisor` first; Task 4 also gets an `authz-reviewer` pass.
2. **Inline** — batch execution with checkpoints at Tasks 5, 9, 16 and 20.
