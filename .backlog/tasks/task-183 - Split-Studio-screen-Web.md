---
id: TASK-183
title: Split Studio screen (Web)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 04:08'
updated_date: '2026-07-24 04:22'
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
