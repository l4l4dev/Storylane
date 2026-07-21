---
id: doc-12
title: >-
  My Work Todo Doing Today Done rework and navigation restructure design
  2026-07-21
type: specification
created_date: '2026-07-21 07:56'
updated_date: '2026-07-21 07:56'
---


Follow-up to doc-11 (My Work / personal-tasks rework). Two independent threads
from dogfooding feedback: (A) restructure My Work's sections into a daily-
planning model (Todo/Doing/Today/Done) instead of Today/Assigned, plus
per-project row color coding; (B) restructure the sidebar's top navigation
(My Work as a fixed link, project creation moved into the Projects switcher)
and revise TASK-104's "New project" placement.

## Thread A — My Work sections: Todo / Doing / Today / Done

### Current state
`spec/screens.md` "My Work" (doc-8 §9, TASK-89): two sections, **Today**
(a personal project's current-iteration stories, no pin needed, plus anything
pinned) and **Assigned** (everything else, grouped by project — personal
first, then name; board position order within a group). The base query
excludes Icebox and done-category stories entirely — done history is each
project's own Iterations page's job, explicitly not duplicated here.

`buildMyWorkSections` (`apps/web/lib/utils/my-work.ts`) implements the
Today/rest split as a pure function; `my-work/page.tsx` fetches stories,
project states, pins, and (for personal projects only) each one's current
iteration id, then calls it.

### New section model (4 sections, priority order, no story in two sections)

1. **Done** — `completed_at` within the last **7 days**, grouped by date
   (Today/Yesterday/date headers), newest first. A pinned-but-done story
   still shows here, not in Today — completion always wins placement.
2. **Today** — unchanged: a personal project's current-iteration stories
   (automatic) + anything the user has pinned (`story_pins`), regardless of
   project. This is deliberately NOT changed to a pure-pin model — the
   existing automatic personal-project inclusion stays.
3. **Doing** — state category `in_progress`, excluding anything already in
   Today. Naming: "Doing" (not "In Progress" or "Progress") to match this
   project's own minimal state template vocabulary (Todo/Doing/Done,
   `20260719000006_stories_state_id.sql`) and keep the four section labels
   single-word/parallel (Todo/Today/Doing/Done).
4. **Todo** — everything else assigned, non-Icebox, non-done, not in
   Today/Doing. Same grouping as the old "Assigned" (personal projects
   first, then name; board position order). Preserves the existing "rejected
   stays visible" behavior (only the `done` category is excluded, matching
   today's filter — not a new decision, just not changed).

Pinning stays the exact mechanism for "move something into Today" the owner
asked for — no new mechanism needed, it already exists (`story_pins`,
row toggle + story peek's overflow menu).

### "Current iteration" filter (Todo + Doing)

A client-side toggle ("Only current iteration") narrows Todo and Doing to
stories whose `iteration_id` equals *their own project's* current iteration
— hides backlog/unscheduled assigned work. No persistence (resets on reload)
— add later if it turns out to matter.

Requires resolving each story's own project's current-iteration id for
EVERY project the user has assigned stories in, not just personal ones
(today `currentIterationByProject` is computed only for personal projects,
for the rollover call) — this is a real query-scope expansion.

### Per-project row color

Today's left-border accent is binary (`isPersonal ? primary : none`). Change
to a color keyed per project (not just personal-vs-team) so rows from
different team projects are visually distinguishable at a glance. Exact
palette/assignment mechanism (hash-based deterministic color? a stored
per-project color?) is an implementation-phase decision, not fixed here —
flag for the dataviz skill's palette guidance if a categorical palette is
built.

### New query needs
- A **Done query**: current base query excludes done entirely; need a
  separate fetch for `completed_at >= now() - 7 days`, still scoped to
  assigned + non-Icebox + the user's non-archived projects.
- **Current-iteration id per project**, not just personal ones (for the
  filter toggle).
- `buildMyWorkSections`-equivalent pure logic needs a 4-way split function
  (todo/doing/today/done) replacing the current 2-way one — new unit tests
  replace/extend `my-work.test.ts`.

### Spec impact
`spec/screens.md` "My Work" section fully rewritten (section list, per-
project color, current-iteration filter, Done's 7-day window). doc-8 §9 is
superseded by this doc for section structure (kept for the general "cross-
project personal view" framing and the pin mechanism, both unchanged).

## Thread B — Sidebar navigation restructure

### Current state
`app-sidebar.tsx`: a single dropdown at the top serves as BOTH the "My Work
vs current project" indicator and the project switcher. Its trigger shows
"My Work" or the current project's name; its content lists "My Work" first,
then a "Projects" label + project list + an "All projects" link to
`/dashboard`. TASK-104 added a "New project" button on `my-work/page.tsx`
itself, navigating to `/dashboard?new=1` (the existing inline create panel,
pre-opened).

### New structure
- **My Work becomes a fixed, always-visible top-level nav link** (with an
  icon), styled like a nav item and highlighted when active — no longer one
  of several items inside the dropdown.
- **The Projects dropdown stays directly below it**, unchanged in mechanism
  (switcher: favorites first, then name; "All projects" link at the bottom)
  minus the now-removed "My Work" entry.
- **The dropdown trigger button grows slightly**: `size="sm"` (h-7) →
  `size="default"` (h-8) for an easier target — `components/ui/button.tsx`'s
  existing size scale, no new CSS.
- **A "+ New project" entry is added inside the Projects dropdown** (near
  "All projects" at the bottom), navigating to `/dashboard?new=1` — same
  mechanism TASK-104 already built, just a different entry point.
- **TASK-104's "New project" button is REMOVED from `my-work/page.tsx`**.
  Project creation becomes exclusively the sidebar/Projects-switcher's job;
  My Work's own header keeps only the personal-task quick-add. This is a
  deliberate revision of TASK-104's design, not an oversight — noted on that
  task and in spec.

### Rejected alternative (from the same conversation)
A "dashboard" treatment on My Work itself — a strip of project cards (with
"+ New project" as one more card) rendered above the Todo/Doing/Today/Done
sections — was proposed and explicitly rejected: the owner wants project-
related actions to stay the sidebar/navigation's job, keeping My Work
scoped to personal task management. Recorded here so it isn't re-proposed.

### Spec impact
`spec/screens.md` "Navigation" section updated for the fixed My Work link +
enlarged switcher + New-project-in-dropdown. TASK-104 gets a comment noting
this doc supersedes its "New project" placement.

## Task decomposition

Two independent tasks (no dependency between them):

1. **Thread A**: My Work Todo/Doing/Today/Done rework — new 4-way split
   function + tests, Done query, per-project current-iteration resolution,
   current-iteration filter toggle, per-project row color, spec update.
   Migration/RLS-sensitive only if the Done query needs new columns/indexes
   (unlikely — completed_at already exists and is indexed for iterations
   history; confirm during planning). fable-advisor design review required
   (new section layout + color scheme).
2. **Thread B**: Sidebar nav restructure — fixed My Work link, switcher
   resize, New-project-in-dropdown, remove My Work page's New-project button
   (revises TASK-104). No DB changes. fable-advisor design review required.

## Risks / open points

- Thread A's per-project color: needs a concrete palette decision at
  implementation time (dataviz skill guidance) — not blocking design
  approval, but flagged so it isn't skipped.
- Thread A's "current iteration per project" query expansion: confirm no
  N+1/performance concern for a user with many project memberships (likely
  fine — small counts in practice, but worth a quick look during planning).
- Thread B's TASK-104 revision: make sure the removal doesn't leave My Work
  with zero project-creation affordance for a user who never opens the
  sidebar dropdown — acceptable given the sidebar is always visible now
  (unlike before, where the switcher had to be opened to see "My Work" too).

## Process gate

Per repo CLAUDE.md, user-facing UI changes end with a fable-advisor design
review against `spec/ux-principles.md` before manual verification. This doc
is the input to that review for both threads (and, since Thread A likely
touches only existing tables/columns, may not need an additional
rls-security-reviewer pass — confirm at planning time whether the Done query
needs anything beyond `completed_at`, which already exists).
