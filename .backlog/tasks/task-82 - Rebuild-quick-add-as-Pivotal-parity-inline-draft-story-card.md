---
id: TASK-82
title: Rebuild quick-add as Pivotal-parity inline draft story card
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 02:53'
updated_date: '2026-07-18 03:20'
labels:
  - web
  - ux
dependencies:
  - TASK-84
  - TASK-91
priority: high
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The current quick-add is Trello-style: an always-visible "+ Add story" trigger per group/column opening a title-only composer. The owner finds it intrusive and too limited, and a previous compaction pass made it too small to read. Tracker-parity research (2026-07-18, per spec/ux-principles.md "Tracker-parity verification") found original Pivotal did neither: each panel (Current/Backlog/Icebox/Epic) has a single small "+ Add Story" icon at the top; clicking it opens an inline DRAFT STORY DETAIL card in the panel — the full story form (type, estimate, labels, requester, description) with title the only required field — saved via a Save button or Cmd/Ctrl+S, new stories placed at the top of the panel. Source: https://web.archive.org/web/2024id_/https://www.pivotaltracker.com/help/articles/adding_stories/ . Decision (doc-8 §10): rebuild to Pivotal parity, reusing the existing story detail form for the draft card. A Linear-style global quick-add shortcut is explicitly deferred until My Work is implemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each board panel shows exactly one small "+" add trigger in its header; per-group and per-column always-visible triggers are removed
- [ ] #2 Clicking the trigger opens an inline draft story card at the top of that panel with the full field set (type, points, labels, description); only the title is required
- [ ] #3 Save button and Cmd/Ctrl+S both save; Esc or clicking outside discards the draft without creating a story
- [ ] #4 Saved story appears at the top of the panel and the draft card closes (Pivotal parity: no auto-reopen)
- [ ] #5 fable-advisor design review against spec/ux-principles.md passes with findings triaged
- [ ] #6 pnpm test passes
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 03:05
---
Ordering constraint from advisor review (doc-8 §10): start only after free-mode removal (TASK-84) so the composer is not rebuilt against boards that are about to disappear.
---

created: 2026-07-18 03:20
---
Dep added (advisor 2nd pass): the draft story card renders state/transition controls, which become project_states-driven in TASK-91 — build the composer once, against the new model.
---
<!-- COMMENTS:END -->
