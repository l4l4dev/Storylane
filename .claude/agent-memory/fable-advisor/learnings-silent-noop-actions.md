---
name: learnings-silent-noop-actions
description: A server action that returns { ok: true } but produces no visible/classifiable change is a principle-2 violation, even though it "succeeded" at the DB layer
metadata:
  type: project
---

Found during TASK-132 (My Work Kanban) design review: `setMyWorkColumn` in
`apps/web/app/my-work/actions.ts` writes `my_work_story_state` unconditionally
for Todo/Today drops, without checking whether the target story's real
category already makes that write meaningless (e.g. dragging a real-done
`story_completions` log entry back to Todo — `assignedColumn` in
`lib/utils/my-work.ts` always routes `category === "done"` stories to the
Done log only, regardless of the write). The action returns `ok: true`, no
`dragError` fires, and the optimistic UI card silently snaps back to its
original column on the next `revalidatePath` round-trip with zero
explanation.

**Why:** spec/ux-principles.md principle 2 ("Every action produces visible
feedback... Server actions that return 'nothing to do' surface that message;
they never end in silence") is written against DB-level success/failure, but
its actual defect precedent (Finish iteration silently doing nothing on a
not-started iteration) is about *user-visible effect*, not HTTP/RPC status.
A 200-OK write that doesn't change what the user sees is the same defect
wearing a different hat.

**How to apply:** When reviewing any drag/mutation action, don't just check
"does it return an error on DB failure" — trace whether there exist inputs
where the write succeeds but the classification/read-side logic ignores it
entirely. If so, that path needs its own explicit rejection message (reusing
whatever banner/toast mechanism already exists for the "real" error case,
e.g. the `NO_ITERATION_MESSAGE` pattern in `setMyWorkColumn`), not a silent
success.
