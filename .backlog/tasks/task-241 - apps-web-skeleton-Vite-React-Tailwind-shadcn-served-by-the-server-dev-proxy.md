---
id: TASK-241
title: >-
  apps/web skeleton: Vite + React + Tailwind/shadcn, served by the server, dev
  proxy
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-05 15:48'
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
