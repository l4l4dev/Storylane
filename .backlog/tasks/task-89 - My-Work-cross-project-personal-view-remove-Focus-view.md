---
id: TASK-89
title: 'My Work: cross-project personal view, remove Focus view'
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-18 03:05'
updated_date: '2026-07-20 01:18'
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
- [ ] #1 My Work shows assigned stories from all projects; today = 1-day current iteration + pinned stories; pin/unpin works from the view
- [ ] #2 Personal-project stories are visually distinguished
- [ ] #3 Focus view is gone; board toggle is List/Kanban only
- [ ] #4 fable-advisor design review against spec/ux-principles.md passes with findings triaged
- [ ] #5 pnpm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Design fixed by Fable advisor 2026-07-20 (screen spec for the doc-8 §9 stub; Focus-view removal moved into TASK-88 — see its plan). (1) Route /my-work (already in spec/screens.md routing table) — server component: stories assigned to auth user across projects (RLS scopes membership) + their project (name, iteration_length) + current-iteration ids + the user's story_pins; single query with joins, no client fetching. (2) Screen structure (PROPOSED, owner confirms): section 'Today' = stories in a 1-day project's current iteration (by definition) + pinned stories from longer-cadence projects; section 'Assigned' = everything else grouped by project. Ordering: personal/1-day projects first, then project name; within a group, board position order. Done-category stories drop out of Today once completed_at is set (keep visible until midnight? NO — drop immediately, simplest, Pivotal-like). (3) Pin gestures: pin/unpin icon on row hover in My Work AND in the board story rows + StoryPeek menu (story-peek-menu.tsx) so pinning happens where stories are found; optimistic toggle, plain table INSERT/DELETE through RLS (no RPC needed — self-only writes). (4) Personal-project accent: left border + muted project tag color token, defined once in the shared row component. (5) Sidebar: add My Work entry above project list (spec/screens.md Navigation section gets the addendum). (6) Global quick-add (doc-8 §10 decision deferred to here): OPEN QUESTION with owner — recommended: skip global shortcut for now; My Work header gets a '+' that quick-adds into the personal project. (7) End with fable-advisor design review vs spec/ux-principles.md (AC#4), spec addendum to screens.md My Work section, full suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decisions 2026-07-20: (a) no global quick-add shortcut — My Work header gets a '+' adding into the personal project; (b) Today/Assigned two-section layout confirmed, personal-first ordering, done stories drop out of Today immediately. Plan items 2 and 6 are no longer open.
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
