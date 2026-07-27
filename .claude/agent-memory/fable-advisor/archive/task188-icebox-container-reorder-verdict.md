---
name: task188-icebox-container-reorder-verdict
description: TASK-188 (container/epic row reorder) pre-implementation verdict, 2026-07-25 — corrects TASK-186's scope claim, no new RPC/migration needed
metadata:
  type: project
---

Corrected design verdict for TASK-188, superseding the wrong premise baked into its own task
description (which came from my TASK-186 review — see the correction note in
[[task186-icebox-accordion-drag-design]]).

**No new RPC, no new splice scope, no migration.** Confirmed by reading the live SQL
(`supabase/migrations/20260719000008_reanchor_board_mechanics.sql` for `_splice_backlog`,
`20260724153129_move_story_board_parent_delta.sql` for the current `move_story_board`):

- `_splice_backlog`'s scope is `iteration_id is null and state_id is not null` — the BACKLOG
  zone. A container always has `state_id IS NULL` (`stories_container_off_board` CHECK, doc-18
  §4), so it can never reach this function. Nothing to isolate from.
- `move_story_board`'s `'single'` zone Icebox branch scopes by `state_id is null` alone, no
  `is_container`/`parent_id` filter. Containers, flat Icebox stories, and every container's
  nested children already share ONE dense `stories.position` sequence there — exactly what
  `spec/data-model.md` "the container/child section" already states (children reuse the single
  `stories.position` space, no separate epic-internal scope, doc-18 §2).
- The anchored branch does a bounded range shift (only rows strictly between the vacated old
  slot and the target move) — this preserves relative order of everything outside that range,
  so a container reorder cannot corrupt flat-item or nested-child relative order, and vice
  versa. Only absolute integers shift by ±1 for rows caught inside the range, which is expected
  and already true for any Icebox reorder today.

**AC#2 as originally worded ("new splice scope isolated to (project_id, is_container=true)") is
not just unsatisfiable, it contradicts spec/data-model.md's own text and must be rewritten**, not
loosened. Correct framing: reordering a container reuses `move_story_board`'s existing Icebox
(`'single'` zone) scope — same shared sequence as flat items/nested children — and the
integration test should assert *relative-order invariance* in both directions (container reorder
doesn't reorder flat/nested rows relative to each other; a flat/nested reorder elsewhere doesn't
reorder containers relative to each other), not scope isolation.

**Implementation is pure client wiring**, matching TASK-186's own precedent:
- `containerRows` fetch (`board/page.tsx` ~line 138-143) already orders by `position` but only
  selects `id, number, title, epic_color` — no `position`/`state_id`/`iteration_id`/`parent_id`
  columns needed client-side, because array order alone supplies the anchor for
  `move_story_board`, and `p_expected` can safely hardcode `{state_id: null, iteration_id: null,
  parent_id: null}` — these three fields are permanently pinned to NULL for any container by the
  container CHECK + `enforce_single_level_nesting` (a container can never acquire a parent,
  `20260724054954_epic_story_unification_triggers.sql`), so nothing else can make that snapshot
  stale. The real concurrency protection is the bounded-shift + the existing
  `pg_advisory_xact_lock(positions:project_id)`, unchanged (satisfies AC#3 trivially).
- Give the container block its own dnd-kit container key (new `ListItem` kind `"container"`),
  gate `isAllowedMove` so containers only trade with containers (reject container↔flat,
  container↔any `epic:<id>` nest), and translate its target zone to semantic `"icebox"` before
  calling `dropStoryInList` — same translation pattern TASK-186 used for `epic:<id>`.
- Recommend reassigning the task off `@claude-opus-4-8` to `@claude-sonnet-5`: the
  "architecture-sensitive" justification in the task description (new RPC/position-scope
  design/concurrency) no longer applies once the premise above is corrected — flag this to the
  owner rather than deciding unilaterally.

See [[task186-icebox-accordion-drag-design]] (corrected) and
[[task186-post-implementation-review]] (independent confirmation that `move_story_board`
already treats nested children like flat Icebox rows for position) for the surrounding context.
