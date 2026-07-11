---
id: TASK-42
title: >-
  Rework Note / Iteration break insertion UX (hover line too small, appears
  unpredictably)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:19'
updated_date: '2026-07-11 17:26'
labels:
  - web
  - ux
milestone: m-0
dependencies: []
priority: medium
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: the '+ Note / + Iteration break' inline hover line in the List view is hard to use — the hit target is a thin line, and it flickering in/out on focus confuses the user, even though positional insertion itself works.

Direction (options proposed to the owner 2026-07-11; confirm variant before implementing): keep positional insertion but make it discoverable and stable —
A) row context menu ('Insert note above/below', 'Insert iteration break above/below') as the primary path, hover line stays as a power-user shortcut with a taller hit area;
B) persistent small '+' handle in the row gutter that opens the same menu;
C) move Note/Break into the group-level Add composer (type selector) and drop the hover line.
Whatever variant: hit target at least a full row height on hover, no layout shift when it appears.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Notes and iteration breaks can be inserted at a chosen position without pixel-hunting a thin line
- [ ] #2 The affordance does not shift surrounding rows when appearing
- [ ] #3 Tests cover insertion at top, middle, and bottom positions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECIDED (owner, 2026-07-11): variant A — row-menu insertion. Each List row's '…' (or right-click) menu gets 'Insert note above/below' and 'Insert iteration break here'. The hover line stays as a secondary shortcut with a taller hit target (full row-gap height) and must not shift layout when appearing.

Follow spec/ux-principles.md (landed with TASK-46), especially principles 3 (no layout shift) and 7 (honest hit targets). End with a fable-advisor design review before manual verification.
<!-- SECTION:NOTES:END -->
