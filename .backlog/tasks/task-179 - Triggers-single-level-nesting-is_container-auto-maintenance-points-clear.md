---
id: TASK-179
title: 'Triggers: single-level nesting + is_container auto-maintenance + points clear'
status: In Progress
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
updated_date: '2026-07-24 05:53'
labels: []
milestone: m-6
dependencies:
  - TASK-178
documentation:
  - doc-18
type: feature
ordinal: 1800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the DB triggers that keep the hierarchy correct without any dedicated UI (doc-18 §3-§4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 enforce_single_level_nesting rejects parenting under a story that is itself a child, and rejects a story with children becoming a child (max depth 1, symmetric)
- [ ] #2 is_container is recomputed on parent_id INSERT/UPDATE/DELETE for affected old/new parents: true iff >=1 child, false at 0 children
- [ ] #3 on false->true the trigger NULLs points/state_id/iteration_id and writes the old points to activity_logs (SECURITY DEFINER path)
- [ ] #4 tests cover: grandchild rejected, child-with-children rejected, auto true/false flip, points cleared + logged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Migration 20260724_epic_story_unification_triggers.sql: (1) enforce_single_level_nesting BEFORE INSERT OR UPDATE OF parent_id — SECURITY DEFINER; rejects self-parent, cross-project parent (single-col FK has no project guard), grandchild (parent.parent_id not null), and a story-with-children becoming a child. (2) maintain_is_container AFTER INSERT OR DELETE OR UPDATE OF parent_id — recomputes affected old/new parents via recompute_is_container(p_parent): FOR UPDATE lock, is_container = exists(children); on false->true clears points/state_id/iteration_id (completed_at auto-cleared by maintain_story_completed_at) and logs old points to activity_logs ('story.containerized'); on true->false sets is_container=false. All SECURITY DEFINER + revoke execute from public/authenticated (trigger/helper bodies). Verify via supabase db reset. (3) Integration test lib/utils/nesting.integration.test.ts (gated like others): grandchild rejected, child-with-children rejected, cross-project rejected, auto true/false flip, points cleared + activity logged.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done + validated. Migration 20260724054954_epic_story_unification_triggers.sql: enforce_single_level_nesting (BEFORE INSERT OR UPDATE OF parent_id) rejects self-parent, cross-project parent, grandchild, and child-with-children->child; maintain_is_container + recompute_is_container (AFTER, FOR UPDATE lock) derive is_container and on false->true clear points/state_id/iteration_id + log old points ('story.containerized'); completed_at auto-cleared by maintain_story_completed_at. All SECURITY DEFINER + execute revoked from public/authenticated. Verified via supabase db reset. New lib/utils/nesting.integration.test.ts: 5 tests PASS with SUPABASE_INTEGRATION=1 (auto containerize+revert, grandchild rejected, child-with-children rejected, cross-project rejected, self-parent rejected). tsc 0, lint clean, 703 unit pass.
<!-- SECTION:NOTES:END -->
