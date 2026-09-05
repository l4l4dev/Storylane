---
id: decision-2
title: >-
  Self-host rewrite: single server entry point, business rules in services, race
  guards in DB, pure logic in packages/core with spec fixtures
date: '2026-09-05 03:45'
status: accepted
---
## Context

Decision-1 (2026-07-08) assumed that Web and iOS talk to Supabase
directly, so business rules had to live in Postgres RPCs and invariants in
RLS + triggers. The self-host rewrite (docs/design/2026-09-05-self-host-rewrite-design.md)
replaces hosted Supabase + Vercel with a single Bun/Hono server over SQLite
that is the only entry point for every client (browser SPA, iOS, MCP).
That removes the premise of decision-1.

## Decision

1. **The server is the only entry point.** No client holds a database
   connection or a service key; iOS and MCP use the same JSON API as the
   browser with Personal Access Tokens.
2. **Business rules live in `apps/server/src/services`**, each use case
   inside one synchronous SQLite transaction obtained through
   `authorize(actor, projectId, action): ProjectTx`. Authorization is
   enforced by that type: project data cannot be read or written without a
   `ProjectTx`. Row access goes through `loadInProject` (project-scoped by
   construction); non-members receive 404.
3. **Race-closing invariants stay in the database** as constraints and
   guard triggers (`RAISE(ABORT)`): composite `(id, project_id)` keys,
   unique `(project_id, number)`, no assignment into a finalized iteration,
   story number pinned after creation. Behaviour (activity log, Slack
   outbox, completed_at, container flags) is explicit code in services, not
   triggers.
4. **Pure logic lives in `packages/core`** and is tested against the golden
   fixtures in `spec/fixtures/`; the permission matrix in
   `spec/permissions.md` is likewise read as a fixture by the server test
   suite so spec and code cannot drift.
5. Iteration rollover stays lazy on owner/member access (spec/velocity.md
   "Rollover"); the in-process worker drains the Slack outbox only.

## Consequences

- Supersedes decision-1. RLS, SECURITY DEFINER RPCs and grant management
  disappear from the codebase; `spec/rls.md` becomes `spec/permissions.md`.
- `bun:sqlite` transactions are synchronous: `await` inside
  `db.transaction()` is forbidden and lint-enforced, because it silently
  breaks atomicity and with it the guarantees of point 2.
- The `rls-security-reviewer` gate is replaced by an auth/authz review gate
  over `apps/server/src/auth`, `apps/server/src/db/tx.ts` and
  `spec/permissions.md`.
- A future second server instance would require moving the event bus out
  of process; explicitly out of scope.

