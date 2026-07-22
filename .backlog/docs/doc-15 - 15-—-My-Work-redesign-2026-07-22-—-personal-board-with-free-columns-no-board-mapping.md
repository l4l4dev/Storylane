---
id: doc-15
title: >-
  15 — My Work redesign 2026-07-22 — personal board with free columns, no board
  mapping
type: specification
created_date: '2026-07-22 08:42'
updated_date: '2026-07-22 09:03'
---
# My Work redesign — personal board with free columns, no board mapping

Origin: owner dogfooding 2026-07-22. Two bugs were root-caused to the same
structural problem, and the redesign dialogue (this doc) concluded the
mapping machinery should go entirely.

Supersedes doc-14's `project_my_work_mapping` design (the mapping table,
TASK-133's Settings UI + broken-mapping banner, TASK-137's personal
auto-mapping — all removed), and reworks doc-14's Today model. Everything
else in doc-14 stands: `my_work_story_state` (reshaped below),
`story_completions` (unchanged — it becomes MORE load-bearing, not less),
the Kanban UI, the story_pins removal, and the additive-Done principle.

## The two bugs that triggered this

1. **"Add a personal task" always fails.** The quick-add targets
   doc-8 §10's "current iteration" create path
   (`createDraftStory`, `apps/web/app/projects/[id]/board/actions.ts:224`
   → `"No active iteration"`), but the personal project has **zero
   iterations and no way to ever get one**: the signup function
   (`20260721000001`) creates no iteration, the only lazy
   rollover/creation path is the project board page (unreachable for the
   hidden personal project), and doc-14 removed My Work's own rollover.
2. **Dragging a personal task's status always fails once mapped.** A
   mapped Doing/Done drag calls `set_story_state`, which hits two tracker
   gates (`20260719000007_set_story_state.sql:74-92`): the estimation gate
   (unestimated features can't leave unstarted — personal tasks are never
   estimated) and the current-iteration auto-assign (raises
   `'No active iteration'` — see bug 1).

Both are tracker machinery leaking into a surface whose whole purpose is
personal task management. The owner's verdict: My Work is "自分だけの自分の
タスクの管理と今日の自分のプランニングをする場" — decouple it.

## Decisions (owner dialogue, 2026-07-22)

1. **Personal tasks stay stories** in the hidden personal project (not a
   separate lightweight table): the owner wants subtask checklists,
   comments/update log, and promotion to team projects
   (`move_story_to_project`) — all story features. Rebuilding them on a
   parallel table was rejected.
2. **Columns: Todo / Today / Done are required; everything else is a
   user-defined free column.** Users can add personal-status columns
   (e.g. "Waiting", "Review"), rename/delete them, and reorder column
   display. Free columns are **local-only by definition — they never
   touch any project board.** With that rule there is nothing left for a
   project-state mapping to do, so the mapping machinery is removed
   outright rather than generalized.
3. **Initial column set: Todo / Today / Doing / Done**, where Doing is a
   pre-seeded free column the user may delete — visual continuity with
   the shipped board.
4. **Today is date-scoped, with carry-over confirmation.** The Today mark
   belongs to a calendar date. On the first visit of a new day, unfinished
   yesterday-Today items prompt "carry over n items to today?" —
   accepted items get today's date, declined ones fall back to their
   column. Cards inside Today are manually orderable (the day's execution
   order). Other columns keep the existing project-grouped ordering.
5. **Team stories: read-in, never written from My Work.** Assigned team
   stories flow into Todo automatically (full inbox), with their real
   state shown as a badge. Drags are always local marks. Completing a
   team story happens on its own board — and still lands in the viewer's
   permanent Done log automatically, because the `story_completions`
   trigger fires on the story's state change regardless of any mapping.
   **No derived Doing**: a story started on its board sits in Todo (badge
   shows progress) unless the user drags it to a free column — My Work is
   fully manual placement, matching "自分を管理するためのステータス".
6. **Personal tasks: real-state direct.** The personal project's states
   are category-resolvable without configuration (it's ours, template
   known). Todo/Done drags write the real state via `set_story_state`
   (Done → `completed_at` + `story_completions` → permanent log; back to
   Todo → unstarted state, i.e. reopen). Today and free columns stay
   local, as for any story. The real-done guard (actions.ts) keeps
   applying to team stories only.
7. **Tracker gate exemptions for personal projects** (`is_personal`):
   `set_story_state` skips the estimation gate and the in_progress
   current-iteration auto-assign (story stays iteration-less). The
   function stays **SECURITY INVOKER — do not redeclare it DEFINER**: the
   exemption just reads `projects.is_personal` (member-visible under
   INVOKER) and skips the two gate blocks; DEFINER would break the
   caller-gating FOR UPDATE that rides on stories' RLS (fable-advisor
   required correction to this doc's first draft).
   The quick-add fix is one line: `MyWorkQuickAdd`'s `target="unstarted"`
   → `"backlog"` — `insert_board_item` already creates the iteration-less
   lowest-unstarted shape transactionally, no new branch needed. Keep
   `defaultAssigneeId`: the completion trigger skips assignee-less
   stories, so dropping it would silently kill the personal Done log.
   The personal project needs no iterations, ever.

## Data model changes

### `my_work_columns` (new)

```
id          uuid primary key default gen_random_uuid()
user_id     uuid not null references profiles(id) on delete cascade
name        text not null
position    int  not null
created_at  timestamptz not null default now()
```

- Rows are the user's **free columns only** — Todo/Today/Done are
  structural, not rows. Column display order covers the required columns
  too (mechanism: implementation detail; a per-user ordered list that
  includes the three fixed slots).
- **`unique (user_id, id)`** — the target of `my_work_story_state`'s
  composite FK below (fable-advisor: without it a crafted request could
  point one user's row at another user's column; the invariant lives in
  the DB per decision-1).
- RLS: own rows, all four ops (`user_id = auth.uid()`), same plain-write
  character as `my_work_story_state`. Default grants apply.
- Seed one 'Doing' row per existing user (backfill) and at signup — the
  signup half is another **full replacement of `handle_new_user`**
  (established precedent: `20260721000001` → `20260721000004`).

### `my_work_story_state` (reshape)

- `local_status text check (...)` → `column_id uuid null`, constrained by
  the **composite FK** `foreign key (user_id, column_id) references
  my_work_columns (user_id, id) on delete set null (column_id)` — the
  column-list SET NULL form (PG15+; local runs PG17, `supabase/config.
  toml`) nulls only `column_id` on column deletion, dropping the card
  back to Todo. A plain single-column FK is wrong twice over: it lets a
  row point at another user's column, and `on delete set null` would null
  `user_id` too, violating the PK (fable-advisor required fix).
- `is_today boolean` → `today_date date null` (+ `today_position int
  null` for the day's manual order), with `check (today_position is null
  or today_date is not null)`.
- **Timezone**: the runtime's "today" (classification and carry-over) is
  the client's local date passed into the server action — DB
  `current_date` is UTC and would shift the day boundary to 9:00 JST.
  Only the one-time migration backfill may use `current_date`.
- Data conversion in the migration: `local_status = 'doing'` → the
  user's seeded Doing column; `'todo'`/`'done'` → null (real-done
  personal rows are already covered by `story_completions`/category);
  `is_today = true` → `today_date = current_date`. **Expected behavior
  change**: a team story locally marked 'done' returns to Todo unless its
  real category is done — the round-4 local-done mark for team stories is
  retired along with the mapping (Done = completions + personal real-done
  only, see classification below).
- PK and RLS policies unchanged in shape (own rows + project-membership
  check on story_id).

### Classification (final)

Done column = the viewer's `story_completions` rows (one entry per row)
plus personal-project stories whose real category is done. Today =
`today_date = today`. Else `column_id`'s free column if set, else Todo.
**Excluded entirely**: an assigned team story whose real category is done
but that has no completion row for the viewer (e.g. assigned after
someone else completed it) appears in **no column** — it is finished work
that is not the viewer's completion record; surfacing it in Todo would
create an undraggable dead card under the real-done guard (fable-advisor
required decision; state it in spec/screens.md "My Work").

### `project_my_work_mapping` (drop)

Table, Settings "My Work sync" section, broken-mapping banner, and the
`resolveMappedState` write-path branch all removed. TASK-137 cancelled.
The schema removal is **forward-only** — `20260722000002`/`20260722000004`
are merged migrations, so this is a new `drop table` migration plus UI
removal, not a revert.

## Impact on existing work

- **TASK-133 (shipped d8f6fe4)**: reverted by the removal task — the
  Settings section, banner, and mapping server actions go away.
- **TASK-137**: cancelled (obsolete before implementation).
- **TASK-129** (personal back-link → My Work): unaffected, still wanted.
- **TASK-94**: mapping-related smoke-test items (comment #1) are
  obsolete; replace with this model's checks.
- **doc-14**: superseded only in the mapping/Today sections, as stated
  above; spec/screens.md "My Work" + "Project Settings" AND
  spec/data-model.md's my_work_story_state / project_my_work_mapping
  entries need rewriting.
- **TASK-130's integration test**
  (`apps/web/lib/utils/my-work-data-model.integration.test.ts`) asserts
  the mapping table and the old column shapes — rewritten as part of the
  reshape, not just TASK-133's UI.
- **MCP is out of scope**: no MCP tool reads the my_work tables, and MCP's
  `ensureCurrentIteration` iteration assumption stays as-is — the personal
  project is not addressable via MCP in this pass. (Stated so a later
  session doesn't "fix" MCP to match.)
- Branch handling: `feat/task-131-my-work-backend` (TASK-131/132/133,
  verified) merges first; this redesign lands as a follow-up task chain.

## Process gate

fable-advisor design review: **approve-with-changes (2026-07-22)** — the
three required fixes (composite FK for column_id, SECURITY INVOKER
correction, the real-done dead-card classification decision) are folded
into the sections above. Still required: rls-security-reviewer on the
migrations, and the ux-principles design review before manual
verification.
