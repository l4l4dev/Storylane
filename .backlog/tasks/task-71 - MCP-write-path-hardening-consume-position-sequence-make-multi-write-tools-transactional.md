---
id: TASK-71
title: >-
  MCP write-path hardening: consume position sequence, make multi-write tools
  transactional
status: To Do
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-17 13:15'
labels:
  - mcp
  - db
milestone: m-3
dependencies:
  - TASK-48
priority: high
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex review 2026-07-17, apps/mcp/src/handlers.ts. (1) set_story_tasks inserts tasks with explicit position: i, so tasks_position_seq is not consumed — a later plain task INSERT gets a default position that can collide with an MCP-written row and fail on the deferred UNIQUE (story_id, position) constraint (position invariant from TASK-58 says every positioned INSERT must consume the sequence). (2) set_story_tasks does DELETE-then-INSERT in two separate requests — an INSERT failure leaves the checklist wiped. (3) setLabels has the same non-transactional replace (also hit via update_story labels-only). (4) createStory commits the story then applies labels; a label failure returns an error while the story remains, so an agent retry duplicates it. Fix direction: move replace/create+label flows into small RPCs (or accept sequence-consuming inserts via DEFAULT and reorder) so each tool call is atomic; follow the position-invariant doc in spec/data-model.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All MCP task inserts consume tasks_position_seq (no explicit position values that bypass the sequence); regression test creates tasks via MCP then via plain INSERT without constraint failure
- [ ] #2 set_story_tasks, setLabels (incl. update_story labels), and create_story+labels are each atomic — induced failure leaves prior state intact, verified by failure-path tests
<!-- AC:END -->
