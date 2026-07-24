---
id: TASK-178
title: 'DB: unify Epic/Story model (drop epics, add parent_id/is_container/epic_color)'
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
updated_date: '2026-07-24 05:18'
labels: []
milestone: m-6
dependencies: []
documentation:
  - doc-18
type: feature
ordinal: 1700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the separate epics table + stories.epic_id label model with a self-referencing 1-level hierarchy on stories (doc-18 §1-§2). Foundation for the whole Epic/Story unification. Migration cost / existing data preservation is out of scope (owner: ideal end state first).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 epics table is dropped; stories.epic_id and its composite FK to epics are removed
- [ ] #2 stories gains parent_id uuid REFERENCES stories(id) ON DELETE SET NULL (NULL = top-level)
- [ ] #3 stories gains is_container boolean NOT NULL DEFAULT false (no client write grant/policy — app-layer read-only) and epic_color text
- [ ] #4 lib/database.types.ts regenerated; queries/tests that referenced epics or stories.epic_id compile against the new schema (repository layers Web/iOS)
- [ ] #5 matches spec/data-model.md + SPEC.md + spec/rls.md (already updated in the doc-18 spec pass)
- [ ] #6 CHECK (NOT is_container OR (points IS NULL AND state_id IS NULL AND iteration_id IS NULL)) on stories makes the container off-the-board property a permanent invariant, not a one-time trigger clear (doc-18 §4, decision-1)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Migration supabase/migrations/<ts>_epic_story_unification_schema.sql: ALTER stories ADD parent_id (self-ref ON DELETE SET NULL), is_container bool NOT NULL DEFAULT false, epic_color text; ADD CHECK(NOT is_container OR points/state_id/iteration_id all NULL); DROP stories.epic_id + composite FK; DROP TABLE epics CASCADE (policies go with it). is_container non-client-writable via column-level GRANT UPDATE (writable cols only) to authenticated. DOWN section. 2. Regenerate lib/database.types.ts. 3. Make Web compile: strip epic_id from story queries/types (stories.ts, board/page, my-work, iterations, story-detail-panel, story-fields, realtime, activity), temporarily neuter epics UI (epics/page, epic-form-dialog etc.) — real container UI deferred to TASK-184; keep promote_story_to_epic removal for TASK-181. 4. Update/remove affected tests. 5. pnpm test + lint from apps/web. iOS Story model: minimal (deferred per Web-first) — flag if AC#4 iOS scope should move to the iOS port task. Verify locally with supabase db reset first.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 1 done on feat/epic-story-unification: migration 20260724043408_epic_story_unification_schema.sql (add parent_id/is_container/epic_color + off-board CHECK; drop stories.epic_id + epics table CASCADE). Verified via supabase db reset (all migrations + seed apply clean). Regenerated database.types.ts (epics gone, new cols present). SCOPE DISCOVERY: update_story RPC (20260708000003) and mcp atomic-write RPC (20260719000003) still take p_epic_id and write stories.epic_id -> now broken. These need redefining to parent_id within TASK-178 to keep the DB coherent (swap epic->parent). Remaining: RPC epic_id->parent_id swap, ~24 TS files compile sweep, test updates, pnpm test+lint. iOS Story model deferred (Web-first).

Slice 2 done + committed (34cf59a, WIP): RPC re-anchor migration 20260724051506 (update_story + create_story_tracker epic_id->parent_id), db reset verified, types regenerated (only promote's epic refs remain, dropped in 181). Remaining TS compile sweep surface (tsc --noEmit): board/page.tsx(38), iterations/page.tsx(24), epics/page.tsx(18), epics/actions.ts(12), stories/[id]/actions.ts(6), my-work/page.tsx(4), lib/types.ts(1) + cascade into components (story-card EpicBadge, story-fields epic dropdown, story-detail-panel, board-list-view, kanban-board, epic UI components) + tests + lint. Approach: strip epic from queries/shapes; neuter epic UI (epics page/actions/components, EpicBadge, epic dropdown) deferring the real container UI to TASK-184; swap TS updateStory epicId->parentId.
<!-- SECTION:NOTES:END -->
