# Storylane Review Rules

Repo-specific rules for `/code-review`. Generic correctness review applies as usual;
these adjust severity and add checks this repo cares about.

## Flag as Important (not nits)

- A migration creating a table without enabling RLS and defining its own full policy
  set (policies are never inherited — see `spec/rls.md`). Also: a new RPC touching
  rows across projects without re-checking membership in every project involved.
- Any owner-identifying personal name or private email in git-tracked content
  (this repo is public; the owner is referred to as `@l4l4dev`). Test fixtures must
  use fictional identities.
- `console.log` (or debug logging) left in committed app code.
- Client code constructing its own Supabase client instead of going through
  `apps/web/lib/supabase/` (web) or `Repositories/` + `Core/SupabaseClient.swift` (iOS).
- Direct `activity_logs` INSERT from client/server code — DB triggers are the only
  recording path (exceptions are listed in `ARCHITECTURE.md`).
- Behavior that silently diverges from `spec/` or from original Pivotal Tracker
  behavior for tracker interactions. Divergence is allowed only when the spec records
  it as deliberate (`spec/ux-principles.md` "never diverge by accident").
- New feature logic with no test next to the source (`*.test.ts(x)`, Vitest /
  Testing Library; Swift Testing on iOS).

## Repo conventions (nits when violated)

- pnpm only — flag npm/yarn commands or lockfiles.
- TypeScript: no `any` (use `unknown`); Server Components by default, `"use client"`
  only where needed; `async/await` over `.then()`.
- Naming: components `UpperCamelCase.tsx`, non-component files `kebab-case.ts`,
  functions/variables `lowerCamelCase`, constants `UPPER_SNAKE_CASE`.
- Comments: only non-obvious constraints or why-nots. Flag history narration
  ("TASK-N changed this"), spec restatement, and reviewer-directed notes
  (see CLAUDE.md "Code Comment Policy").
- Migrations: sequential numbering under `supabase/migrations/`; secrets only in
  `.env*` files, never in source.

## Scope

- Skip generated files: `apps/web/lib/database.types.ts`, lockfiles.
- `.backlog/` content is task metadata maintained via the Backlog CLI — don't review
  its prose style, only factual contradictions with the code under review.
