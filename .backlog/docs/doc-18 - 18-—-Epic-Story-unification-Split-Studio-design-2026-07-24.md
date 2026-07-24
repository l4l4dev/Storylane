---
id: doc-18
title: 18 — Epic/Story unification & Split Studio design 2026-07-24
type: specification
created_date: '2026-07-24 03:59'
updated_date: '2026-07-24 04:20'
---
# 18 — Epic/Story unification & Split Studio (design of record, 2026-07-24)

Supersedes the separate `epics` table + `stories.epic_id` label model (the
Pivotal "epic = label" shape) and the `promote_story_to_epic` flow (TASK-13,
doc numbering per SPEC.md). Optimizes for the real workflow: **a backlog item
that grew too big is split, in place, into child stories** — the parent stays
and becomes a container. Migration cost and existing-data preservation are
explicitly out of scope; this records the ideal end state.

> Numbering note: the `§N` below are internal sections of this Document,
> referenced from spec as `doc-18 §N` (same convention as `doc-8 §N`). Some
> resolve the source handoff's own "Decision N" labels — they are **not**
> Backlog `decision-N` records. This project keeps Backlog Decisions for durable
> cross-cutting meta-principles only; the sole one is `decision-1` (server-
> authoritative, DB-enforced invariants). A feature-scoped design round like this
> is a Document, matching doc-8 / doc-14 / doc-15.

The name/concept "Epic" is kept, but the entity is just **a story that has
children** (`is_container = true`). Grouping is `parent_id` (1-to-many
hierarchy); `labels` remain the orthogonal cross-cutting tag (many-to-many).
The two coexist independently.

## §1 Board model (owner decision 2026-07-24: "children are primary")

**Children are the board's real items; the container is a collapsed parent.**

- A **child** story is a normal board item: its own `state_id` / `iteration_id`
  / `points`, participates in the board, sprints, and velocity as a terminal
  item, exactly like any story today.
- A **container** never appears in a Kanban column or a sprint. Its `state_id`,
  `iteration_id`, and `points` are forced NULL. Its progress (aggregate state
  and point total) is **derived on read from its children — never stored**.
- Containers are surfaced in two places only: the **List view** as a 1-level
  accordion parent (children nest under it), and the **`/epics` view** as a
  cross-cutting list of containers with roll-up progress.

Rejected alternative (B — "container is the board representative, children are
drill-down"): would require a trigger-maintained `container.state_id` to place
it in a column, complicate `set_story_state`'s guards, and split velocity/
auto-assign into "child counts but isn't shown". It diverges from Pivotal and
from the §3 goals (flat list + 1-level accordion, no tree UI). Not chosen.

## §2 Unified schema (self-reference)

`epics` table is **dropped**. `stories` gains:

```sql
parent_id    uuid REFERENCES stories(id) ON DELETE SET NULL,  -- NULL = top-level
is_container boolean NOT NULL DEFAULT false,  -- trigger-maintained; app-layer read-only (§4)
epic_color   text                             -- meaningful only when is_container = true
```

- `stories.epic_id` and its composite FK to `epics` are removed. `epics.color`
  folds into `stories.epic_color`.
- `epics.position` had a dedicated backlog-ordering scope in the position
  invariant; it is gone. Container ordering lives in the single
  `stories.position` space like any top-level story.
- `story_labels` / `labels` unchanged.
- A container's children reuse their existing `stories.position` for order
  within the parent (the List accordion sorts children by `position`). **No
  second "epic-internal" position scope is introduced** — the handoff sketched
  two scopes, but under §1 a child already carries a board position, and a
  single order key is enough to sort it under its parent. Fewer moving parts,
  no dual-ordering reconciliation.

## §3 Single-level nesting (DB-enforced)

A `BEFORE INSERT OR UPDATE` trigger (`enforce_single_level_nesting`) rejects a
`parent_id` when either (a) the target parent is itself a child
(`parent.parent_id IS NOT NULL`), or (b) the row being parented already has
children of its own. Max depth = 1, symmetric guard.

Kept at depth 1 so that: roll-ups stay a plain `GROUP BY` (no recursive CTE);
velocity / auto-assign stay "terminal stories only"; the position order stays a
single flat space; the UI stays a flat list + 1-level accordion (no tree
widget).

## §4 `is_container` auto-maintenance + points clearing

A trigger on `parent_id` INSERT/UPDATE/DELETE recomputes the affected parent
candidates (old parent, new parent):

- Has ≥1 child → `is_container = true`.
- Drops to 0 children → `is_container = false` (silently returns to a normal
  story; no dedicated "un-epic" button).

`is_container` is never written by the app — clients read it. "Becoming an
epic" and "ceasing to be one" both happen structurally from child membership.

On the `false → true` flip the same trigger path **clears `points`, `state_id`,
and `iteration_id` to NULL** and records the old `points` in `activity_logs`
(audit; the value is otherwise lost). This keeps a container out of the board
zone predicate and the velocity math without every reader special-casing it.
On `true → false` the fields stay NULL (the story can be re-estimated / placed
normally afterward).

**Permanent invariant, not a one-time clear (decision-1):** the flip trigger
only fires on `parent_id` writes, so it alone would let a later direct UPDATE
(`set_story_state`, a points autosave) re-populate a container's board fields.
The off-the-board property must hold *at all times*, so it is DB-enforced by a
CHECK constraint on `stories`:
`CHECK (NOT is_container OR (points IS NULL AND state_id IS NULL AND iteration_id IS NULL))`.
Additionally `set_story_state` gains an `is_container` guard that rejects with a
clear message ("a container has no board state — split/regroup its children
instead") rather than surfacing the raw CHECK violation. The points-update path
is covered by the CHECK alone (a generic error is acceptable there — the UI
never offers a points field on a container).

## §5 Roll-up rule + board / velocity integration

**Roll-up (display only, computed on read; a `packages/core` pure function with
golden fixtures, Web/iOS parity like the advance-button computation):**

Aggregate a container's children by `project_states.category` (evaluated
top-down, first match wins):

- All children `done` → **done**.
- Else **any** child `done`, `in_progress`, or `rejected` (i.e. not all-done but
  some work has started or finished) → **in_progress** (actively-worked). This
  explicitly covers the common "3 done + 2 unstarted" partial-completion case,
  which must read as in-progress, not unstarted.
- Else (every child is unstarted / Icebox) → **unstarted**; if every child is in
  Icebox (`state_id IS NULL`) → **Icebox**.
- The progress bar shows the multicolor category breakdown of children; a
  container with `rejected` children shows the rejected count in its own color
  but does not roll the container's headline state to rejected (rejected is a
  bounce, not a terminal, spec/data-model.md `project_states`).

**Integration — a single `is_container = false` filter is the whole change:**

- Backlog **zone predicate** gains `and is_container = false` (a container must
  never satisfy the backlog zone — it has NULL state/iteration anyway, but the
  predicate is made explicit). Mirror in `_splice_backlog`, `move_story_board`,
  `buildBacklogRows`, `zoneForStory`.
- Velocity "points counted" and the auto-assign / virtual-group backlog walk
  add `is_container = false` (containers carry NULL points → 0 already, but the
  filter also keeps them out of the walk and the group rendering). Children
  count as ordinary terminal stories. Roll-up is display-only and never feeds
  velocity.

## §6 `split_story` RPC (resolves the source handoff's open RPC question)

**`promote_story_to_epic` is dropped; a new `split_story` RPC replaces it. The
trivial "add one child" case needs no RPC** (a plain `stories` INSERT with
`parent_id` set, plus the §4 trigger).

Rationale (recorded per the handoff's ask):

- The only real caller of `promote_story_to_epic` was one web action, and the
  function still referenced columns removed in doc-8 (`stories.state`,
  `custom_status_id`, `swimlane_id`) — it was already dead against the current
  schema. Nothing to preserve.
- The Split Studio commit (§7) is inherently multi-row and transactional:
  insert N child stories under the parent, open `position` gaps from the
  sequence then lower (position invariant rules 1–2), reassign selected tasks,
  clear the parent's points (via §4), and write an audit `activity_logs` row —
  all atomic and server-authoritative (decision-1). That is exactly the
  copy_story_to_project / move_story_board RPC shape.
- Named `split_story` because the user's mental task is *splitting*, not
  *converting* (§7 entry-point wording).

Permission: **owner + member** (the TASK-70 board write model — any member may
operate any story). Splitting is no longer destructive (the parent survives),
so it does not need the old owner-only gate that plain DELETE keeps.
SECURITY DEFINER with `require_project_role(project_id, 'owner','member')`
inside. Setting `parent_id` directly (the "add one child" / re-parent path) is
a plain `stories` UPDATE, covered by the existing unconditional member UPDATE
policy; the §3/§4 triggers enforce integrity.

## §7 Split Studio screen (full feature — no MVP trim)

A focus screen for splitting an oversized story. Route
`/stories/[id]/split` (Web-first, per the Web-before-iOS order). Entry: the
story detail "⋯" menu item **"Split"** (labelled "分割する" / "Split", never
"convert to epic").

Two panes. **Left** = the source story, read-only: title, description, and its
existing `tasks` checklist. **Right** = a dynamic list of new child cards.

Required capabilities:

1. Left pane renders source title/description/tasks read-only.
2. **Text-selection cut-out**: select text in the description and "extract as a
   new story" — creates a right-pane card seeded with the selection as its
   description.
3. **Add child cards** dynamically ("+ new story"); each card has title /
   description / story_type / tentative points.
4. **Drag-and-drop task reassignment**: drag left-pane checklist items onto
   right-pane cards to choose which child inherits each task.
5. **Points total comparison**: sum of the right-pane cards' tentative points
   shown against the source's old points.
6. **Pre-commit preview** of the child stories that will be created.
7. **Commit transaction** (`split_story`): each right card becomes a new
   `stories` row (`parent_id` = source id, `epic_color` inherited from source);
   `position` from `stories_position_seq` with a gap opened per the invariant;
   reassigned tasks move to their target child; **`comments` and `activity_logs`
   stay on the source** (the container), and each child links back to the parent
   ("view parent") as a permanent affordance.
   - **Child landing (reuses the former Promote rule, advisor-reviewed
     2026-07-10):** the RPC reads the source's `state_id`/`iteration_id`
     **before** the §4 trigger NULLs them, and applies them to each child — so
     children land where the split story was, not scattered. Guardrails: if the
     source's `iteration_id` is a `done` iteration, children drop to the backlog
     (`iteration_id = NULL`) instead — never assign into a done iteration
     (spec/velocity.md done-iteration guard). `state_id` carries over only if it
     is `unstarted`-category; otherwise children land in the project's first
     `unstarted`-category state (an `in_progress`/`done`/`rejected` source state
     is not a valid start for fresh children), or stay in the Icebox
     (`state_id = NULL`) if the source was in the Icebox. Children take the
     tentative `points` the user set; **`assignee` is never inherited** (children
     start unassigned).
   - Only **after** capturing the above does the source's `points`/`state_id`/
     `iteration_id` clear and `is_container` flip true (§4). The parent is left
     off the board; its children are ordinary board items from here.

After commit, return to the board / List with the new container expanded
(children visible) — do not teleport elsewhere (ux-principles §8/§10).

## §8 RLS impact

- All `epics` policies are removed with the table.
- `promote_story_to_epic` references in rls.md (owner-only note; the
  activity_logs SECURITY DEFINER writer list) are replaced by `split_story`.
- New `split_story` SECURITY DEFINER RPC, owner/member (§6), with an explicit
  grant (schema is not private-by-default — grant-lockdown backstop).
- `parent_id` writes ride the existing unconditional `stories` member UPDATE
  policy; integrity is trigger-enforced, not RLS.
- The migration set gets an `rls-security-reviewer` pass (project rule for
  migrations).

**Move/Copy of a container is forbidden (data-hazard fix).** Move is
insert-into-target + delete-source; deleting a container source would
`ON DELETE SET NULL` every child's `parent_id`, silently exploding the epic into
orphaned top-level stories, while the target receives an empty row that the §4
trigger immediately reverts to a plain story. So `move_story_to_project` /
`copy_story_to_project` **reject `is_container = true` stories** (RPC guard), and
the story-detail Move/Copy actions are hidden/disabled for a container. A child
(a story *with* a `parent_id`) still moves normally, dropping its `parent_id` on
landing (spec/features.md "Move / Copy"). To relocate a whole epic, move its
children; the emptied container auto-reverts (§4).

## §9 Surfaces

- **`/projects/[id]/epics`** survives as the **container list** (kept route and
  "Epics" nav label): every `is_container` story with its roll-up progress bar,
  linking to the story detail. Replaces the old epics-table list.
- **List view** gains a 1-level accordion: top-level rows are `parent_id IS
  NULL` stories; a container expands to its children (sorted by `position`).
- **Story detail**: the former "Epic" discrete field becomes a **Parent**
  picker (choose an existing container to nest this story under → sets
  `parent_id`; the §3 trigger rejects an illegal choice). The "⋯" menu's
  "Promote to Epic" becomes "Split" (§7).
  - **Confirmation when the pick containerizes the target:** nesting under a
    story that is *not yet* a container flips that target into one (§4), which
    NULLs the target's `points`/`state_id`/`iteration_id` and pulls it off the
    board. That is silent data loss if unconfirmed, so the Parent picker shows a
    confirmation ("X will become an epic and leave the board; its points and
    state are cleared") in that case — parity with the old Promote flow's
    dialog. Nesting under an *already*-container target needs no confirmation
    (nothing is cleared).

## Open items deferred

- iOS port of all of the above follows the Web implementation (Web-first).
- Personal projects (`is_personal`): containers/split are allowed there too and
  are no longer destructive, so the old "Promote-to-Epic data-loss" rationale
  for sealing the hidden project (spec/screens.md onboarding) no longer applies
  as stated — the single-user conclusion stays for the My Work-model reason,
  and that wording is updated, not the conclusion.
