---
id: doc-12
title: >-
  My Work Todo Doing Today Done rework and navigation restructure design
  2026-07-21
type: specification
created_date: '2026-07-21 07:56'
updated_date: '2026-07-21 08:04'
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

## Advisor corrections (2026-07-21, fable-advisor — Thread A approve-with-fixes, Thread B approved)

- **Render order vs. classification priority (Thread A, required fix — ux-principles.md principle 9):** doc-12 conflated "which section a story is classified into" (Done > Today > Doing > Todo, no story in two sections — this stays exactly as designed) with "top-to-bottom render order" (wrongly implied Done first). Principle 9: "Archived or done things group in their own clearly-labelled section below active ones — never interleaved or sorted first." **Default render order is Todo → Doing → Today → Done (Done LAST)**, not Done-first. If Done-first is ever wanted for a specific reason, that needs explicit owner approval + a recorded spec deviation — not the default.
- **"completed_at already indexed" claim was wrong (Thread A, correction, no migration needed):** the only story indexes are `stories_project_id_idx` / `stories_iteration_id_idx` / `stories_epic_id_idx` — no index on `completed_at` or `assignee_id`. At current dogfooding scale this is fine (RLS narrows by project_id first); the design note should say "no index needed now — add `stories (assignee_id, completed_at)` later if the Done query is measurably slow," not claim one already exists.
- **"Does rollover need to run for team projects too" is already answered by existing code (Thread A, no new design needed):** `apps/web/app/dashboard/page.tsx` already calls `projectsNeedingRollover` + `rolloverIterationSafely` (`apps/web/lib/supabase/rollover.ts`) across ALL of a user's projects, not just personal ones — idempotent (early-return if `end_date >= today`) and already reviewed for the advisory-lock/concurrency angle (spec/velocity.md "Finalization concurrency & permissions"). My Work's current-iteration resolution should reuse this exact pattern (swap `personalProjects.map(...)` for `projectsNeedingRollover(projects)`), not re-derive a new one.
- **Precedence walkthrough confirmed correct, no edge case found:** `project_states.category` is one of `unstarted/in_progress/done/rejected` — `rejected` is neither done nor in_progress, so it always falls to Todo, matching doc-12's "rejected stays visible" note. Pinned + in_progress + iteration-ends-today all resolve unambiguously through Done > Today > Doing > Todo.
- **Per-project row color scope must be decided before task breakdown (Thread A, open point to close, not a blocker):** the sidebar's project switcher currently has no per-project color, and no color-hash utility exists in the repo. Decide explicitly: is this color LOCAL to My Work only, or a project-identity color meant to eventually also appear in the sidebar/dashboard cards? Record the answer in the task, don't leave it implicit.
- **iOS / packages/core:** no `/my-work`-equivalent screen exists in `apps/ios` yet, so decision-1's shared-golden-fixture constraint doesn't apply to the new 4-way split function yet — keep it in `apps/web/lib/utils/my-work.ts` (YAGNI, matches the existing 2-way function's location).
- **Thread B approved as designed, no changes.** Confirmed: no dead code/test from removing TASK-104's My-Work-page button (that page has no test file; `InlineCreatePanel`'s `defaultOpen`/`?new=1` mechanism is reused, not duplicated, by the new sidebar entry). The asymmetric fixed-link-vs-dropdown treatment doesn't violate any ux-principles.md principle (no principle requires nav-item symmetry). Implementer note: `apps/web/components/features/shell/app-sidebar.test.tsx` needs updating for the fixed link + removed dropdown entry + trigger resize; TASK-104 needs an explicit `backlog` comment recording the supersede (already planned in this doc, don't skip it).


## Per-project color scope decision (owner, 2026-07-21)

Project-common color, not My-Work-local: the color is a project-identity
concept meant to eventually also appear in the sidebar's project switcher
and any future dashboard cards — not something private to My Work's row
rendering. Implementation implication: a shared, deterministic utility
(project id -> color, hash-based) lives in a shared location
(`apps/web/lib/utils/`), not inline in `my-work-row.tsx` — so the sidebar
switcher can call the same function later without duplicating the mapping.
No new `projects.color` DB column for now (YAGNI — a deterministic hash from
the existing project id is enough; revisit only if per-project color needs
to become owner-customizable). Thread A's task should build this utility
even though only My Work consumes it today; Thread B / a later task can
apply it to the sidebar without redesigning the color scheme.
