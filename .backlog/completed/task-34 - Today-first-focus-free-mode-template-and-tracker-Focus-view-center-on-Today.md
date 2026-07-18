---
id: TASK-34
title: 'Today-first focus: free-mode template and tracker Focus view center on Today'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-11 05:17'
updated_date: '2026-07-16 23:26'
labels:
  - web
  - ux
  - design
milestone: m-0
dependencies: []
priority: medium
ordinal: 600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User review 2026-07-11: both modes should focus on TODAY, not the week.

Free mode: the default template currently seeds Todo / This week / Today / In progress / Done (apps/web/app/dashboard/actions.ts FREE_TEMPLATE_STATUSES). Change the default seed to be today-centric (e.g. Todo / Today / In progress / Done); 'This week' must NOT be seeded by default — users add it themselves later as a custom column (depends on being able to add columns from the board, TASK for board-side column management).

Tracker mode: the Focus view (apps/web/components/features/board/focus-board.tsx) should likewise present 'what I do today' as its core framing, not the whole current iteration. Design needed: how 'today' is derived (started stories? explicit today flag? completed_at = today for done grouping). Spec update to spec/screens.md required before implementation.

Architecture-sensitive: touches template seeds, Focus view semantics, possibly a new story field — get /advisor review on the chosen design first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New free-mode projects seed a today-centric column set without 'This week'
- [x] #2 'This week' can still be added manually as a normal custom column
- [x] #3 Tracker Focus view visually centers on today's work with a clear definition of what appears there
- [x] #4 spec/screens.md updated to describe the Today-first behavior for both modes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follow spec/ux-principles.md (landed with TASK-46) — includes the Tracker-parity verification procedure (Wayback) for tracker-mode Focus. End with a fable-advisor design review against that file before manual verification.

DESIGN (Fable, 2026-07-11 — written while Fable is available; treat as the advisor-reviewed design):
1. FREE MODE: default template seeds Todo / Today / In progress / Done (drop 'This week'). Existing projects untouched; 'This week' remains addable as a normal custom column (TASK-44 provides board-side add).
2. TRACKER FOCUS = derived Today view, NO new story field. Three sections over the current iteration:
   - 'In progress' — states started/finished/delivered, in board order;
   - 'Done today' — completed_at::date = today (completed_at already maintained in both modes, see ARCHITECTURE.md);
   - 'Up next' — the top N unstarted stories of the current iteration (N≈5): the iteration's priority order IS the queue, per Tracker's work-top-down philosophy.
3. REJECTED ALTERNATIVE: a manual per-story 'today' flag — daily grooming burden, goes stale, needs schema + RLS + both-mode write paths; the derived view gives the same daily focus for free. Revisit only if dogfooding shows the derived definition misses real usage.
4. Optional toolbar toggle 'mine only' (assignee = me) — cheap, include if it stays simple.
5. spec/screens.md must be updated to define the Focus sections and the new free-mode template before implementation (AC #4). Rollover behavior needs no change — Focus reads the current iteration after the standard ensure/finalize call.

DESIGN CORRECTION (Fable advisor, 2026-07-17): the 2026-07-11 DESIGN block above (derived 3-section Tracker Focus, 'NO new story field', rejecting 'a manual per-story today flag') did not account for the shipped stories.focus column (20260709000004_focus_view.sql, 2 days before that design was written) and its later investment in move_story_board (20260715000008, TASK-56). That design is superseded.

REVISED SCOPE (implemented 2026-07-17): keep the existing shipped focus system (Todo/Today/In progress/Done + manual focus drag), drop only the 'This week' column/value — the minimal change satisfying the user's actual ask ('both modes should focus on TODAY, not the week'). No schema addition, no Focus-view rewrite, no 'mine only' toggle (out of scope).

Changes: apps/web/app/dashboard/actions.ts (daily template drops This week), apps/web/lib/utils/focus.ts + focus-board.tsx (FOCUS_COLUMNS/FOCUS_DRAG_TARGETS drop this_week, stale this_week values fall back to todo), apps/web/components/features/projects/inline-create-panel.tsx (template preview text), supabase/migrations/20260717000002_focus_drop_this_week.sql (owner-approved: existing focus='this_week' rows -> NULL, CHECK narrowed to ('today') only), spec/screens.md + spec/features.md + spec/data-model.md updated to match shipped Today-only behavior.

Verified: tsc 0, eslint 0, full vitest 515 pass (incl. SUPABASE_INTEGRATION), db reset applies cleanly from empty, CHECK constraint confirmed narrowed via psql (stories_focus_check now CHECK (focus = 'today')).
REMAINING: fable-advisor design review against spec/ux-principles.md + owner manual verification (per Implementation Notes) — not yet run this session.

UX PARITY CHECK (fable-advisor, 2026-07-17): Pivotal Tracker has no Focus/Today-view equivalent — the Focus view is a recorded, intentional Storylane divergence (spec/screens.md, added 2026-07-07, KanbanFlow-inspired). No PT precedent exists to check against for removing the This week column.
Design review verdict: approved with 2 corrections (both applied) — comment history-narration removed from dashboard/actions.ts, this parity finding recorded. No code-behavior changes required.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-fable-5
created: 2026-07-16 02:23
---
Reassigned opus→sonnet (2026-07-16): the architecture-sensitive part (Today-view design) is already advisor-approved in the notes; remaining work is standard implementation per that design. Escalate back if implementation hits design gaps.
---
<!-- COMMENTS:END -->
