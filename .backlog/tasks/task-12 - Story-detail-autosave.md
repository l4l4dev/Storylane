---
id: TASK-12
title: Story detail autosave
status: To Do
assignee: []
created_date: '2026-07-07 14:26'
labels:
  - web
dependencies: []
references:
  - spec/screens.md
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md 'Story detail editing': remove Save buttons from the side peek and /stories/[id]. Title/description autosave on ~800ms debounce and on blur (Esc reverts); discrete fields save on change; a 'Saving… / Saved' indicator sits in the peek header; failed saves keep the local value with error + retry; Realtime updates must not clobber a field being edited.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No Save button remains in the side peek or /stories/[id]
- [ ] #2 Title and description autosave after debounce and on blur; Esc reverts to last saved value
- [ ] #3 Saving/Saved indicator reflects in-flight state; save failure shows an error, keeps local value, and offers retry
- [ ] #4 An incoming Realtime update does not overwrite a field with uncommitted local edits
- [ ] #5 Tests cover debounce save, blur save, Esc revert, and failure retry
<!-- AC:END -->
