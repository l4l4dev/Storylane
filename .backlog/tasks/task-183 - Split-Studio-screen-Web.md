---
id: TASK-183
title: Split Studio screen (Web)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 04:08'
updated_date: '2026-07-24 09:43'
labels: []
milestone: m-6
dependencies:
  - TASK-181
  - TASK-184
documentation:
  - doc-18
type: feature
ordinal: 2300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Full-feature Split Studio focus screen at /stories/[id]/split (doc-18 §7, no MVP trim). Web-first. Entry: story detail overflow menu "Split" (labelled 分割する/Split, never "convert to epic").
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two panes: left = source story title/description/tasks read-only; right = dynamic list of new child cards (title/description/story_type/tentative points)
- [ ] #2 Text-selection cut-out: selecting description text and "extract as a new story" appends a right card seeded with the selection
- [ ] #3 Drag-and-drop reassignment of existing source tasks onto right cards; points total compares right cards sum vs source old points; pre-commit preview
- [ ] #4 Commit calls split_story; on success returns to board/List with the new container expanded (no teleport, ux-principles §8/§10)
- [ ] #5 ends with a fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
From TASK-181 /code-review (split_story RPC gaps the Split Studio UI must cover):
- epic_color: split_story inherits the source's epic_color, which is NULL for a normal story -> a split-born epic is colorless. The Studio should let the user pick the epic's color and pass it through (split_story may need an epic_color param, or set it here). doc-18 §2/§7.
- Studio must prevent assigning one task to two children (drag = one target); the RPC silently keeps a duplicated task_id on the first child only.
- Studio must validate child title/points/task_ids before commit; split_story surfaces raw Postgres errors for a missing title / malformed uuid. (Points are now also scale-validated server-side by the TASK-181 follow-up.)

epic_color detail (TASK-182 /code-review): the dropped epics table defaulted color to '#6366f1'. split_story inherits the source's epic_color, which is NULL for a normal story, so a split-born epic is colorless — a regression vs the old promote path. The Studio should pick/default the epic color (default #6366f1 if no picker).
<!-- SECTION:NOTES:END -->
