# Storylane Review Rules

Repo-specific rules for `/code-review`. Generic correctness review applies as usual;
these adjust severity and add checks this repo cares about.

## Flag as Important (not nits)

- Authorization: every project route obtains a `ProjectTx`; row loads use
  `loadInProject`; non-member → 404. Transactions: no `await` inside
  `db.transaction()`; writes use `immediate`.
- Any owner-identifying personal name or private email in git-tracked content
  (this repo is public; the owner is referred to as `@l4l4dev`). Test fixtures must
  use fictional identities.
- `console.log` (or debug logging) left in committed app code.
- Direct `activity_logs` INSERT from client/server code — DB triggers are the only
  recording path (exceptions are listed in `ARCHITECTURE.md`).
- Behavior that silently diverges from `spec/` or from original Pivotal Tracker
  behavior for tracker interactions. Divergence is allowed only when the spec records
  it as deliberate (`spec/ux-principles.md` "never diverge by accident").
- New feature logic with no test next to the source (`*.test.ts(x)`, Vitest /
  Testing Library; Swift Testing on iOS).

## Repo conventions (nits when violated)

- pnpm only — flag npm/yarn commands or lockfiles.
- TypeScript: no `any` (use `unknown`); `async/await` over `.then()`.
- Naming: components `UpperCamelCase.tsx`, non-component files `kebab-case.ts`,
  functions/variables `lowerCamelCase`, constants `UPPER_SNAKE_CASE`.
- Comments: only non-obvious constraints or why-nots. Flag history narration
  ("TASK-N changed this"), spec restatement, and reviewer-directed notes
  (see CLAUDE.md "Code Comment Policy").
- Migrations: generated via `bun run db:generate` in `apps/server`; secrets only in
  `.env*` files, never in source.

## Scope

- Skip generated files: `apps/server/src/db/migrations/*.sql`, lockfiles.
- `.backlog/` content is task metadata maintained via the Backlog CLI — don't review
  its prose style, only factual contradictions with the code under review.
