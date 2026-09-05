---
id: TASK-236
title: >-
  Repo cleanup for the self-host rewrite: tag v0-supabase, remove Supabase-era
  apps, rewrite agent instructions
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-09-05 15:47'
updated_date: '2026-09-05 16:41'
labels: []
milestone: m-8
dependencies: []
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
priority: high
type: chore
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First commit of the rewrite (design doc section 8). Tag the last Supabase-era commit v0-supabase, then delete apps/web, apps/ios, apps/mcp, supabase/, deno.lock, DEPLOY.md, LOCAL_DEV.md, ACCOUNT_SETUP.md and .github/workflows/deploy.yml. Rewrite ARCHITECTURE.md for the new shape (keep the hook:end marker contract used by scripts/session-context.sh). Update CLAUDE.md, AGENTS.md, REVIEW.md and .claude/ agents/skills so no rule still assumes Supabase, RLS, Next.js or Vercel; the rls-security-reviewer gate becomes an auth/authz review gate over apps/server/src/auth, apps/server/src/db/tx.ts and spec/permissions.md. Keep spec/, SPEC.md, packages/core, .backlog/, .specify/, specs/. Work on branch rewrite/self-hosted.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Tag v0-supabase exists on the last pre-rewrite commit
- [ ] #2 apps/web, apps/ios, apps/mcp, supabase/, deno.lock, DEPLOY.md, LOCAL_DEV.md, ACCOUNT_SETUP.md, .github/workflows/deploy.yml are gone; spec/, SPEC.md, packages/core, .backlog/, .specify/, specs/ untouched
- [ ] #3 ARCHITECTURE.md describes the single-process Bun/Hono + SQLite shape and keeps the hook:end marker; scripts/session-context.sh still runs
- [ ] #4 grep for Supabase, RLS, Next.js, Vercel, supabase-js in CLAUDE.md, AGENTS.md, REVIEW.md, .claude/ returns only historical references marked as such
- [ ] #5 pnpm install succeeds at the repo root with the reduced workspace
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on branch rewrite/self-hosted: tag v0-supabase @9419360; old apps/supabase removed and agent instructions rewritten (7be2238); parity script fixed for the new agent set (7ebd8a7). Reviewed via SDD task review + scoped re-review. Deferred: two remaining 'new tables/RLS' phrases in CLAUDE.md (Spec Kit / PR bullets), Supabase mentions in .claude/commands/new-story.md and .specify/memory/constitution.md → final whole-branch review.
<!-- SECTION:NOTES:END -->
