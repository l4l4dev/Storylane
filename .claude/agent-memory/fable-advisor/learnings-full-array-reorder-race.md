---
name: learnings-full-array-reorder-race
description: Check for lost-update races when a client computes a full reordered array from a prop and writes it verbatim (vs. a server-side relative-swap RPC)
metadata:
  type: feedback
---

When reviewing a button-based (up/down arrow) reorder list, check HOW the
new order is computed and persisted:

- Safe pattern (`apps/web/components/features/projects/state-manager.tsx` +
  `reorder_project_state` RPC, `apps/web/app/projects/[id]/settings/actions.ts`):
  the client sends only `(item_id, direction)`; the DB computes the swap
  against the CURRENT stored positions inside an advisory-locked RPC. Two
  racing clicks still each read fresh server state — no lost update, only a
  possible one-step visual lag.
- Unsafe pattern found in TASK-141's `my-work-column-manager.tsx`: `move()`
  computes the ENTIRE reordered array client-side from the `order` **prop**
  (a snapshot from the last server render) and calls a plain
  `saveMyWorkColumnOrder(fullArray)` that overwrites the column verbatim.
  The component only disables the arrows on the ONE row mid-flight
  (`reorderingId === slotId`), not the whole list — so a second click on a
  DIFFERENT row before the first round-trip completes computes its own
  array from the same stale snapshot and silently overwrites the first
  change on write (last-write-wins, no merge, no error shown).

**Why:** caught during the TASK-141 design review (2026-07-22) by comparing
against the state-manager precedent it explicitly mirrors — the two look
identical at a glance (same button/disable/useTransition shape) but differ
in this one load-bearing way. Low severity here since it's a single user
racing themselves within one tab, but the fix is a one-line change (disable
ALL arrows while `reorderingId !== null`, not just the matching slot), so
worth flagging even at low severity.

**How to apply:** whenever a review touches a reorder panel that persists a
full ordered array (not a relative swap RPC), check whether concurrent
clicks on OTHER rows are blocked during a pending save, not just the row
being moved. This applies beyond My Work — any future "reorder the whole
list" UI (not delta-based) should get this same check. See
[[project-my-work-column-management]] for the concrete instance.
