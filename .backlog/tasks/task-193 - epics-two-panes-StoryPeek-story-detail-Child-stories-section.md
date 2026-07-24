---
id: TASK-193
title: /epics two panes + StoryPeek + story detail Child stories section
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:16'
labels:
  - web
milestone: m-6
dependencies:
  - TASK-189
documentation:
  - doc-20
type: feature
ordinal: 1770
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §6. Opening an epic today shows a plain story detail: no children, no progress (owner defect 4). /epics only links out to it.

Turn /epics into two panes (epic list with roll-up progress on the left, the selected epic's children on the right) and let a child open in the existing StoryPeek — the same component and peekStoryId URL parameter the board and My Work already use, so no new detail screen is built. The container's own story detail gains a Child stories section using the same child-row component as the Epics band (TASK-190).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /epics renders the epic list and the selected epic's children in two panes
- [ ] #2 Clicking a child opens the existing StoryPeek (peekStoryId) with its description, tasks and comments — no new detail screen
- [ ] #3 A container's story detail gains a Child stories section: roll-up progress bar, child rows with their location, and add-a-child
- [ ] #4 The Epics band, /epics and the detail section share one child-row component
- [ ] #5 The /epics empty state points at + Add Epic instead of the old split-an-oversized-story wording
- [ ] #6 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->
