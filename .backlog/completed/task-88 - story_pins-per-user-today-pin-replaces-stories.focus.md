---
id: TASK-88
title: 'story_pins: per-user today pin replaces stories.focus'
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-18 03:04'
updated_date: '2026-07-20 08:27'
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
- [x] #1 story_pins exists with the specified RLS; RLS tests prove no cross-user visibility and member-only INSERT
- [x] #2 stories.focus is dropped; no code references remain
- [x] #3 Move carries pins per the rule; remove_member deletes pins; both covered by integration tests
- [x] #4 rls-security-reviewer pass on the migration
- [x] #5 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Design fixed by Fable advisor 2026-07-20. (1) Migration: story_pins(user_id uuid REFERENCES profiles ON DELETE CASCADE, story_id uuid REFERENCES stories ON DELETE CASCADE, created_at timestamptz DEFAULT now(), PRIMARY KEY(user_id, story_id)) + index on story_id (move/cascade lookups). RLS: SELECT/DELETE USING user_id = auth.uid(); INSERT WITH CHECK user_id = auth.uid() AND EXISTS(membership in the story's project via stories join). No cross-user read path at all. Remember GRANTs (sharp-edges: policy without grant silently 401s). No composite-FK needed — project scoping is enforced through the stories join in the policy. (2) Same migration: DROP stories.focus + its CHECK; pre-launch, no data migration (locked decision). (3) SEQUENCING DECISION: the Focus view code (focus-board.tsx, lib/utils/focus.ts, kanban-board focus toggle + focusColumnForStory usage) is deleted in THIS task, not TASK-89 — the column drop breaks it, and AC#2 requires no code references; TASK-89 then only builds My Work. Board toggle becomes List/Kanban here (TASK-77 view persistence already stores only list|kanban, so no storage change). (4) Replace move_story_to_project + remove_member functions in a new migration: move recreates pins on the new story id only for pinners who are members of the destination (SECURITY DEFINER — re-check membership per pinner, sharp-edges rule); remove_member deletes the removed user's pins on that project's stories. (5) Integration tests: RLS visibility matrix, member-only INSERT, move-carries/discards pins, remove_member purge. (6) rls-security-reviewer pass on the migration (AC#4), then full suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Two migrations: 20260720000004_story_pins.sql (table + 3 RLS policies + stories.focus drop) and 20260720000005_pin_lifecycle.sql (move_story_to_project pin carry-over, remove_member pin purge).

Beyond the recorded plan, two live readers of stories.focus had to be replaced in the same change or they would have broken only at call time, not at migration time (plpgsql/PostgREST resolve columns late): move_story_board (replaced focus-free inside migration 004) and the MCP moveStory handler in apps/mcp/src/handlers.ts (focus dropped from the select and from p_expected). The MCP one was caught by the rls-security-reviewer pass, not by the initial grep.

Focus-view UI deleted here per plan item 3 (focus.ts, focus.test.ts, focus-board.tsx, setStoryFocus action, the Focus toolbar button). Board toggle is now List/Kanban only; BoardView collapsed to two values and the now-trivial selectView wrapper was inlined. The existing 'ignores a legacy Focus value when restoring the saved view' test already covers users with focus persisted in localStorage.

Verification: supabase db reset applies all 63 migrations cleanly; web suite 620/620 with SUPABASE_INTEGRATION=1 (incl. 7 new story-pins.integration.test.ts cases), 461 passed / 159 skipped without it; MCP suite 21/21; tsc --noEmit clean in apps/web and apps/mcp; ESLint clean; git diff --check clean. rls-security-reviewer: no holes in either migration (no-UPDATE-policy deny-by-default confirmed empirically, INSERT subquery not bypassable, pin insert correctly ordered before the source-story cascade, remove_member purge correctly project-scoped, grants covered by the schema default privileges).

Also fixed one type error introduced by TASK-62 (actions.test.ts: after() mock implementation was not callable under tsc because AfterTask includes a bare promise). It passed pnpm test and lint, so only tsc caught it.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-opus-4-8
created: 2026-07-18 11:46
---
Coordination flag (do not start standalone yet): TASK-88 drops stories.focus at the DB layer, but TASK-89 (My Work, being worked in another session) removes the Focus-view UI that reads stories.focus. The column drop must land WITH or AFTER the Focus-view UI removal, or the app breaks. Sequence with TASK-89 before implementing. Also depends on TASK-84 landing (migration numbering + database.types.ts regen). Needs fable-advisor + rls-security-reviewer review (new table + RLS).
---
<!-- COMMENTS:END -->
