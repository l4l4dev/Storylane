---
id: TASK-241
title: >-
  apps/web skeleton: Vite + React + Tailwind/shadcn, served by the server, dev
  proxy
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-06 01:32'
labels: []
milestone: m-8
dependencies:
  - TASK-238
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: medium
type: feature
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc section 2. Create apps/web as a Vite + React SPA with Tailwind v4 and shadcn set up (reuse the theme tokens from the v0-supabase Web app where they still fit). In production the server serves the built assets from apps/web/dist with SPA fallback; in development vite dev proxies /api to the server. Ship a placeholder shell that calls /healthz and shows version + status so the wiring is visible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pnpm --filter web dev serves the SPA and /api requests reach the server through the proxy
- [ ] #2 pnpm --filter web build produces dist/ and the server serves it with SPA fallback for unknown paths, while /api/* still returns JSON 404
- [ ] #3 Docker image includes the built SPA and opening the root shows the shell with /healthz status
- [ ] #4 vitest runs for the web package with at least one component test
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/self-hosted: 7fc98f2 (Vite+React shell, Tailwind v4, server static serving with SPA fallback, static.test.ts, Dockerfile web stage, .dockerignore for leftover .next etc.) + afece08 (harness isolates server tests from apps/web/dist; web eslint config). Image 81,002,412 bytes by docker image inspect. Deferred: comment that missing assets → index.html and that staticRoot existence is evaluated at boot; no test covers GET /* in the route matrix (harness uses non-existent static root).
<!-- SECTION:NOTES:END -->
