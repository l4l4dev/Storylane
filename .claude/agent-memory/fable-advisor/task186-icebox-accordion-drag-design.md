---
name: task186-icebox-accordion-drag-design
description: TASK-186 (doc-18 follow-up) pre-implementation design verdict — icebox accordion drag for containers/nested children, resolved 2026-07-24
metadata:
  type: project
---

Design review verdict for TASK-186 (Icebox accordion drag), given 2026-07-24. If this
task's scope or code shape changes materially, re-verify before trusting the details below.

**Resolved architecture:**
- Do NOT widen `ListZoneId` (`lib/utils/kanban.ts`, closed 3-value union). Containers are
  explicitly documented as never belonging to any zone (`spec/data-model.md` "Backlog zone
  predicate" — `is_container=false` is part of the predicate). `evaluateListDrop` stays
  reserved for state/iteration crossing semantics only.
- Instead, extend the dnd-kit `containers: Record<string, ListItem[]>` state (in
  `board-list-view.tsx`, built via `useOptimisticBoardOrder`) with one extra key per
  container, `epic:<id>`, holding that container's Icebox children. `findContainer`/
  `moveBetweenContainers` (`lib/utils/board.ts`) are already generic over container keys
  (same pattern the Kanban view uses for per-state-column keys) — no change needed there.
  `isAllowedMove` needs one new branch: when `targetZone` starts with `epic:`, translate it
  to semantic zone `"icebox"` before calling `evaluateListDrop`.
- Currently nested children are NOT filtered-in/filtered-out of the flat icebox array —
  they're fully excluded (`board-list-view.tsx` line ~154, `.filter((s) => s.parentId ===
  null)`), so "pure presentation filter over one shared array" alone doesn't make them
  draggable; they need to actually live in a `containers` entry to be a dnd-kit sortable
  member. `EpicAccordionRow` needs its own `useDroppable`+`SortableContext` (mirrors
  `IceboxColumn`'s own pattern) and its children need `SortableListRow`, not the current
  plain read-only `StoryListRow` `<li>`.

**AC-by-AC findings (task's own ACs #1-3):**
- **AC#2 (drag nested child OUT to Current/Backlog): near-zero new backend cost.** doc-18
  §9 explicitly says a child that gains a state "stays in its own zone... unaffected — it's
  still counted in roll-up, just not nested here" — i.e. `parent_id` is NOT cleared on this
  move. This is just the existing icebox→backlog/current `evaluateListDrop`/
  `move_story_board` path, reachable once the dnd-kit wiring above exists. No new RPC.
- **AC#3 (drag Current/Backlog child IN to a container's nest): needs a genuinely new
  atomic RPC capability.** Neither existing RPC covers it alone: `update_story`
  (`supabase/migrations/20260724051506_epic_story_unification_rpcs.sql`) sets `parent_id`
  but never touches `position`; `move_story_board` places position + does the icebox-
  demotion state/iteration write but knows nothing about `parent_id`. Recommended: extend
  `move_story_board` (add an optional parent_id delta + let the anchor identify "this
  container's icebox nest" as the position scope) rather than a third RPC — reuses its
  existing `pg_advisory_xact_lock(project_id)` + staleness-check machinery
  (review-sharp-edges principle: any new RPC touching positions needs that same lock).
  The confirmation dialog from doc-18 §9's Parent picker ("X will become an epic...") does
  NOT apply here — the drop target is always an already-existing container, never a
  containerize-on-pick case.
- **AC#1 (container's own row reorder): recommend splitting into its own task.** Zero
  shared plumbing with AC#2/#3. `containerAccordionRows` today (`board/page.tsx` ~line 138)
  is read-only, ordered by `.order("position")` with no write path at all. Needs its own
  dense-reorder scope `(project_id, is_container=true)`, structurally separate from the
  flat icebox-zone splice (`_splice_backlog`) per `spec/data-model.md` "Position ordering
  invariant" rule 2 (dense rank is only valid within one scope) — mixing the two scopes
  would corrupt whichever set didn't move. Not the owner's reported pain point (only "no
  way out" was reported), so deferring it doesn't block the actual bug fix.

**Model assignment implication:** AC#3 (new RPC, position-scope design, concurrency lock)
is architecture-sensitive per CLAUDE.md's Backlog Assignee policy → belongs on
`@claude-opus-4-8`, not the task's current `@claude-sonnet-5`. AC#2 alone (pure dnd-kit
wiring, no migration) is fine on sonnet.

See [[review-sharp-edges]] for the position-invariant/advisory-lock principles this leans
on, and [[doc8-locked-decisions]]/[[remaining-chain-design-decisions]] for the surrounding
doc-18 chain context.
