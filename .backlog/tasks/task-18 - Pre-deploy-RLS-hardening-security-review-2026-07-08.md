---
id: TASK-18
title: Pre-deploy RLS hardening (security review 2026-07-08)
status: To Do
assignee: []
created_date: '2026-07-08 00:50'
labels:
  - db
  - security
dependencies: []
references:
  - spec/rls.md
priority: high
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Findings from the 2026-07-08 pre-deploy security audit of supabase/migrations + git-webhook Edge Function. No High findings; the Edge Function (HMAC verification, empty-secret rejection, per-project scoping), integrations owner-only RLS, grants, and project_members escalation paths all verified clean. Three confirmed gaps to fix in one migration before production (TASK-3):

1. profiles SELECT policy is 'using (true)' for all authenticated users (20260627000001_profiles.sql) — any signed-up user can enumerate the entire user directory, which also defeats the capped invite-search RPC design (TASK-6). Scope SELECT to own profile + profiles sharing a project; make the capped RPC the only cross-tenant lookup.
2. comments UPDATE policy checks author_id only (20260627000006) — a removed/downgraded member can still edit their old comments by id. Add the parent-story membership clause like the INSERT policy.
3. stories.epic_id / iteration_id are plain FKs (20260627000005) — FK checks bypass RLS, so a user in two projects can point an A-story at a B-epic/iteration (dangling, invisible, low impact). Add UNIQUE(id, project_id) on epics/iterations and composite FKs, matching the custom_status_id hardening in 20260707000007.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 profiles SELECT is scoped to own profile + co-members; a user with no shared project cannot read another user's profile row (test proves it)
- [ ] #2 Invite user-search still works via the capped RPC after the profiles policy change (coordinate with TASK-6 if it lands first)
- [ ] #3 comments UPDATE requires current membership of the story's project in USING and WITH CHECK
- [ ] #4 stories.epic_id and stories.iteration_id are composite FKs on (id, project_id); existing data migrates cleanly
- [ ] #5 rls-security-reviewer has reviewed the migration; existing vitest + RLS tests pass
<!-- AC:END -->
