# Storylane — Specification v0.1

An agile project management tool inspired by Pivotal Tracker.
Core features include story backlog management, automatic velocity calculation, and iteration management,
delivered on both iOS (Swift / SwiftUI) and Web (React + TypeScript).

This file is an index. Read only the section file relevant to the task at hand — don't load the whole spec for a single-area change.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| iOS | Swift / SwiftUI | iOS 17+, deferred (see Backlog doc-22) |
| Server | Bun + Hono | Single process, JSON API + static SPA + SSE |
| Database | SQLite via Drizzle | `bun:sqlite`, forward-only migrations on boot |
| Web Frontend | React + TypeScript | Vite + Tailwind |
| Authentication | Built-in email + password | Phase 1; no third-party OAuth yet |
| Deploy | Single container | `ghcr.io/l4l4dev/storylane`, docker compose with optional Caddy |

---

## Sections

| File | Contents | Read when... |
|---|---|---|
| [spec/data-model.md](spec/data-model.md) | Full table definitions (profiles, projects, labels, iterations, stories incl. parent_id/is_container hierarchy, tasks, comments, activity_logs, integrations) | Writing migrations, queries, or any Repository-layer code |
| [spec/permissions.md](spec/permissions.md) | Permission matrix (action × role) and the invariants around it | Adding a route or changing who may do what |
| [spec/velocity.md](spec/velocity.md) | Velocity calculation formula and auto-assignment rule | Implementing Task 6 (Iterations) or Task 8 (Velocity) |
| [spec/features.md](spec/features.md) | Full Phase 1 / Phase 2 feature list | Scoping a new feature or checking what's in/out of Phase 1 |
| [spec/screens.md](spec/screens.md) | Web route map and iOS screen/tab structure | Adding a new screen or route |
| [spec/ux-principles.md](spec/ux-principles.md) | Design language, checkable interaction principles, Tracker-parity procedure, design review gate | Designing or implementing anything user-facing |
| [spec/integrations.md](spec/integrations.md) | GitHub/Forgejo/Slack webhook implementation notes | Implementing Task 12 (Integrations) |
| [spec/mcp.md](spec/mcp.md) | MCP server design: agent-as-member model, auth, Phase 1 toolset, Backlog.md migration | Implementing or extending agent access (TASK-48/49) |
| [spec/local-dev.md](spec/local-dev.md) | Prerequisites and local setup commands | Onboarding or environment troubleshooting |
| [spec/glossary.md](spec/glossary.md) | Domain term definitions | Clarifying terminology |

See also [ARCHITECTURE.md](ARCHITECTURE.md) for how these entities relate across Web / iOS / Server.
