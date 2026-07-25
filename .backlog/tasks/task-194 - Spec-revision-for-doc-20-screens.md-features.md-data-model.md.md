---
id: TASK-194
title: 'Spec revision for doc-20: screens.md, features.md, data-model.md'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:16'
updated_date: '2026-07-25 13:31'
labels:
  - docs
milestone: m-6
dependencies:
  - TASK-192
  - TASK-193
documentation:
  - doc-20
type: task
ordinal: 1780
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §7. The spec still describes the shipped-but-superseded shape: containers living in the Icebox accordion, expanding only their Icebox children, and is_container as a purely child-derived flag. Once TASK-189..193 land, bring the spec back to the truth so the next session does not re-derive it from commits.

Run last, after the behaviour it documents is merged.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 spec/screens.md 'Container accordion' section is rewritten to the Epics band (all children, location dots, no drag handle on mirror rows) and the two-line story rows
- [ ] #2 spec/features.md Move/Copy container note matches the new attach rule
- [ ] #3 spec/data-model.md documents epic_pinned and the derived is_container = has_children OR epic_pinned
- [ ] #4 doc-18 §1/§4/§9 are marked as superseded by doc-20 where they are referenced
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-192 (2026-07-25) requires one extra spec edit here, per the fable-advisor verdict on that task: doc-20 §7's asset table row for move_story_board's parent_id delta currently reads 'survives, but the caller stops sending state/iteration changes with it'. That turned out to be unimplementable — move_story_board's position machinery has no skip-position path and its no-anchor branch unconditionally writes position = max(position)+1, so any attach routed through it violates §5's 'position untouched'. Attach now goes through a dedicated set_story_parent RPC (migration 20260725131513) and move_story_board's parent delta has ZERO callers. Rewrite that §7 row to say so explicitly ('survives but is uncalled; set_story_parent is the only attach path'), or a future session will read the table and wire attach back through the delta.
<!-- SECTION:NOTES:END -->
