---
id: TASK-138
title: >-
  My Work redesign: my_work_columns + story-state reshape + mapping drop (doc-15
  schema)
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-22 08:52'
updated_date: '2026-07-22 09:45'
labels: []
dependencies:
  - TASK-131
priority: high
type: feature
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-15 (advisor-approved). Forward-only migration chain: (1) new my_work_columns table (user free columns, unique(user_id,id), own-rows RLS, seed 'Doing' per existing user + at signup via the next full replacement of handle_new_user, precedent 20260721000001->20260721000004); (2) reshape my_work_story_state: local_status -> column_id with COMPOSITE FK (user_id, column_id) references my_work_columns(user_id, id) on delete set null (column_id) [PG15+ column-list form, local is PG17], is_today -> today_date date + today_position int with check(today_position is null or today_date is not null), data conversion per doc-15 (local 'doing' -> seeded Doing column; 'todo'/'done' -> null; is_today -> current_date, backfill only); (3) drop project_my_work_mapping + remove the TASK-133 Settings section, broken-mapping banner, and resolveMappedState branch in the same task to keep tsc green. Regen database.types.ts. Rewrite my-work-data-model.integration.test.ts (it asserts the mapping table).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration(s) implement my_work_columns + the my_work_story_state reshape exactly as doc-15 specifies (composite FK, column-list SET NULL, today_position check, data conversion)
- [ ] #2 project_my_work_mapping dropped in a NEW forward-only migration; Settings 'My Work sync' section, my-work-mapping-broken-banner, and all mapping reads/writes removed from the web app
- [ ] #3 'Doing' free column seeded for existing users and created at signup (handle_new_user full replacement)
- [ ] #4 database.types.ts regenerated; my-work-data-model integration test rewritten for the new shapes
- [ ] #5 rls-security-reviewer pass on the migrations
- [ ] #6 supabase db reset green; pnpm test + lint green (from apps/web/)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (continuous 138->140 per owner decision): migration 20260722000007 (my_work_columns + reshape + handle_new_user + drop mapping) validated via db reset. Types regenerated. Mapping UI removed (settings section, saveMyWorkMapping, MyWorkMappingSettings, broken banner+test). my-work.ts/page.tsx/actions.ts/sections rewritten to the free-column model. Tests rewritten (my-work.test 22, actions.test, sections.test 7, integration 9 incl. my_work_columns own-rows + composite-FK guard). tsc+lint clean. 3 pre-existing integration failures (finish-story-from-git/promote insert iterations directly -> lockdown 0e3ca32; move-copy labels-unique 6c0c7ad) are unrelated.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-opus-4-8
created: 2026-07-22 09:17
---
Owner decision 2026-07-22: implement 138->139->140 as one continuous Opus session (tight page.tsx coupling makes a 138-only shim throwaway). 140's Sonnet assignment overridden to Opus for this chain. Commit per task boundary. 141 (free-column UI) remains separate.
---

author: @claude-opus-4-8
created: 2026-07-22 09:43
---
rls-security-reviewer: CLEAN (empirically verified vs reset DB — composite-FK cross-user guard, column-list SET NULL, RLS all-ops, handle_new_user ACL preserved, mapping drop orphans nothing). Ready to merge pending owner verification.
---
<!-- COMMENTS:END -->
