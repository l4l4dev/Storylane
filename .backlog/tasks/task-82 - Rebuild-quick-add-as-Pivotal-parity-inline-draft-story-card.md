---
id: TASK-82
title: Rebuild quick-add as Pivotal-parity inline draft story card
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 02:53'
updated_date: '2026-07-20 01:18'
labels:
  - web
  - ux
milestone: m-5
dependencies:
  - TASK-84
  - TASK-91
priority: high
ordinal: 3000
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Design fixed by Fable advisor 2026-07-20. Parity target per task description (Wayback-verified). (1) Extract the story field editors (type, points w/ estimate scale, labels, description) from story-detail-panel.tsx into a shared fields component; story-detail-panel keeps autosave wiring, the new draft card uses local state + explicit save — do NOT fork the field markup. (2) New draft-story-card.tsx replaces quick-add-composer.tsx: rendered inline at the top of a panel; title required, all else optional; Save button + Cmd/Ctrl+S (guard event.isComposing per review-sharp-edges IME rule); Esc / click-outside discards silently (Pivotal parity, AC#3); failed create keeps input + inline error (spec/screens.md quick-add failure rule). (3) Triggers: List view = one small '+' in each panel header (Current / Backlog / Icebox); Kanban = one '+' on the unstarted-category column header (OPEN QUESTION logged with owner; default = keep). Remove all per-group always-visible triggers. (4) Placement: INSERT takes position from stories_position_seq (position invariant — never hand-pick a position), then reuse the existing board move/reposition path to place the story at the top of the panel in the same server action. (5) Delete quick-add-composer.tsx/.test.tsx; update board tests. (6) End with fable-advisor design review vs spec/ux-principles.md (AC#5) then full suite. No new tables, no RLS work.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-07-20: Kanban '+' = one on the unstarted-category column header (plan item 3 confirmed, no longer open).
<!-- SECTION:NOTES:END -->

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
