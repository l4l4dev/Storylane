---
id: TASK-194
title: 'Spec revision for doc-20: screens.md, features.md, data-model.md'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:16'
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
