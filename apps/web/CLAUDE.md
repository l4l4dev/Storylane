# Web (TypeScript / Next.js) Conventions

<!-- AGENTS.md in this directory is a symlink to this file, so Codex gets these
     conventions too. It must keep pointing here, not at the repo-root file. -->

## General
- Use **pnpm** as the package manager — never `npm` or `yarn` (e.g. `pnpm install`, `pnpm add`, `pnpm run dev`)
- Never use `any` — use `unknown` when the type is uncertain
- Prefer Server Components; use `"use client"` only when necessary
- Always use `async/await` — avoid `.then()` chains

## Naming
- Components: `UpperCamelCase` (e.g. `StoryCard.tsx`)
- Functions and variables: `lowerCamelCase`
- Constants (env vars etc.): `UPPER_SNAKE_CASE`
- File names: `UpperCamelCase.tsx` for components, `kebab-case.ts` otherwise

## Testing
- Unit tests: Vitest
- Component tests: Testing Library
- Test files go next to the source file as `*.test.ts(x)`
- In `*.integration.test.ts`, every `createClient` needs `{ auth: { persistSession: false } }`.
  Without it all clients in a file share one storage key, so a client meant to be anonymous
  inherits the previous sign-in and clients playing different roles overwrite each other. It
  only bites where localStorage exists, so it passes on Node 26 and fails on CI's Node 22.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
