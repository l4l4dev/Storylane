---
id: TASK-82
title: Rebuild quick-add as Pivotal-parity inline draft story card
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 02:53'
updated_date: '2026-07-20 09:58'
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
- [x] #1 Each board panel shows exactly one small "+" add trigger in its header; per-group and per-column always-visible triggers are removed
- [x] #2 Clicking the trigger opens an inline draft story card at the top of that panel with the full field set (type, points, labels, description); only the title is required
- [x] #3 Save button and Cmd/Ctrl+S both save; Esc or clicking outside discards the draft without creating a story
- [x] #4 Saved story appears at the top of the panel and the draft card closes (Pivotal parity: no auto-reopen)
- [x] #5 fable-advisor design review against spec/ux-principles.md passes with findings triaged
- [x] #6 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Design fixed by Fable advisor 2026-07-20. Parity target per task description (Wayback-verified). (1) Extract the story field editors (type, points w/ estimate scale, labels, description) from story-detail-panel.tsx into a shared fields component; story-detail-panel keeps autosave wiring, the new draft card uses local state + explicit save — do NOT fork the field markup. (2) New draft-story-card.tsx replaces quick-add-composer.tsx: rendered inline at the top of a panel; title required, all else optional; Save button + Cmd/Ctrl+S (guard event.isComposing per review-sharp-edges IME rule); Esc / click-outside discards silently (Pivotal parity, AC#3); failed create keeps input + inline error (spec/screens.md quick-add failure rule). (3) Triggers: List view = one small '+' in each panel header (Current / Backlog / Icebox); Kanban = one '+' on the unstarted-category column header (OPEN QUESTION logged with owner; default = keep). Remove all per-group always-visible triggers. (4) Placement: INSERT takes position from stories_position_seq (position invariant — never hand-pick a position), then reuse the existing board move/reposition path to place the story at the top of the panel in the same server action. (5) Delete quick-add-composer.tsx/.test.tsx; update board tests. (6) End with fable-advisor design review vs spec/ux-principles.md (AC#5) then full suite. No new tables, no RLS work.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete.

Built: StoryFields shared field-editor component (components/features/story/story-fields.tsx), extracted verbatim from story-detail-panel.tsx's JSX (pure refactor, its 16 existing tests pass unchanged); DraftStoryCard + DraftStoryTrigger (components/features/board/draft-story-card.tsx); createDraftStory server action (app/projects/[id]/board/actions.ts) composing existing RPCs only — insert_board_item (Backlog) or a plain insert (Icebox/Current) for create+position, move_story_board (empty deltas = reposition-only, same mechanism a drag uses) to place unstarted/icebox targets at the panel's top, then update_story (existing, reused unchanged) for every other field. No new migrations. Wired into Kanban's unstarted column header, List's Current/Backlog/Icebox panel headers (Backlog's old per-virtual-iteration-group composers removed entirely — one header trigger for the whole panel now, landing before the panel's first row via the existing nextRealRowIds[0] anchor regardless of group), and My Work's solo-personal-project quick-add (ported from the old composer). Deleted quick-add-composer.tsx and its test.

fable-advisor design review (AC#5) ran twice: first pass approved with one required fix — Kanban's unstarted column and List's Icebox column each have their own independent-scroll body (overflow-y-auto) below a header that stays visible regardless of scroll position; opening the draft card (always inserted at the body's top) could land off-screen with no visible feedback if the user had scrolled down, violating spec/ux-principles.md principle 2. Fixed with a scrollIntoView({block:'nearest', behavior:'smooth'}) on mount in DraftStoryCard itself (List's Current/Backlog panels have no separate scroll container, so it's a no-op there). jsdom has no scrollIntoView implementation at all, so a small polyfill was added to vitest.setup.ts (Element.prototype.scrollIntoView, only if absent) — global, reusable by any future component. Advisor's other four review points (losing 'stays open for consecutive adds', icon-only trigger with no visible label, Backlog's insertion point moving from per-group to whole-panel-top, the layout shift when the card opens) all passed with no changes needed — cited established precedent elsewhere in the codebase for each.

Verification: pnpm test (non-integration) 498 passed / 159 skipped; SUPABASE_INTEGRATION=1 full suite 658 passed; tsc --noEmit and pnpm run lint clean in apps/web. Browser verification NOT done — the Claude-in-Chrome extension was not connected this session; dev server was left running (pnpm dev, localhost:3000) for the owner's own check.

No new integration test was added for createDraftStory itself (it's a TS-orchestrated sequence of existing RPC calls, not new SQL) — its call-shape correctness per target/view is covered by 12 mocked action tests in board/actions.test.ts, and the underlying RPCs' own atomicity/positioning correctness is already proven in insert-board-item.integration.test.ts, move-story-board.integration.test.ts, and update-story.integration.test.ts (the exact 'reposition-only with empty deltas + anchor' call shape used here already has a matching real-DB test case in move-story-board.integration.test.ts's 'reorders a column densely and atomically' test).
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
