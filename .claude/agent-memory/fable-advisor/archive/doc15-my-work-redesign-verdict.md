---
name: doc15-my-work-redesign-verdict
description: 2026-07-22 doc-15 (My Work personal board, mapping removal) review — approve-with-fixes; the 12 required changes and settled abuse-path analysis
metadata:
  type: project
---

Reviewed doc-15 (supersedes doc-14's mapping/Today model) pre-implementation.
Verdict: **修正付き承認**. Structure sound; do not relitigate: mapping removal,
free columns local-only, personal real-state-direct, Done = completions log,
Doing seeded as deletable free column, carry-over confirm for Today.

Required fixes the implementation must carry (don't re-derive):
- `set_story_state` is SECURITY **INVOKER** (20260719000007:30) — doc-15's
  "SECURITY DEFINER" claim is wrong; keep invoker, RLS still gates callers.
- `column_id` ownership must be DB-enforced: `unique (user_id, id)` on
  my_work_columns + composite FK `(user_id, column_id)` with
  `on delete set null (column_id)` (PG15+ column-list syntax; local is PG17).
  Plain FK lets user A point at user B's column. Also
  `check (today_position is null or today_date is not null)`.
- Mapping drop = **forward-only new migration** (20260722000002/000004 are
  merged on main), never "revert".
- Today date = **client-local calendar date** passed to the action; DB
  `current_date` is UTC and flips at 09:00 JST for the owner.
- Unspecified classification cell settled: assigned-to-viewer + real-done +
  no viewer completion row → **exclude from active columns** (else it's an
  undraggable dead card in Todo behind the real-done guard).
- Quick-add fix is one line: `MyWorkQuickAdd` target `"unstarted"` →
  `"backlog"` (insert_board_item already creates lowest-unstarted +
  iteration-null transactionally). Keep `defaultAssigneeId` — the completion
  trigger skips null-assignee, so dropping it silently kills the Done log
  for personal tasks.
- Personal category resolution is live (lowest-position state per category),
  error banner if none — states editable via MCP/direct URL.
- doc-15 misses: spec/data-model.md rewrite (3 My Work sections),
  handle_new_user 3rd full-replacement (seed Doing at signup), MCP stays
  iteration-coupled (personal projects out of MCP scope — record it).

Abuse-path analysis (settled, don't redo): is_personal UPDATE pinned by
BEFORE trigger (20260721000004), INSERT forgery blocked by partial unique
index + created_by policy (every signup already owns one); invitee on
someone's personal project gains nothing beyond member-consented looseness.
Reopen interaction sound: completions append-only, trigger's
assignee-membership guard unchanged.

Related: [[doc12-my-work-nav-review]], [[review-sharp-edges]],
[[doc8-locked-decisions]].
