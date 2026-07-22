---
id: doc-14
title: >-
  14 — My Work Kanban rework design 2026-07-21 — own status model, project state
  sync, navigation cleanup
type: specification
created_date: '2026-07-21 12:07'
updated_date: '2026-07-22 09:03'
---
# My Work Kanban rework — own status model, project state sync, navigation cleanup

Supersedes doc-11 and doc-12 Thread A (My Work's section model) and
doc-12 Thread B's navigation follow-up. Reopens TASK-93 (personal project
cadence), TASK-103 (personal project scoping — unaffected, kept), TASK-104
(onboarding link), and TASK-108 (the four-section rework just shipped this
session) for rework. Makes the pending TASK-125 (My Work efficiency cleanup)
partly obsolete — see "Impact on existing tasks" below.

Origin: owner dogfooding feedback (2026-07-21), gathered through an extended
clarifying dialogue across two rounds (this doc consolidates both — see
"Resolved design questions" for the trail of what was asked and decided).

## Problem statement

Three separate but related complaints from dogfooding the current (TASK-108)
My Work implementation:

1. **My Work should read as a real Kanban board**, not four vertically
   stacked read-only lists. The current implementation has no drag
   interaction at all (`spec/screens.md`: "No reordering inside My Work
   ... it is a read view").
2. **Navigation is confusing around personal (ad-hoc) tasks.** The
   auto-created "My Tasks" personal project (TASK-93) is hidden from the
   dashboard grid and the sidebar's Projects switcher (TASK-103), but a
   personal-task story's detail page still links "← Board" to
   `/projects/{id}/board` — the *only* way to reach "My Tasks" as a full
   project (Board/Epics/Iterations/Activity/Settings nav), with no way back
   to it from the sidebar afterwards. This is confusing because that page
   isn't meant to be a destination at all. (Resolved: this — not Todo's
   ordering — turned out to be the whole "Backlog should only live in the
   project" discomfort from the first round of this conversation.)
3. **"Today" leaning on iteration machinery is more complexity than My Work
   needs.** Status changes (moving a story through its lifecycle) matter;
   sprint/iteration processing doesn't.

## Resolved design questions — round 1

- **Kanban layout, not stacked lists**: the four sections (Todo/Today/
  Doing/Done) stay conceptually, but render as side-by-side draggable
  columns, matching a real Kanban board's interaction model.
- **Today is a personal marker, not an automatic iteration membership.**
  The current design (`spec/screens.md`) auto-populates Today from "a
  personal project's current-iteration stories" — reusing the 1-day-cadence
  iteration mechanism as a stand-in for "today's plan." This is decoupled
  entirely: Today membership is **only** set by the user dragging a card
  into the Today column (or dragging it back out) — no automatic inclusion
  from any project's iteration state, no separate manual pin *button*
  either (the drag itself is the affordance). Moving into/out of Today
  **never changes the story's real project state** — it's a personal
  "what I'm focusing on today" marker, orthogonal to actual progress.
  - Precedence (unchanged from doc-12): **Done > Today > Doing > Todo** — a
    story already Done never shows in Today even if dragged there (accepted
    work doesn't need "today" framing); a story that's genuinely
    `in_progress` on its real board AND marked Today shows in **Today**, not
    Doing — Today is "what I'm intentionally working on today" even if it's
    not brand new work.
- **Doing/Done are real, cross-project status changes — but through
  My Work's own status field, optionally synced.** The biggest structural
  change from today's model:
  - My Work maintains **its own status** for each (user, story) pair —
    independent of the story's actual `state_id` on its home project.
  - Dragging a card to Doing/Done in My Work **always** updates this
    My-Work-local status.
  - **If the project has a Doing/Done mapping configured** (see below),
    the drag **also** transitions the story's real `state_id` on its home
    project — kept in sync for as long as the mapping is valid.
  - **If the project has no mapping configured** ("unmapped" is an explicit,
    always-available choice), the drag updates My Work's view only — the
    real project is untouched. This is an accepted, permanent divergence
    for unmapped projects, not a stopgap: "My workとprojectのステータスは
    できれば同期していてほしいぐらいの箇所で分離されているものとして扱いた
    い" (My Work's status and the project's status should be treated as
    separate — "ideally in sync" is aspirational, not enforced).
- **Per-project Doing/Done mapping, owner-configured, re-confirm on drift.**
  Each project can independently map "My Work Doing" and "My Work Done" to
  one of its own `project_states` rows (or leave either/both unmapped). If
  the mapped state is later deleted or changes category (an owner editing
  that project's states), the mapping breaks — the affected user needs to
  be notified and asked to reconfigure, not fail silently.
- **The "My Tasks" personal project's 1-day cadence loses its purpose.**
  It existed only to make "today's iteration" double as My Work's Today —
  which no longer exists in this model. The personal project itself is
  still needed (a story needs a `project_id`/`state_id` home for ad-hoc,
  non-team tasks), and auto-creating one at signup for onboarding still
  makes sense, but its cadence stops being load-bearing.
- **Navigation for personal tasks**: a personal-project story's "← Board"
  link goes to `/my-work` instead of `/projects/{id}/board`. Direct URL
  access to the personal project's own pages is out of scope for this pass
  (rare case, can be revisited separately).

## Resolved design questions — round 2

1. **Todo's ordering/grouping is unchanged** from doc-12 (grouped by
   project, personal-first then name, board-position order within a
   group). The "Backlog should only live in the project" discomfort from
   round 1 turned out to be the navigation confusion above (My Tasks
   appearing unexpectedly), not Todo's presentation — already addressed by
   the back-link fix. Confirmed: My Work is Kanban-only, no List-view
   variant.
2. **Dragging into Todo never syncs to the project, mapped or not.** Only
   forward moves (Todo/Today → Doing, anything → Done) write to the real
   project when mapped. **To Todo** is always a `my_work_story_state`-only
   write, exactly like Today — never a real project state transition,
   regardless of mapping. (There is no "todo-equivalent" mapped state to
   design for — backward moves are always local.)
3. **Mapping-broken notification**: a plain alert/banner surfaced on the
   My Work page itself (not a project-side notification, not an activity
   log entry) — e.g. "This project's Doing/Done sync is no longer valid,
   reconfigure in Settings." Exact trigger condition and dismissal behavior
   is implementation detail.
4. **Reassignment behavior**: if a story's `assignee_id` changes away from
   a user who had customized `my_work_story_state` for it, that row is left
   alone (harmless orphan; My Work's Todo/Today/Doing scope naturally stops
   including it once `assignee_id` no longer matches).
5. **My Work's scope narrows: no more pinning stories that aren't assigned
   to you.** The current `story_pins`-based Today (and the story peek's
   "Pin to My Work" menu item, available on *any* story regardless of
   assignment) is **removed** — Today-marking is only available on stories
   already in My Work's base scope. This is a real behavior change from
   what's shipped today, not just a rename.

   **Done becomes a personal, append-only completion log — entries never
   disappear, even across reopen-and-redo.** "自分にアサインされていないもの
   は表示しない。ただしDoneのみログのような形で表示されるのが望ましい...
   Doneにした後に他のメンバーをアサインしてプロジェクト側で進行しても、自分
   が行ったタスクとして表示は残しておく" (Done should stay a log; a
   reassignment afterward must not remove it) — and confirmed explicitly:
   "チケットの中身は更新されるが消えない...チケットにはそのチケットの更新
   ログが残る形にしておいてほしい" (the ticket's own content keeps updating
   live; the ticket's own update history is separately preserved, unaffected
   by this). So a completion, once logged, is permanent — reopening and
   later re-completing (by anyone) adds a **new** entry rather than
   overwriting or clearing the old one. Todo/Today/Doing stay scoped to
   **current** `assignee_id`; Done is scoped to **every time the viewer
   completed this story**, which can happen more than once and never
   retroactively vanishes. See "Proposed data model" for the mechanism.

## Proposed data model

**This section is the author's (Claude's) concrete proposal to resolve the
"how is My Work's own status actually stored and kept in sync" question —
the owner confirmed the *behavior* above but this schema was not
independently validated and needs fable-advisor + owner sign-off before
implementation.**

### `my_work_story_state` (new table, replaces `story_pins`)

```
user_id       uuid references profiles(id)
story_id      uuid references stories(id) on delete cascade
is_today      boolean not null default false   -- the personal "today" marker
local_status  text check (local_status in ('todo','doing','done')) null
updated_at    timestamptz not null default now()
primary key (user_id, story_id)
```
(plus an index on `story_id` alone, matching `story_pins`' existing shape —
`supabase/migrations/20260720000004_story_pins.sql:16-24` — for the reverse
lookup "who has this story customized," used by cascade-adjacent cleanup and
by any future admin/debug view.)

- Replaces `story_pins` outright: the old boolean pin *was* already "is this
  in my Today," so folding it into this table's `is_today` column is a
  rename with richer siblings, not a parallel concept. The plain-write,
  RLS-scoped-to-own-rows character of `story_pins` (doc-8 §9) carries over —
  **but its cross-project reach does not** (round 2, #5): a row here is
  only meaningful for stories in My Work's own base scope
  (`assignee_id = user_id`), not an arbitrary story. The story peek's "Pin
  to My Work" menu item on a not-assigned-to-you story is removed. (Done's
  scope is separate — see `story_completions` below — since it's keyed by
  completion history, not this table.)
- `local_status` is **only meaningful when the story's project has no
  Doing/Done mapping** — it's the override the user set by dragging in an
  unmapped project. `null` means "not yet touched — derive from the real
  state category" (the same fallback the current `buildMyWorkSections`
  already does).
- When a project **is** mapped, Doing/Done classification is **computed
  from the real `state_id`/category** (via the mapping, see below) — no
  `local_status` write happens, so a mapped project's Doing/Done can never
  drift from its real board. This is what makes "ideally in sync" literal
  for mapped projects: there is only one source of truth.
- `is_today` always behaves the same regardless of mapping — it's the one
  column that's never derived from project state.

### `project_my_work_mapping` (new table)

```
project_id      uuid references projects(id) on delete cascade primary key
doing_state_id  uuid references project_states(id) null  -- on delete set null
done_state_id   uuid references project_states(id) null  -- on delete set null
configured_by   uuid references profiles(id) null
updated_at      timestamptz not null default now()
```

- One row per project (owner-configured in Settings — exact UI is
  implementation detail, not a design blocker).
- `on delete set null`: if the mapped state is deleted, the mapping falls
  back to unmapped automatically. The *notification* (round 2, #3) is a
  UI-layer concern (e.g., a banner keyed off `doing_state_id is null and
  configured_by is not null`) — needs a concrete mechanism decided during
  implementation planning, not blocking this design's approval.
- A state changing **category** (still existing, just no longer
  `in_progress`/`done`) is not caught by `on delete set null` — this needs
  either a trigger invalidating the mapping on a category change, or the
  read-side classification logic treating a category-mismatched mapping as
  effectively unmapped (recommended: the latter — simpler, no trigger, and
  the Settings UI can still show "mapping configured but no longer valid"
  by comparing live).
- **RLS (fable-advisor, round 3): follows the `integrations` table's exact
  pattern** (`supabase/migrations/20260627000007_integrations.sql` — same
  shape of "a project-level config row, owner sets it, members can read
  it") rather than `project_states`' member-writable pattern, which doesn't
  fit here: `select` gated by `is_project_member(project_id)`; `insert`/
  `update`/`delete` gated by `project_role(project_id) = 'owner'`.

### `story_completions` (new table — append-only, never updated or deleted)

```
id           uuid primary key default gen_random_uuid()
story_id     uuid not null references stories(id) on delete cascade
user_id      uuid not null references profiles(id)
completed_at timestamptz not null default now()
```
(plus an index on `(user_id, completed_at desc)` — the Done log's actual
query shape, per fable-advisor round 3.)

- One **new row inserted** every time a story transitions into a `done`
  category from a non-done one — `user_id = new.assignee_id` (credit goes
  to whoever was assigned at the moment of completion, matching how
  Todo/Today/Doing are scoped by assignee elsewhere, not whoever physically
  performed the drag — `activity_logs.actor_id` is a different person when
  a PM finishes a story on someone else's behalf, which is why this doesn't
  reuse that column). Added to the same `maintain_story_completed_at`
  trigger's "entering done" branch as an additional `insert`, alongside its
  existing `completed_at := now()` on `stories` — one trigger, two effects,
  same migration. **Guarded by `new.assignee_id is not null`** (fable-advisor
  round 3): a story can be created directly into a done-category state with
  no assignee (copy/API/seed path) — without the guard, `story_completions.
  user_id not null` would reject the insert and the story creation itself
  would fail.
- **The trigger must be redeclared `security definer`** (fable-advisor round
  3, a real bug the doc's first draft assumed away): the current
  `maintain_story_completed_at` (`supabase/migrations/20260719000008_
  reanchor_board_mechanics.sql:286-320`) is SECURITY INVOKER. Since
  `story_completions` intentionally has **no client INSERT policy at all**
  (matching the TASK-110 "only a trigger writes it" precedent), adding the
  insert to an invoker-rights trigger would make **every** transition into a
  done category — on My Work *and* on a project's own Board — fail with a
  permission error the instant this migration lands, not just a My Work
  edge case. The migration must `create or replace function
  public.maintain_story_completed_at() ... security definer ...` (the whole
  function body, following this function's own established precedent of
  full replacement across its four prior redefinitions — no partial patch).
- **Nothing here is ever updated or deleted.** Reopening a story (leaving
  `done`) does not touch this table at all — `stories.completed_at` still
  clears per the existing trigger (that's the CURRENT-state column, used by
  velocity/finalize and the story's own display), but the **historical**
  completion record in `story_completions` persists permanently. If the
  story is later re-completed — by the same person or someone else — that
  inserts a **second, independent** row; it does not overwrite the first.
  This directly satisfies "チケットの中身は更新されるが消えない...自分が
  行ったタスクとして表示は残しておく": the ticket's live content
  (`stories.*`) keeps changing normally, while every completion the viewer
  is credited with stays in their permanent Done log, unaffected by
  anything that happens to the story afterward.
- Not derived from `activity_logs` despite it already recording
  `story.state_changed` events: its `actor_id` is who performed the action
  (not necessarily the assignee — RLS allows any project member to
  transition any story), and its payload stores state **names**, not
  category, so reliably identifying "did this enter a done-category state"
  would mean re-resolving names against `project_states` at query time
  (fragile across renames). A dedicated table sidesteps both problems and
  gives a direct, indexed `where user_id = viewer` filter for the Done log.
- RLS on `story_completions`: `select` scoped to `user_id = auth.uid()` (own
  rows only, matching `story_pins`'s existing pattern); no client-side
  `insert`/`update`/`delete` policy at all — the trigger is SECURITY
  DEFINER, and there is no legitimate direct-write path (mirrors the
  `iterations` INSERT lockdown reasoning from TASK-110: if only a trigger
  ever writes it, only a trigger should be allowed to).
- **This migration must also extend `stories`' own SELECT RLS** (fable-
  advisor round 3, the sharpest edge case in this doc, confirmed real): the
  current policy (`supabase/migrations/20260627000005_stories_tasks.sql:
  53-55`) is `using (is_project_member(project_id))` only. Since a story's
  assignee can leave the project after completing it (`remove_member` RPC,
  `20260715000004_membership_admin_rpcs.sql`) while doc-14's whole premise
  is that their Done log entry — live-joined to the story's current data —
  must keep working, the policy needs an OR clause:
  ```sql
  using (
    public.is_project_member(project_id)
    or exists (
      select 1 from public.story_completions sc
      where sc.story_id = stories.id and sc.user_id = auth.uid()
    )
  )
  ```
  Without this, `story_completions`' own RLS (scoped to the viewer's own
  rows) is not enough — the *joined* `stories` row becomes unreadable the
  moment the viewer stops being a project member, silently breaking the
  "never disappears" guarantee this whole design exists to provide.

### Classification (replaces `buildMyWorkSections`)

Two different base scopes feed the four columns (round 2, #5): Todo/Today/
Doing are scoped to stories **currently** assigned to the viewer; Done is
scoped to the viewer's own **completion history** (`story_completions`),
independent of current assignment.

1. A `story_completions` row exists for this story with `user_id = viewer`
   → **Done**, once per row (a story completed twice by the same viewer
   renders as two log entries, on whichever two dates they happened —
   matches the "ログ" framing literally; each entry joins live to the
   story's *current* title/points/state for display, not a snapshot).
2. Else (so: `assignee_id = viewer`, non-Icebox, currently not done) — if
   `is_today` → **Today**.
3. Else, compute **effective status**:
   - Project mapped for the `in_progress` category → derive from real
     `state_id`.
   - Project unmapped → `local_status` if set, else derive from real
     category the old way (`in_progress` → Doing, everything else → Todo).
4. Effective status `doing` → **Doing**; otherwise → **Todo**.

### Dragging a card (the write path)

- **To Today / out of Today**: upsert `my_work_story_state.is_today`. No
  project write, ever.
- **To Doing/Done, project mapped**: call **`set_story_state(p_story_id,
  p_state_id)` only** with the mapped state id (fable-advisor round 3:
  `move_story_board` was over-scoped for this — it carries board-position/
  optimistic-concurrency machinery (`p_view`/`p_anchor`/`p_expected`) that
  My Work has no equivalent of, since there's no reordering inside My Work;
  `set_story_state` alone is sufficient and its authorization — stories'
  UPDATE RLS, owner or `assignee_id = auth.uid()` — already matches My
  Work's own Todo/Today/Doing base scope exactly). Reuses `set_story_state`'s
  existing rules unmodified: the not-yet-estimated feature gate, and
  automatic current-iteration assignment on entering `in_progress`
  (`supabase/migrations/20260719000007_set_story_state.sql:74-93`).
  - **Known consequence, not a blocker**: that auto-iteration-assignment
    branch raises `'No active iteration'` if the target project has none —
    reintroducing an iteration dependency through this one path, even
    though doc-14's whole point elsewhere is decoupling Today from
    iterations. My Work's drag UI must catch this specific RPC error and
    show it as a visible banner (ux-principles.md principle 2 — never a
    silent failed drag), since My Work's UI is otherwise iteration-unaware.
- **To Doing/Done, project unmapped**: upsert `my_work_story_state.
  local_status`. No project write.
- **To Todo (from Today, Doing, or Done)**: always a `my_work_story_state`
  -only write (clear `is_today` and/or set `local_status := 'todo'`), never
  a real project state transition — mapped or not (round 2, #2).

## Impact on existing tasks

- **doc-11, doc-12 Thread A**: superseded by this doc.
- **doc-12 Thread B / TASK-109**: unaffected — sidebar restructure stands.
- **TASK-93** (auto-create personal project at signup): the project itself
  still gets created; its 1-day-cadence choice stops being functionally
  load-bearing for My Work. No code change expected unless simplification is
  wanted later — not blocking.
- **TASK-103** (`is_personal` flag + hiding from lists): unaffected, still
  correct.
- **TASK-104** (onboarding → My Work, New-project entry): unaffected.
- **TASK-108** (Todo/Today/Doing/Done sections, just shipped this session):
  **superseded** — `buildMyWorkSections`, `MyWorkSections`, the "Only
  current iteration" toggle, and the current-iteration-fetching in
  `my-work/page.tsx` all get reworked or removed per this doc. The
  per-project accent color and row component largely carry over (styling,
  not classification logic).
- **TASK-125** (pending, low-priority efficiency cleanup — batching the
  per-project current-iteration N+1 query in `my-work/page.tsx`): **the
  current-iteration fetching this task was going to optimize goes away
  entirely** in the new model (My Work no longer needs any project's
  current-iteration id for its own classification). TASK-125 needs
  descoping to drop that item; its other three items (dashboard N+1,
  sequential invite RPCs, the my-work-sections.tsx double-recompute this
  doc's own predecessor introduced) are unaffected and still valid.

## Process gate

Per repo CLAUDE.md: new tables + an algorithm rewrite this size requires a
fable-advisor review before implementation, in addition to the usual
rls-security-reviewer pass once migrations are drafted and a fable-advisor
UI design review against `spec/ux-principles.md` before manual verification.

**fable-advisor design review: approve-with-changes (2026-07-21).**
Classification logic (Done > Today > Doing/Todo precedence, Done's
completion-history scope vs. Todo/Today/Doing's current-assignee scope) had
no internal contradictions. Six corrections required, all now folded into
the sections above: (1) `stories`' SELECT RLS needed an OR clause for
`story_completions` owners — without it, a story's own row becomes
unreadable the moment its completer leaves the project, breaking the
"never disappears" guarantee; (2) `maintain_story_completed_at` must be
redeclared `security definer` — otherwise this migration breaks *every*
done-category transition project-wide (not just My Work) since
`story_completions` has no client INSERT policy; (3) `project_my_work_
mapping` had no RLS at all in the first draft — now specified, matching the
`integrations` table's owner-writes/members-read pattern; (4) the write
path uses `set_story_state` only, not `move_story_board` (over-scoped for
this — no board-position/optimistic-concurrency need here); (5) mapped
Doing/Done drags can surface `set_story_state`'s existing `'No active
iteration'` error — needs a visible banner, not a silent failure; (6) minor
indexing/cascade gaps (`my_work_story_state.story_id`, `story_completions
(user_id, completed_at)`, `project_my_work_mapping`'s `on delete cascade`).

## Round-4 addendum (2026-07-22, fable-advisor approved — implemented in TASK-131)

Recorded here after the fact; TASK-131's ACs #11/#12 and comments #2/#3 were
the implementation contract and carry the full trail.

- The "Done > Today > Doing > Todo" **exclusive** precedence above was
  internally contradictory (Done keys on completion *history*, the other
  columns on *current* state). Resolution: **Done is an additive axis.** Any
  `story_completions` row for the viewer always renders in Done (one entry
  per row); Todo/Today/Doing are evaluated independently, gated only by
  current-real-category ≠ done. A story completed earlier and now reopened,
  in progress, and assigned to the viewer appears in **both** Done (log) and
  Doing (live) — the Done-column instance carries a completion marker.
- An **unmapped**-project drag to Done sets `local_status = 'done'` and
  classifies as **Done** — a cancellable local mark, *not* a
  `story_completions` entry. Accepted asymmetry: mapped Done = permanent
  log, unmapped Done = local mark (within round 1's "unmapped is a
  permanent divergence" stance).

## Round-5 addendum (2026-07-22, owner decision) — personal project auto-mapping; banner scope

- **Personal project ("My Tasks") gets a default mapping automatically.**
  Its Settings page is unreachable by design (TASK-103 hiding + TASK-129
  back-link), so it could never be mapped by hand — leaving personal-task
  Done a local mark forever, never entering the permanent Done log, which
  defeats My Work's primary use case. Owner decision (2026-07-22): at
  personal-project creation, also insert a `project_my_work_mapping` row
  (first `in_progress`-category state → Doing, first `done`-category state
  → Done), plus a one-time backfill for existing personal projects.
- If those mapped states later drift (deleted or recategorized via direct
  URL / MCP), the **standard broken-mapping behavior applies unchanged**
  (read-side treats it as unmapped; My Work banner) — no personal-specific
  mechanism.
- **Banner scope clarified** (settles round 2 #3's open trigger question,
  matches the shipped TASK-133 implementation): the banner fires only on a
  **category mismatch** of a still-existing mapped state. A *deleted* mapped
  state falls back to "Not mapped" silently — with the current schema it is
  indistinguishable from a column the owner never configured.
