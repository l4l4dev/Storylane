# Storylane — Claude Code Instructions

## About This Project

An agile project management tool inspired by Pivotal Tracker.
Always refer to `SPEC.md` for the full specification before implementing anything.

## Critical Rules

- Always ask before making architectural changes or large-scale refactors
- Before implementing a large plan (new tables/RLS, algorithm rewrites, concurrency-sensitive
  changes), get it reviewed via the `/advisor` skill (fable-advisor agent) — then show the verdict
  to the user with your plan
- Never use `git add -A` or `git add .` — always specify files explicitly
- Always confirm before irreversible operations (file deletion, overwriting, etc.)
- Never chain state-changing commands (commit, migration, install, rm, etc.) with `&&` — run them
  one at a time. Chaining read-only commands (`git status`, `ls`, `grep`, `wc`, ...) is fine
- Never guess at unspecified behavior — ask when the spec is unclear
- Destructive DB operations (DELETE/TRUNCATE/UPDATE without a primary-key filter) on rows you did
  not create in the current session require explicit user approval first

## Token Economy

Most work here is done by AI agents — keep context small:

- Never read generated files in full (`apps/web/lib/database.types.ts`, lockfiles) — Grep for the type/entry you need
- Read only the spec section relevant to the task (via the SPEC.md index). Work items live in
  Backlog.md — read only the current task (`backlog task view <id> --plain`); TASK.md is just a
  short remaining-work index, and completed history lives in `TASK_ARCHIVE.md` (read on demand only)
- Prefer Grep/Glob or partial reads (offset/limit) over full reads for files longer than ~300 lines
- Run long-lived commands (`pnpm dev`, `supabase start`) in the background and read only the log tail
- While iterating, run targeted tests (`pnpm exec vitest run <path>`); run the full `pnpm test` only before commit

---

## Tech Stack

| Layer | Technology |
|---|---|
| iOS | Swift / SwiftUI (iOS 17+) |
| Web | Next.js (App Router) + TypeScript |
| Backend | Supabase (DB / Auth / Realtime) |
| Hosting | Vercel |

---

iOS conventions live in `apps/ios/CLAUDE.md`; Web conventions live in `apps/web/CLAUDE.md` (loaded automatically when working under those directories).

## Supabase Conventions

- Always enable RLS on every table
- Migration files go in `supabase/migrations/` with sequential numbering
- Edge Functions go in `supabase/functions/`
- Secrets and API keys go in `.env.local` — never commit them

---

## Git Conventions

### Commit Messages (Conventional Commits)

```
feat: add drag-and-drop story reordering in backlog
fix: correct point calculation in iteration auto-assignment
chore: update Supabase client dependency
docs: add velocity calculation logic to SPEC.md
```

### Branch Naming

```
feat/backlog-drag-and-drop
fix/velocity-calculation
chore/update-supabase-client
```

---

## Backlog Assignee & Model Policy

Every Backlog task MUST have an assignee — set it at creation time, never leave it empty.

- Tasks owner performs herself (interactive auth, manual verification, deploys): `@l4l4dev`
- Tasks a model implements: assign the model best matched to the task's content:
  - `@claude-haiku-4-5` — mechanical, low-risk edits (renames, copy tweaks, config)
  - `@claude-sonnet-5` — standard feature/bugfix implementation (default choice)
  - `@claude-opus-4-8` — architecture-sensitive work: new tables/RLS, concurrency,
    cross-cutting refactors, notification/event paths
  - `@claude-fable-5` — design review, planning, and final review passes (fable-advisor)

Workflow rules:

- When picking up the next task, tell owner which model the task is assigned to and suggest
  switching to it before starting work.
- If a review finds poor-quality output, escalate: reassign the task to the next higher model
  (or propose the switch to owner), leave a task comment explaining why, and redo the work there.

## Code Comment Policy

How belongs in the code itself, what in test names, why in the commit message. A code comment
earns its place only by stating what the code cannot: a non-obvious constraint, or a "why not"
(the rejected alternative and what breaks with it). Keep these short.

Never write:

- History narration ("TASK-19 changed this", "this used to be...") — that's commit-log material
  and becomes noise the moment it merges
- Spec restatement — reference the section (e.g. `spec/screens.md "Board layout"`) instead of
  copying its content
- Reviewer-directed notes explaining that a change is correct or where it came from

Longer design context that future sessions must not re-derive belongs in the architecture notes
or `spec/`, with a one-line pointer from the code.

## Do Not

- Add features not defined in `SPEC.md` without confirmation
- Leave RLS disabled while implementing
- Hardcode secrets or API keys in source files
- Mark a feature complete without writing tests
- Include `console.log` in commits (debug use only)

<!-- BACKLOG.MD GUIDELINES START -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Use the detailed guides when needed:
- `backlog instructions task-creation` for creating or splitting tasks
- `backlog instructions task-execution` for planning and implementation workflow
- `backlog instructions task-finalization` for completion and handoff

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
