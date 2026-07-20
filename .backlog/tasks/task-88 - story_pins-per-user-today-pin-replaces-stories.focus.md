---
id: TASK-88
title: 'story_pins: per-user today pin replaces stories.focus'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
updated_date: '2026-07-20 01:16'
labels:
  - web
  - db
milestone: m-5
dependencies:
  - TASK-83
priority: high
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §9 data layer. New table story_pins(user_id, story_id) PK; RLS: SELECT/DELETE user_id = auth.uid(); INSERT WITH CHECK user_id = auth.uid() AND membership in the storys project; no cross-user reads. Drop stories.focus (no data migration, pre-launch) and its CHECK constraint remnants. Lifecycle integration: move_story_to_project recreates pins on the new story id for pinners who are members of the destination project and discards the rest (inside the existing SECURITY DEFINER RPC, spec/features.md Move/Copy); remove_member deletes the removed users pins in that project so they cannot revive on re-invite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 story_pins exists with the specified RLS; RLS tests prove no cross-user visibility and member-only INSERT
- [ ] #2 stories.focus is dropped; no code references remain
- [ ] #3 Move carries pins per the rule; remove_member deletes pins; both covered by integration tests
- [ ] #4 rls-security-reviewer pass on the migration
- [ ] #5 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Design fixed by Fable advisor 2026-07-20. (1) Migration: story_pins(user_id uuid REFERENCES profiles ON DELETE CASCADE, story_id uuid REFERENCES stories ON DELETE CASCADE, created_at timestamptz DEFAULT now(), PRIMARY KEY(user_id, story_id)) + index on story_id (move/cascade lookups). RLS: SELECT/DELETE USING user_id = auth.uid(); INSERT WITH CHECK user_id = auth.uid() AND EXISTS(membership in the story's project via stories join). No cross-user read path at all. Remember GRANTs (sharp-edges: policy without grant silently 401s). No composite-FK needed — project scoping is enforced through the stories join in the policy. (2) Same migration: DROP stories.focus + its CHECK; pre-launch, no data migration (locked decision). (3) SEQUENCING DECISION: the Focus view code (focus-board.tsx, lib/utils/focus.ts, kanban-board focus toggle + focusColumnForStory usage) is deleted in THIS task, not TASK-89 — the column drop breaks it, and AC#2 requires no code references; TASK-89 then only builds My Work. Board toggle becomes List/Kanban here (TASK-77 view persistence already stores only list|kanban, so no storage change). (4) Replace move_story_to_project + remove_member functions in a new migration: move recreates pins on the new story id only for pinners who are members of the destination (SECURITY DEFINER — re-check membership per pinner, sharp-edges rule); remove_member deletes the removed user's pins on that project's stories. (5) Integration tests: RLS visibility matrix, member-only INSERT, move-carries/discards pins, remove_member purge. (6) rls-security-reviewer pass on the migration (AC#4), then full suite.
<!-- SECTION:PLAN:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-opus-4-8
created: 2026-07-18 11:46
---
Coordination flag (do not start standalone yet): TASK-88 drops stories.focus at the DB layer, but TASK-89 (My Work, being worked in another session) removes the Focus-view UI that reads stories.focus. The column drop must land WITH or AFTER the Focus-view UI removal, or the app breaks. Sequence with TASK-89 before implementing. Also depends on TASK-84 landing (migration numbering + database.types.ts regen). Needs fable-advisor + rls-security-reviewer review (new table + RLS).
---
<!-- COMMENTS:END -->
