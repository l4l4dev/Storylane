---
id: TASK-246
title: >-
  Phase-1 schema: sessions, invites, reset_tokens, project_states, stories,
  activity_logs columns per spec/data-model.md
status: Done
assignee:
  - '@claude-opus-5'
created_date: '2026-09-07 02:54'
updated_date: '2026-09-07 04:15'
labels: []
milestone: m-9
dependencies:
  - TASK-245
references:
  - docs/design/2026-09-05-self-host-rewrite-design.md
  - spec/data-model.md
priority: high
type: feature
ordinal: 200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Design doc §5 and spec/data-model.md carried over to SQLite conventions (text UUIDv7 ids, integer ms instants, text YYYY-MM-DD dates, text+CHECK enums). Tables: sessions (id hash, user_id, expires_at, idle_expires_at, created_at), invites (token_hash, project_id, role, created_by, expires_at, accepted_at, revoked_at), reset_tokens (token_hash, user_id, expires_at, used_at), project_states (id, project_id, name, category CHECK, position, UNIQUE(id,project_id), UNIQUE(project_id,position)), stories (id, project_id, number, title, description, state_id NULL=Icebox with composite FK to project_states(id,project_id), position, estimate, requester_id, assignee_id, completed_at, created_by, timestamps; UNIQUE(project_id,number), UNIQUE(id,project_id)), activity_logs columns finalized (story_id composite FK). Guard triggers with RAISE(ABORT): story number pinned after insert; state category immutable. Provide Drizzle schema, migration 0002, and :memory: harness updates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Migration 0002 creates the listed tables with the listed constraints; bun test proves each UNIQUE/CHECK/FK and both guard triggers reject the forbidden write
- [ ] #2 Schema types are exported from apps/server/src/db/schema and used by later tasks; no test-only table ships in the migration
- [ ] #3 spec/data-model.md 'Position ordering invariant' and 'Composite FK' paragraphs updated to the SQLite wording (deferrable UNIQUE replaced by the two-step reorder)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done on rewrite/phase-1: 8348382 (migration 0003: sessions, invites, reset_tokens, project_states, stories, projects columns; 4 guard triggers; harness seedState/seedStory; spec/data-model.md SQLite wording), ff506c4 (point_scale enforced by RAISE(ABORT) triggers — Drizzle's CHECK path would rebuild projects unsafely; assignee composite FK to project_members without ON DELETE + BEFORE DELETE trigger stories_unassign_on_member_removal), 64f6223 (spec wording). 134 tests. Deferred: points validated against point_scale in the app layer (TASK-250); services must not double-unassign on member removal.
<!-- SECTION:NOTES:END -->
