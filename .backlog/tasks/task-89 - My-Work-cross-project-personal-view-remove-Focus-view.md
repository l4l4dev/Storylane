---
id: TASK-89
title: 'My Work: cross-project personal view, remove Focus view'
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 03:05'
updated_date: '2026-07-20 09:13'
labels:
  - web
  - ux
milestone: m-5
dependencies:
  - TASK-84
  - TASK-88
  - TASK-91
priority: high
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-8 §9 UI. New cross-project view for the signed-in user: stories assigned to them across all projects; a 1-day projects current iteration is todays plan by definition; longer-cadence stories enter today via the personal pin (TASK-88). Personal-project (1-day) stories get a visual accent (e.g. color) distinguishing them from team-project stories. Remove the per-project Focus view (focus-board.tsx and toggle entry); board toggle becomes List/Kanban (interacts with TASK-77 item 6 view persistence — two views only). Screen details (buckets beyond today, ordering, pin gestures) get specced in this tasks plan phase against spec/screens.md and reviewed before implementation. Global quick-add shortcut decision (doc-8 §10) is made here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 My Work shows assigned stories from all projects; today = 1-day current iteration + pinned stories; pin/unpin works from the view
- [x] #2 Personal-project stories are visually distinguished
- [x] #3 Focus view is gone; board toggle is List/Kanban only
- [x] #4 fable-advisor design review against spec/ux-principles.md passes with findings triaged
- [x] #5 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Design fixed by Fable advisor 2026-07-20 (screen spec for the doc-8 §9 stub; Focus-view removal moved into TASK-88 — see its plan). (1) Route /my-work (already in spec/screens.md routing table) — server component: stories assigned to auth user across projects (RLS scopes membership) + their project (name, iteration_length) + current-iteration ids + the user's story_pins; single query with joins, no client fetching. (2) Screen structure (PROPOSED, owner confirms): section 'Today' = stories in a 1-day project's current iteration (by definition) + pinned stories from longer-cadence projects; section 'Assigned' = everything else grouped by project. Ordering: personal/1-day projects first, then project name; within a group, board position order. Done-category stories drop out of Today once completed_at is set (keep visible until midnight? NO — drop immediately, simplest, Pivotal-like). (3) Pin gestures: pin/unpin icon on row hover in My Work AND in the board story rows + StoryPeek menu (story-peek-menu.tsx) so pinning happens where stories are found; optimistic toggle, plain table INSERT/DELETE through RLS (no RPC needed — self-only writes). (4) Personal-project accent: left border + muted project tag color token, defined once in the shared row component. (5) Sidebar: add My Work entry above project list (spec/screens.md Navigation section gets the addendum). (6) Global quick-add (doc-8 §10 decision deferred to here): OPEN QUESTION with owner — recommended: skip global shortcut for now; My Work header gets a '+' that quick-adds into the personal project. (7) End with fable-advisor design review vs spec/ux-principles.md (AC#4), spec addendum to screens.md My Work section, full suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation complete. Design conflict resolution and Done/Icebox exclusion decisions already recorded in earlier notes on this task.

Built: /my-work route (Today + Assigned sections), lib/utils/my-work.ts pure bucketing logic (unit tested), components/features/my-work/my-work-row.tsx row component, story_pins-backed pin/unpin from both My Work rows and the StoryPeekMenu overflow menu, AppSidebar project prop made nullable with a My Work entry added to the switcher dropdown (above the Projects list, reachable from every project page), /my-work/layout.tsx, and a solo-personal-project quick-add composer in the My Work header (doc-8 §10 — no global shortcut; hidden when the user has zero or multiple personal projects).

Refactor: extracted the dashboard's rollover helpers (projectsNeedingRollover, rolloverIterationSafely) into lib/supabase/rollover.ts since My Work needed the same logic — dashboard/page.tsx now imports from there, its own duplicate definitions and test file removed (tests moved to rollover.test.ts). Extracted fetchSidebarData (project switcher list + username) into lib/supabase/sidebar-data.ts, shared by projects/[id]/layout.tsx and the new my-work/layout.tsx.

fable-advisor design review (AC#4): approved with one required fix — the pin toggle's failure path was a silent revert (no visible feedback), violating spec/ux-principles.md principle 2. Fixed in both my-work-row.tsx (inline text below the row) and story-peek-menu.tsx (the dropdown was converted to controlled open state so it can stay open on failure to show the error, closing automatically only on success). Advisor's other four review points (2-section non-reorderable structure, AppSidebar's conditionally-empty nav, quick-add's solo-project gating, general pattern consistency) passed with no changes needed.

Verification: pnpm test (non-integration) 483 passed / 159 skipped; SUPABASE_INTEGRATION=1 full suite 642 passed; tsc --noEmit and pnpm run lint clean in apps/web. Browser verification NOT done — the Claude-in-Chrome extension was not connected this session. Dev server was left running (pnpm dev, localhost:3000) for the owner's own check; deferring the actual click-through to the owner or a later session, consistent with this project's existing pattern of deferring some manual browser checks to TASK-94.

Scope note: the Implementation Plan's item 3 said pinning should also be reachable from board story rows (kanban card + list row hover icons), not just My Work + StoryPeekMenu. That part was deliberately NOT built this pass — it would have required threading a pinned flag through the board's data layer and both card components (StoryCard, StoryListRow), a materially larger footprint than the AC (which only requires pin/unpin to work "from the view"). Flagged to the owner; can be picked up as a small follow-up if wanted.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-18 03:20
---
Dep added (advisor 2nd pass): My Work renders story states cross-project; build against project_states (TASK-91), not the enum.
---

created: 2026-07-18 05:48
---
Screen design decided by the owner 2026-07-18 (doc-8 §9, option A "Today-first single column") — implement this shape and write it into spec/screens.md as part of this task. Buckets top-to-bottom: Today (pinned stories + current-iteration stories of 1-day-cadence projects, personal accent color); Needs review (stories at the accept gate — in an in_progress-category state whose position-wise next state is done-category — where the signed-in user is the requester; Pivotal My Work parity, fetched from the archived mywork_panel help article); In progress (owned, in_progress category); Todo (owned, unstarted category, not pinned); Done (grouped under date headers by completed_at — deliberate divergence, Pivotal excluded accepted by default). Every card shows a small project-name chip. No reordering inside My Work (parity: it is a read view; priority lives on each project board). Accessed from the left sidebar.
---
<!-- COMMENTS:END -->
