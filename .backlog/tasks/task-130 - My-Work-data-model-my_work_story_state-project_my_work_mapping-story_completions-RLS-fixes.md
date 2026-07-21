---
id: TASK-130
title: >-
  My Work data model: my_work_story_state, project_my_work_mapping,
  story_completions + RLS fixes
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-21 12:34'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 12700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-14 (My Work Kanban rework) foundation migration. Replaces story_pins with my_work_story_state (is_today + local_status, no cross-project pinning of unassigned stories); adds project_my_work_mapping (per-project Doing/Done -> project_states mapping, owner-configured); adds story_completions (append-only personal completion log, never updated/deleted, drives Done). Includes the 3 fable-advisor-mandated fixes: stories' SELECT RLS gets an OR clause for story_completions owners (a completer leaving the project must not lose read access to their own Done entry); maintain_story_completed_at is redeclared SECURITY DEFINER (required since story_completions has no client INSERT policy — without this every done-category transition project-wide breaks, not just My Work's) with a new.assignee_id is not null guard before inserting; project_my_work_mapping RLS follows the integrations table's owner-writes/members-read pattern. See .backlog/docs/doc-14 for the full design (already fable-advisor approved-with-changes, this task implements it as written).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 my_work_story_state table created (user_id, story_id, is_today, local_status, updated_at; PK (user_id, story_id); on delete cascade + story_id index), replacing story_pins (data migration or clean cutover -- story_pins' existing is_today-equivalent rows are dropped since cross-project pinning of unassigned stories is being removed, per doc-14 round 2 #5)
- [ ] #2 project_my_work_mapping table created (project_id PK on delete cascade, doing_state_id/done_state_id nullable on delete set null, configured_by, updated_at) with RLS: select=is_project_member, insert/update/delete=project_role=owner (matches integrations table)
- [ ] #3 story_completions table created (id, story_id, user_id, completed_at; index on (user_id, completed_at desc)), RLS: select where user_id=auth.uid(), no client insert/update/delete policy at all
- [ ] #4 maintain_story_completed_at is redeclared SECURITY DEFINER (full function replacement, not a partial patch) and its entering-done branch inserts into story_completions (user_id = new.assignee_id) guarded by new.assignee_id is not null
- [ ] #5 stories' SELECT RLS policy gets an OR clause: is_project_member(project_id) OR exists a story_completions row for (story.id, auth.uid()) -- a story's own row must stay readable to whoever completed it even after they leave the project
- [ ] #6 story_pins table and its RLS/grants are dropped (superseded); the story peek's 'Pin to My Work' menu item on stories not assigned to the viewer no longer has a backing table -- verify no remaining references before dropping
- [ ] #7 rls-security-reviewer pass is clean; migration passes local supabase db reset; pnpm test + lint green
- [ ] #8 spec/data-model.md and spec/rls.md updated for the new tables/policies
<!-- AC:END -->
