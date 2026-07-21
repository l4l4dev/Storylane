---
id: TASK-93
title: Auto-create personal project at signup
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 13:04'
updated_date: '2026-07-21 01:28'
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
Revised 2026-07-20 by Fable advisor after discovering the original plan's premise was stale: create_project RPC was already DROPPED in 20260718000001_remove_free_mode.sql (free-mode removal) and never recreated — it does not exist in the schema. The web client's actual createProject (apps/web/app/dashboard/actions.ts) does a plain `.from("projects").insert(...)`, relying entirely on two existing AFTER INSERT triggers that read only NEW's own columns (never auth.uid()):
  - on_project_created -> handle_new_project() (20260627000002_projects.sql): enrolls new.created_by as owner
  - on_project_created_seed_states -> handle_new_project_states() -> seed_project_states(new.id, new.state_template) (20260719000006_stories_state_id.sql): seeds project_states from new.state_template

Since both triggers already work off NEW's columns (not auth.uid()), no new seed_project() SECURITY DEFINER function is needed — extracting one would be a wrapper around a single caller (YAGNI). Revised plan:
(1) New migration replaces handle_new_user (20260627000001_profiles.sql) with `create or replace function`, adding one INSERT right after the existing profiles INSERT:
    insert into public.projects (name, iteration_length, state_template, created_by)
    values ('My Tasks', 1, 'minimal', new.id);
    (iteration_term/velocity_window/point_scale/working_weekdays left to their column defaults — no need to set explicitly.)
(2) No new revoke/grant needed — the two existing triggers fire unconditionally on any projects INSERT.
(3) RLS bypass is safe and not a new pattern: handle_new_user is already SECURITY DEFINER and already inserts into profiles bypassing "id = auth.uid()" the same way; the projects insert bypasses "created_by = auth.uid()" identically, no new risk surface.
(4) FK ordering is safe: projects.created_by references profiles(id); the profiles insert in the same function/transaction precedes the projects insert, satisfying the FK before the projects INSERT's constraint check.
(5) Personal project stays a NORMAL project — no flag column, invites allowed, no special-casing (My Work accent keys off iteration_length=1, not a flag) — unchanged from original plan.
(6) No backfill — production is fully reset in TASK-98, local dev seeds fresh — unchanged.
(7) Trigger failure must not block signup silently: seeding stays in the same transaction as auth.users insert, so a failure rolls back the whole signup — unchanged, test this explicitly (new: assert auth.users/profiles do NOT persist if the projects insert is forced to fail).
(8) Integration test: fresh auth user -> profile row + 1 project row (iteration_length=1, minimal template -> 3 project_states rows, owner project_members row); My Work renders it. Add a rollback-on-failure case per (7).
(9) Spec addenda: spec/screens.md onboarding note + spec/features.md personal project paragraph — unchanged.
(10) rls-security-reviewer pass (SECURITY DEFINER trigger touch) + full suite — unchanged.
(11) Must land before TASK-98's production reset (existing dependency) — the reset re-signup is where this gets its first real-world exercise.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-21 01:21
---
Advisor re-review 2026-07-20: original plan's premise (reuse create_project RPC's seeding via a new seed_project() extraction) was based on a stale read of the schema — create_project was already dropped by 20260718000001_remove_free_mode.sql and the web client never called it. Revised plan above drops the seed_project() extraction entirely and adds one INSERT directly inside handle_new_user, relying on the two existing AFTER INSERT triggers (owner enrollment + state seeding) which already key off NEW's own columns, not auth.uid(). Advisor confirmed no new RLS/FK/concurrency risk.
---
<!-- COMMENTS:END -->
