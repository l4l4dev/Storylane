---
id: TASK-73
title: IME composition guard for Escape/Enter across inline editors
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 13:15'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
fable-advisor UX review 2026-07-17 (should-fix before deploy — the owner types Japanese daily). story-detail-panel.tsx:222-233 established the isComposing guard pattern, but the Escape (and Enter-submit) handlers elsewhere don't check event.nativeEvent.isComposing, so cancelling an IME conversion with Esc closes the editor and destroys the typed text: quick-add-composer.tsx:103-107, kanban-board.tsx:405-411 (IterationGoalBar), board-list-view.tsx:266-270 (IterationGoalInput) and :600-604 (note input), free-board.tsx:378-381,464-469. Extract one shared helper and apply it to every inline editor's key handlers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 During IME composition, Esc cancels the conversion only (editor stays open, text intact) and Enter commits the conversion only (no submit) in: quick-add composer, IterationGoalBar, IterationGoalInput, note input, free-board column editors
- [ ] #2 Single shared guard helper; tests simulate composition events for at least the composer and one goal editor
<!-- AC:END -->
