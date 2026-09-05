---
id: TASK-243
title: >-
  Distribution skeleton: docker-compose.yml with Caddy profile, .env.example,
  INSTALL.md first draft
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-05 15:48'
labels: []
milestone: m-8
dependencies:
  - TASK-242
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: medium
type: docs
ordinal: 800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc section 7. Ship at the repo root: docker-compose.yml with services app and caddy (caddy under a profile so it can be omitted), .env.example containing DOMAIN and the four STORYLANE_* variables with comments, and INSTALL.md covering: docker run one-liner, compose with a domain, upgrade (pull + restart), backup via storylane backup and a cron example, restore, the one-process-per-volume and no-network-filesystem rules.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docker compose up -d with only DOMAIN set serves the app over HTTPS via Caddy; without the caddy profile the app is reachable on STORYLANE_PORT
- [ ] #2 .env.example documents every variable the server reads
- [ ] #3 INSTALL.md has the sections listed in the description and is linked from README
<!-- AC:END -->
