---
name: learnings-optimistic-state-must-outlive-refetch
description: Check optimistic-move code: clearing the pending/optimistic array before the refetch resolves makes a successful drop snap back then jump forward (looks like a failed move)
metadata:
  type: feedback
---

When reviewing optimistic UI (`pending ?? serverData`), check the *success* path, not
just rollback: `setPending(null); reload();` clears the optimistic view immediately while
`reload()` is still in flight, so the card renders at its old position for one round-trip
and then jumps — indistinguishable from a rejected move (principle 2 feedback is wrong).

**Why:** found in the phase-1 rewrite board (`apps/web/src/pages/BoardPage.tsx` `commit`,
2026-09-07); the rollback path was tested, the success flicker was not.

**How to apply:** require pending to be held until the refetched data lands (clear it in
an effect keyed on the new server data, or apply the server's response locally). Same
trap for SSE-driven refetch: an event mid-drag must not drop the pending array.
