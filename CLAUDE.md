# Storylane — Claude Code Instructions

## About This Project

An agile project management tool inspired by Pivotal Tracker.
Always refer to `SPEC.md` for the full specification before implementing anything.

## Critical Rules

- Always ask before making architectural changes or large-scale refactors
- Never use `git add -A` or `git add .` — always specify files explicitly
- Always confirm before irreversible operations (file deletion, overwriting, etc.)
- Never chain state-changing commands (commit, migration, install, rm, etc.) with `&&` — run them
  one at a time. Chaining read-only commands (`git status`, `ls`, `grep`, `wc`, ...) is fine
- Never guess at unspecified behavior — ask when the spec is unclear

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

## iOS (Swift) Conventions

### General
- Use the latest stable Swift and SwiftUI APIs
- Prefer SwiftUI; use UIKit only when necessary
- Always use `@MainActor` appropriately — UI updates must happen on the main thread

### Naming
- Types and protocols: `UpperCamelCase` (e.g. `StoryDetailView`, `ProjectRepository`)
- Variables and functions: `lowerCamelCase` (e.g. `currentIteration`, `fetchStories()`)
- Constants: `lowerCamelCase` with `let`
- File names: match the type name (e.g. `StoryDetailView.swift`)

### Architecture
- Follow MVVM
- Views handle presentation only — business logic belongs in ViewModels or Repositories
- All Supabase communication goes through the Repository layer

```
apps/ios/Storylane/
├── Features/
│   ├── Backlog/
│   │   ├── BacklogView.swift
│   │   └── BacklogViewModel.swift
│   ├── Story/
│   │   ├── StoryDetailView.swift
│   │   └── StoryDetailViewModel.swift
│   └── ...
├── Repositories/
│   ├── StoryRepository.swift
│   └── ProjectRepository.swift
├── Models/
│   └── Story.swift, Project.swift ...
└── Core/
    └── SupabaseClient.swift
```

### Testing
- Use **Swift Testing** — never XCTest
- Write unit tests for ViewModels and Repositories
- Place test files under `Tests/` mirroring the same folder structure

```swift
// Example
@Test func fetchStoriesReturnsBacklogItems() async throws {
    let repository = StoryRepository(client: mockClient)
    let stories = try await repository.fetchBacklog(projectId: testProjectId)
    #expect(stories.isEmpty == false)
}
```

---

## Web (TypeScript / Next.js) Conventions

### General
- Use **pnpm** as the package manager — never `npm` or `yarn` (e.g. `pnpm install`, `pnpm add`, `pnpm run dev`)
- Never use `any` — use `unknown` when the type is uncertain
- Prefer Server Components; use `"use client"` only when necessary
- Always use `async/await` — avoid `.then()` chains

### Naming
- Components: `UpperCamelCase` (e.g. `StoryCard.tsx`)
- Functions and variables: `lowerCamelCase`
- Constants (env vars etc.): `UPPER_SNAKE_CASE`
- File names: `UpperCamelCase.tsx` for components, `kebab-case.ts` otherwise

### Folder Structure

```
apps/web/
├── app/                      # Next.js App Router
│   ├── (auth)/
│   ├── dashboard/
│   └── projects/[id]/
├── components/
│   ├── ui/                   # Generic UI components
│   └── features/             # Feature-specific components
│       ├── backlog/
│       ├── story/
│       └── iteration/
├── lib/
│   ├── supabase/             # Supabase client
│   └── utils/
└── types/                    # Type definitions
```

### Testing
- Unit tests: Vitest
- Component tests: Testing Library
- Test files go next to the source file as `*.test.ts(x)`

---

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

## Do Not

- Add features not defined in `SPEC.md` without confirmation
- Leave RLS disabled while implementing
- Hardcode secrets or API keys in source files
- Mark a feature complete without writing tests
- Include `console.log` in commits (debug use only)
- Use force unwrap (`!`) in Swift — use `guard let` or `if let` instead

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
