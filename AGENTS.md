# Storylane — Codex Instructions

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
- Any user-facing UI work follows `spec/ux-principles.md`: check original Pivotal Tracker's
  behavior first for tracker-mode interactions (Wayback procedure in that file), and end the
  task with a fable-advisor design review against the principles before manual verification
- Destructive DB operations (DELETE/TRUNCATE/UPDATE without a primary-key filter) on rows you did
  not create in the current session require explicit user approval first
- This repository is public: never write the owner's personal name or private email in anything
  git-tracked (source, tests, spec, task files, commit messages) — refer to them as `@l4l4dev` or
  "the owner" (オーナー), and use fictional names/emails in test fixtures

## Review Workflow

- End every implementation task with `/code-review` before proposing a commit. Default
  effort `medium`; use `high` for migrations, RLS, concurrency, or board-algorithm work.
  Repo-specific review rules live in `REVIEW.md`.
- Migrations additionally require an `rls-security-reviewer` agent pass (deeper than the
  generic review), and user-facing UI still ends with the fable-advisor design review
  (see Critical Rules). `/security-review` runs once before each deploy.
- `/simplify` is available for cleanup-only passes on request.
- When any review pass reports findings, hold the merge and surface them to the owner
  before merging.
- `@codex-gpt-5` second-opinion reviews (Codex CLI) remain a separate, optional lane —
  they run on the ChatGPT quota, not Codex tokens.

## Token Economy

Most work here is done by AI agents — keep context small:

- Never read generated files in full (`apps/web/lib/database.types.ts`, lockfiles) — Grep for the type/entry you need
- Read only the spec section relevant to the task (via the SPEC.md index). Work items live in
  Backlog.md — read only the current task (`backlog task view <id> --plain`); TASK.md is just a
  short remaining-work index, and completed history lives in Backlog doc-4 (read on demand only)
- Prefer Grep/Glob or partial reads (offset/limit) over full reads for files longer than ~300 lines
- Run long-lived commands (`pnpm dev`, `supabase start`) in the background and read only the log tail
- While iterating, run targeted tests (`pnpm exec vitest run <path>`); before commit run the full
  suite **from `apps/web/`** (`pnpm test` + `pnpm run lint`) — the root package.json is
  workspace-config only (no scripts), so `pnpm test` at the repo root fails with exit code 1

---

## Tech Stack

| Layer | Technology |
|---|---|
| iOS | Swift / SwiftUI (iOS 17+) |
| Web | Next.js (App Router) + TypeScript |
| Backend | Supabase (DB / Auth / Realtime) |
| Hosting | Vercel |

---

iOS conventions live in `apps/ios/AGENTS.md`; Web conventions live in `apps/web/AGENTS.md` (loaded automatically when working under those directories).

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

- Tasks the owner performs herself (interactive auth, manual verification, deploys): `@l4l4dev`
- Tasks a model implements: assign the model best matched to the task's content:
  - `@Codex-haiku-4-5` — mechanical, low-risk edits (renames, copy tweaks, config)
  - `@Codex-sonnet-5` — standard feature/bugfix implementation (default choice)
  - `@Codex-opus-4-8` — architecture-sensitive work: new tables/RLS, concurrency,
    cross-cutting refactors, notification/event paths
  - `@Codex-fable-5` — design review, planning, and final review passes (fable-advisor).
    When Fable is unavailable (plan window closed), these duties fall to `@Codex-opus-4-8`
    and the fable-advisor agent runs with `model: opus` (the /advisor skill already says so)
  - `@gpt-5.6-sol` — (Codex CLI, ChatGPT quota) full implementation tasks when Codex
    quota is exhausted, EXCEPT new-table RLS design and the state-model core; any
    migration it writes is held from deploy until a deferred `rls-security-reviewer`
    pass once Codex quota returns
  - `@codex-gpt-5` — precisely-scoped, behavior-preserving refactors/cleanups and
    second-opinion review passes, run via the Codex CLI (executes on the ChatGPT quota,
    not Codex tokens). Not for architecture-sensitive or RLS/concurrency work

Workflow rules:

- When picking up the next task, tell the owner which model the task is assigned to and suggest
  switching to it before starting work.
- If a review finds poor-quality output, escalate: reassign the task to the next higher model
  (or propose the switch to the owner), leave a task comment explaining why, and redo the work there.

## Backlog Ordering & Doc Hygiene (standing rules, owner-requested 2026-07-22)

- **Doc titles start with the zero-padded doc number** (`NN — Title`, e.g. `15 — My Work
  redesign ...`) so the browser's alphabetical sort equals creation order. Apply to every
  new doc at creation (`backlog doc create "16 — ..."`).
- **To Do is ordered by implementation order, top to bottom, via `--ordinal`** (steps of 100).
  When creating a task, judge its priority position and set an ordinal that inserts it there
  (renumber neighbors only if no gap is left). Never leave a new task at the default ordinal.
- Superseded/consumed docs move to `archive/` (`backlog doc update doc-N --path archive`);
  review reports live under `reviews/`. Only living design docs stay at the docs root.

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
