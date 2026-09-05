---
id: TASK-239
title: >-
  SQLite + Drizzle foundation: pragmas, startup migrations with pre-migration
  backup, storylane backup subcommand, test harness
status: To Do
assignee:
  - '@claude-opus-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-05 15:48'
labels: []
milestone: m-8
dependencies:
  - TASK-238
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: high
type: feature
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc section 5. Open /data/storylane.db with journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000 through Drizzle on bun:sqlite. On boot: write /data/backups/pre-<version>.db via VACUUM INTO, then apply pending Drizzle Kit migrations forward-only; exit 1 on failure. Provide the storylane backup <path> subcommand (VACUUM INTO) in the same binary. Provide a test harness that opens :memory: with the same migrations for bun test. Add the first migration with the schema_meta table only; domain tables come with later tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Boot creates the DB and applies migrations; a second boot is a no-op; a deliberately broken migration makes the process exit 1 after the pre-migration backup exists
- [ ] #2 PRAGMAs are asserted by a test reading them back
- [ ] #3 storylane backup out.db produces a file that opens with sqlite3 and has the same tables
- [ ] #4 Test harness helper gives each test an isolated :memory: DB with migrations applied; used by at least one test
- [ ] #5 All writing transactions go through a helper that issues BEGIN IMMEDIATE
<!-- AC:END -->
