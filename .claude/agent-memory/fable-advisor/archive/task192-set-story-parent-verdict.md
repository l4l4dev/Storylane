---
name: task192-set-story-parent-verdict
description: 2026-07-25 TASK-192 verdicts — set_story_parent RPC approved (RLS premise stale, container check is drag-only); attach interaction approved with 2 fixes (centre-based collision on nested rects, child rows draggable via parent listeners)
metadata:
  type: project
---

TASK-192 (doc-20 §5, attach = parent only): a new minimal RPC
`set_story_parent(p_story_id, p_parent_id)` is approved. `move_story_board`
genuinely cannot do it — its 'single' zone has no position-preserving path
(the "Append (no anchor)" branch always writes `position = max+1`).
`move_story_board`'s parent delta stays in place, uncalled, rather than being
removed by a 5th create-or-replace of a 250-line function.

**Why:** the real justification is decision-1 (business-rule mutation → RPC;
invariants in the DB because server actions don't cover iOS), NOT a permission
gap. Two premises that keep resurfacing and are wrong:
- The `owner OR (member AND (created_by|assignee = auth.uid()))` UPDATE policy
  on `stories` was **dropped** by `20260719000002_relax_stories_write_rls.sql`
  (TASK-70). The live policy is `members can update stories`, unconditional for
  owner/member. Direct PostgREST writes are NOT narrower than the definer RPCs.
- "A story's parent must be `is_container`" is **not** a DB invariant. The
  Parent picker (`app/stories/[id]/actions.ts`) legitimately offers every
  top-level story and containerizes it bottom-up with a confirmation
  (doc-18 §9). So the check belongs to the *drag* path only, never to
  `enforce_single_level_nesting`, and its absence in `update_story` /
  `move_story_board` is not a hole to close.

**Interaction review (2026-07-25, AC#6): approve with two fixes.** The
attach-in-place gesture itself is sound (isOver ring during the drag + forced
expand of band/epic after it = principle 2 satisfied; menu rendered only on
rows that HAVE an epic = principle 1 satisfied, do not "show disabled +
tooltip"). Two real defects:
1. `closestCenter` on an epic row whose droppable rect **encloses its expanded
   children** puts the hot centre ~half the children's height below the header
   the user aims at → attaches to the neighbouring epic, or resolves to a
   Current/Backlog row and *moves* the story. Fix = pointer-first pass over the
   epic rows only (`pointerWithin` on a set filtered to `containerRowIds`,
   fall back to the existing `closestCenter`). Never swap the whole view to
   `pointerWithin`: a zone `<ul>` also contains the pointer and can outrank the
   row, which would hand `over.id = zoneId` to `reorderContainer`.
2. Band child mirror rows sit **inside** the epic `<li>` that carries
   `{...listeners}` + `cursor-grab`, so dragging a "non-draggable" child (AC#5)
   drags the epic.

**Generalise:** a droppable whose rect wraps nested content is a principle-7
(honest hit target) trap under centre-based collision; and "non-draggable"
child content nested inside a drag-handle parent is draggable unless it stops
pointerdown.

**How to apply:** when a future task claims a new RPC is needed "because RLS
would narrow it", re-read the current policy first. When one proposes moving the
is_container check into a trigger, refuse — it would break the Parent picker.
Also: `set_story_parent` must not lock the parent row (deadlock on A→B/B→A);
the unpin race converges anyway because `recompute_is_container` re-reads the
parent `for update`. Related: [[task188-icebox-container-reorder-verdict]],
[[task147-personal-project-seal-verdict]].
