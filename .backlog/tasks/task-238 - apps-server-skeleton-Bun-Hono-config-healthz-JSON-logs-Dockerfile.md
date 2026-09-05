---
id: TASK-238
title: 'apps/server skeleton: Bun + Hono, config, /healthz, JSON logs, Dockerfile'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-05 15:48'
labels: []
milestone: m-8
dependencies:
  - TASK-236
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: high
type: feature
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc sections 2 and 7. Create apps/server as a Bun workspace package running Hono. Read STORYLANE_PORT (3000), STORYLANE_DATA_DIR (/data), STORYLANE_BASE_URL (optional), STORYLANE_TRUST_PROXY (false) from the environment with validation. Serve GET /healthz (200 once the DB opens, see the SQLite task) and a JSON-lines logger to stdout. Provide a multi-arch Dockerfile (linux/amd64 + linux/arm64) based on the official Bun image that runs as a non-root user and declares /data as a volume. Static SPA serving is wired in the web skeleton task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 bun run dev in apps/server starts the server and GET /healthz returns 200 JSON
- [ ] #2 Invalid or missing env values fail fast at boot with a clear message; defaults documented in apps/server/README.md
- [ ] #3 Every request logs one JSON line (method, path, status, duration, request id) to stdout
- [ ] #4 docker build produces an image that answers /healthz with -v storylane:/data; image size under 250 MB
- [ ] #5 bun test passes for the config and healthz modules
<!-- AC:END -->
