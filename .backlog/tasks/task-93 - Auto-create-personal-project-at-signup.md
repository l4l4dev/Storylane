---
id: TASK-93
title: Auto-create personal project at signup
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 13:04'
updated_date: '2026-07-20 01:16'
labels:
  - web
  - db
milestone: m-5
dependencies:
  - TASK-87
  - TASK-91
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §4 owner decision 2026-07-18: on signup, auto-create a personal project for the new user (1-day cadence, minimal state template, name like "My Tasks") so a solo user manages their own tasks with zero setup and no team project. Reuse the create_project RPC/template seeding from TASK-91; spec addendum to spec/screens.md (onboarding) and spec/features.md as part of this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A fresh signup lands with one personal project (1-day cadence, minimal template) already present; My Work works immediately
- [ ] #2 Spec updated (screens onboarding + features)
- [ ] #3 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Design fixed by Fable advisor 2026-07-20. (1) Extract the project-seeding core of create_project (project row + owner membership + state template) into an internal SECURITY DEFINER function seed_project(p_owner uuid, p_name text, p_iteration_length int, p_template text) — needed because handle_new_user runs in the auth-service context where auth.uid() is not the new user; create_project RPC becomes a thin wrapper passing auth.uid(). REVOKE EXECUTE on seed_project from anon/authenticated (internal only — function_grant_lockdown pattern). (2) handle_new_user trigger (20260627000001_profiles.sql, replaced in a new migration) additionally calls seed_project(new.id, 'My Tasks', 1, minimal template = the smallest TASK-91 template: unstarted/in_progress/done). Personal project is a NORMAL project — no flag column, invites allowed, no special-casing anywhere (YAGNI; My Work accent keys off iteration_length=1, not a flag). (3) No backfill: production is fully reset in TASK-98, local dev seeds fresh. (4) Trigger failure must not block signup? NO — seeding is in the same transaction deliberately: a user without their personal project violates the product promise; if seeding fails, signup fails loudly (test this). (5) Integration test: fresh auth user -> profile + 1 project (1-day, 3 states, owner member); My Work renders it. (6) Spec addenda: spec/screens.md onboarding note + spec/features.md personal project paragraph. (7) rls-security-reviewer pass (SECURITY DEFINER + trigger touch), full suite.
<!-- SECTION:PLAN:END -->
