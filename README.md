# Storylane

An open-source agile project management tool that rebuilds the Pivotal Tracker
workflow: velocity-based automatic iteration planning and a strict story-state
flow, on a self-hostable stack.

> **Status: pre-release.** Under active development. The web client is being
> built first; a native iOS client follows the same specification.

## Why

Pivotal Tracker was discontinued in April 2025. Its planning model — points,
velocity, and iterations that fill themselves from a strictly ordered backlog —
has no maintained open-source implementation. Existing OSS trackers are built
around different planning philosophies (kanban boards, Gantt-style planning).
Storylane aims to give former Tracker teams a workflow-faithful option they can
run themselves.

## Features (Phase 1)

- Story types (feature / bug / chore / release), point estimation, state flow
  (unstarted → started → finished → delivered → accepted/rejected), Icebox
  triage, and velocity-based automatic assignment of backlog stories to
  upcoming iterations
- Epics, labels, tasks, comments, and per-story activity history
- Project members with owner / member / viewer roles, enforced by Postgres
  row-level security
- Realtime collaboration via Supabase Realtime
- GitHub / Forgejo / Slack integrations (webhook-based)

See [SPEC.md](SPEC.md) for the full specification index.

## Tech stack

| Layer | Technology |
|---|---|
| Web | Next.js (App Router) + TypeScript |
| iOS | Swift / SwiftUI (iOS 17+) |
| Backend | Supabase (Postgres, Auth, Realtime) |
| Hosting | Vercel |

## Repository layout

```
apps/web/        Next.js web client
apps/ios/        SwiftUI iOS client
supabase/        Migrations, seed data, Edge Functions
spec/            Specification (data model, RLS, velocity, features, screens)
docs/            Decisions and working notes
```

## Getting started

Prerequisites and setup are documented in [spec/local-dev.md](spec/local-dev.md).
The short version:

```bash
supabase start        # local Supabase stack (requires Docker)
supabase db reset     # apply migrations + seed
cd apps/web
pnpm install
pnpm dev              # http://localhost:3000
```

The local seed includes a dev user, so you can sign in with "Continue as dev
user" on the login page without configuring OAuth.

## Development approach

Storylane is developed spec-first and almost entirely with AI coding agents
(Claude Code). The versioned specification in `spec/`, the conventions in
`CLAUDE.md`, and dedicated review subagents (e.g. an RLS security reviewer for
every migration) are part of the repository so the setup can be reused by other
projects.

## License

[MIT](LICENSE)
