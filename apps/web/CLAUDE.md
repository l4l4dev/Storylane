# Web (TypeScript / Next.js) Conventions

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

## Folder Structure

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

## Testing
- Unit tests: Vitest
- Component tests: Testing Library
- Test files go next to the source file as `*.test.ts(x)`
