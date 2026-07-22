---
name: learnings-revalidate-empties-derived-props
description: revalidatePath refreshes server props mid-action, so optimistic/undo UIs must not gate render or re-derive ids from a memo of those props
metadata:
  type: project
---

A server action that calls `revalidatePath("/my-work")` (and the board/story
actions do the same) refreshes the route's server components **within the same
action response** — not only on a full page reload. Any client state `useMemo`'d
from a server prop (`assigned`, containers, etc.) therefore recomputes right
after the mutation lands.

**Why:** Bit TASK-156 (My Work carry-over Undo, doc-17 #11). The resolved
confirmation + Undo were gated on `staleToday.length > 0`, and Undo re-derived
its ids from live `staleToday`. `carryOverToday`/`dismissCarryOver` both mutate
`today_date` — the exact field `staleToday` filters on — then revalidate, so the
banner unmounts and Undo becomes a no-op (`ids = []` → actions early-return). A
code comment claimed "staleToday only changes across a full page reload"; that
assumption is false.

**How to apply:** For any optimistic/undo/confirmation affordance that must
outlive its own mutation, freeze the needed ids+count into local state at action
time and gate the affordance's render on that local phase state — never on a memo
of a server prop the same mutation revalidates.
