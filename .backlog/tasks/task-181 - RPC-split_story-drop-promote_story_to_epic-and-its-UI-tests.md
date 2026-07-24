---
id: TASK-181
title: 'RPC: split_story + drop promote_story_to_epic and its UI/tests'
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-24 04:07'
updated_date: '2026-07-24 04:22'
labels: []
milestone: m-6
dependencies:
  - TASK-179
documentation:
  - doc-18
type: feature
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decision 5 (doc-18 §6): promote_story_to_epic is removed; a new split_story RPC does the Split Studio bulk commit. The trivial single-child case needs no RPC (plain parent_id UPDATE + the TASK-179 trigger).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 split_story (SECURITY DEFINER, require_project_role owner/member) inserts N child stories under a parent, opens position gaps from the sequence per the invariant, reassigns selected tasks, and relies on the TASK-179 trigger for points-clear/is_container; explicit EXECUTE grant (grant-lockdown test updated)
- [ ] #2 promote_story_to_epic is DROPped (migration); the story-peek-menu Promote item + PromoteToEpicDialog, promoteStoryToEpic action, promoted-epic-banner + board banner render/query params, and activity.ts story.promoted_to_epic case are removed
- [ ] #3 promote.integration.test.ts, the grant-lockdown allowlist entry, and the personal-project-seal-seams promote block are removed/replaced; new tests cover split_story
- [ ] #4 matches spec/rls.md (already updated) and spec/features.md Split section
- [ ] #5 split_story captures the source state_id/iteration_id BEFORE clearing and applies to children (done iteration => backlog; non-unstarted state => first unstarted state; Icebox stays Icebox; assignee not inherited) — doc-18 §6-§7
- [ ] #6 move_story_to_project and copy_story_to_project reject is_container=true stories (RPC guard) so a container Move cannot orphan its children; child move still drops parent_id (doc-18 §8)
<!-- AC:END -->
