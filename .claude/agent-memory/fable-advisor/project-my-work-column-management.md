---
name: project-my-work-column-management
description: TASK-141 My Work free-column management UI (doc-15) — reviewed 2026-07-22, approved-with-changes
metadata:
  type: project
---

TASK-141 implements doc-15's "My Work redesign" free-column management panel
(add/rename/delete/reorder of `my_work_columns`, plus reordering the fixed
Todo/Today/Done slots via the same per-user `profiles.my_work_column_order`
array — doc-15: "the order covers the three fixed slots too — per-user
ordered list, mechanism free").

Key files: `apps/web/components/features/my-work/my-work-column-manager.tsx`
(new panel), `my-work-sections.tsx` (renders columns by iterating the
resolved `order` array instead of a fixed sequence), `app/my-work/page.tsx`
(fetches + resolves order via `resolveColumnOrder` in `lib/utils/my-work.ts`),
`app/my-work/actions.ts` (createMyWorkColumn/renameMyWorkColumn/
deleteMyWorkColumn/saveMyWorkColumnOrder).

Deliberately mirrors `apps/web/components/features/projects/state-manager.tsx`
(button up/down reorder, inline rename via `useInlineEdit`, bare X-button
delete with no confirm) — this is an established, previously-approved
in-repo pattern for small settings-style reorder lists, not a new
interaction to scrutinize from scratch.

**Why:** doc-15 explicitly says the reorder mechanism is "mechanism free" —
button-based reorder does not need to match the board's dnd-kit drag
surface. Column deletion here is genuinely non-destructive (composite FK
`ON DELETE SET NULL` on `my_work_story_state.column_id` — cards fall back to
Todo, no story data or history is lost), so a bare X without a confirm
dialog is appropriate under ux-principles.md principle 6 (irreversible
actions need a seatbelt; this action isn't irreversible in the data-loss
sense the principle is guarding against).

**How to apply:** if a later task revisits this panel, don't re-litigate
points 1/2/4 above (mechanism choice, no-confirm delete, omitted
rename/delete on fixed slots) — they were checked against doc-15's own
wording and the state-manager precedent and hold up. Do check the reorder
race (see [[learnings-full-array-reorder-race]]) if the reorder or
save-order logic changes.
