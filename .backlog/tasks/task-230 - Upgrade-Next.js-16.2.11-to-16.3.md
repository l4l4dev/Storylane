---
id: TASK-230
title: Upgrade Next.js 16.2.11 to 16.3
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-04 11:09'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Next.js 16.3 (released 2026-08-03) ships zero-config wins that all land on upgrade: up to 90% less dev-server memory (Turbopack disk cache + memory eviction on by default), cached `next build` artifacts, ~22% more SSR throughput (native Node streams), fewer prefetch requests, and versioned docs for AI agents (`next dev` auto-maintains an AGENTS.md block pointing at bundled docs).

Our `next.config.ts` only sets `transpilePackages`, so nothing conflicts.

Out of scope (revisit separately): Instant Navigations opt-in flags (`cacheComponents`/`partialPrefetching` — changes the caching model), TypeScript 7 type checking, experimental Rust React Compiler.

Release notes: https://nextjs.org/blog/next-16-3
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 apps/web depends on next 16.3.x and eslint-config-next 16.3.x
- [ ] #2 Full suite passes from apps/web: `pnpm test` and `pnpm run lint`
- [ ] #3 `pnpm build` completes without new warnings/errors
- [ ] #4 The AGENTS.md block auto-written by `next dev` is reviewed; kept content does not conflict with existing agent instructions
<!-- AC:END -->
