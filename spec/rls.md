← [SPEC.md](../SPEC.md)

## Supabase RLS Policy Guidelines

- Only users present in `project_members` can read or modify data for that project
- `viewer` role: SELECT only
- `member` role: SELECT / INSERT / UPDATE — the general per-table pattern.
  **Exception: `stories` UPDATE has no own/assigned restriction** (see the
  board write model below); most other tables (comments' own-author UPDATE,
  etc.) keep a narrower rule where noted
- `owner` role: all operations including DELETE
- **Board write model — TASK-70 owner decision (a), landed 2026-07-19:**
  **Pivotal-style — any project member may operate any story** on the board
  (move, reorder, transition, estimate) — not just their own/assigned. The
  `stories` UPDATE policy (`members can update stories`, TASK-70) is now a single unconditional
  `project_role(project_id) in ('owner','member')` check (USING = WITH CHECK),
  replacing the old `owner OR (member AND (created_by OR assignee_id))` rule.
  This is what `update_story` and `transition_story` (both SECURITY INVOKER,
  gated purely by this policy) inherit automatically, and what
  `move_story_board` (SECURITY DEFINER) already enforced independently — all
  three write paths now agree. `set_story_state` (TASK-91) is designed
  against this relaxed model. **Unchanged, out of scope:** `stories` DELETE
  stays owner-only — decision (a) is about board operations, not deletion.
  `split_story` (doc-18 §6) is **owner+member**, not owner-only: splitting is a
  board operation and is no longer destructive (the parent survives as a
  container), unlike the removed `promote_story_to_epic` which deleted the story
- Every new table with a `project_id` column gets its own policy set following
  the pattern above — policies are never inherited
- **project_states (doc-8 §2):** members SELECT/UPDATE, **owner-only DELETE**;
  **INSERT is RPC-only** (the client INSERT policy was dropped and the grant
  revoked — TASK-115, see the changelog bullet below), so states are created
  only through `create_project_state` and the `handle_new_project_states`
  seed trigger (both SECURITY DEFINER). A composite `UNIQUE(id, project_id)`
  backs `stories.state_id`'s composite FK, so a cross-project state reference
  is impossible. Category immutability and the "≥1 unstarted & ≥1 done"
  minimum are enforced by triggers under a per-project advisory lock, not by
  RLS
- **my_work_columns (doc-15):** per-user free columns — own rows, all four ops
  (`user_id = auth.uid()`). Its `unique (user_id, id)` is the target of
  my_work_story_state's composite FK, so the DB (not RLS alone) stops a card
  from pointing at another user's column
- **my_work_story_state (doc-14, reshaped by doc-15):** per user, not
  project-scoped by column — own-rows SELECT/UPDATE/DELETE (the write path
  upserts `column_id`/`today_date`/`today_position`). SELECT/UPDATE/DELETE
  `user_id = auth.uid()`; INSERT `WITH CHECK user_id = auth.uid() AND
  is_project_member(<story's project>)`. **No cross-user reads.** Lifecycle
  writes that touch other users' rows go through SECURITY DEFINER RPCs:
  `move_story_to_project` no longer carries marks over (a moved story is
  recreated under a new id; marks stay personal to the original); **`remove_member`
  purges the removed user's rows in that project** (prevents ghost marks reviving
  on re-invite). *(`project_my_work_mapping` removed in doc-15.)*
- **story_completions (doc-14 — retired by TASK-176):** no longer read or
  written (Done is now a status column read from the story's live done
  category). The table, its own-rows SELECT policy + revoked write grants, and
  the `stories` SELECT OR-clause that referenced it all remain in place but
  inert until TASK-98's baseline squash removes them. A completer who finishes
  a story then leaves the project no longer keeps read access (there is no
  completion row) — accepted by the owner as part of the Done-as-status change.
- **project_calendar_exceptions:** project-scoped, standard pattern
  (members read, owner/member write per role)
- **user_time_off (doc-8 §6):** stores **dates + kind only, no reason/notes**
  — because co-members must read it for capacity math. READ policy is
  `user_id = auth.uid() OR shares_project_with(user_id)` (existing helper);
  WRITE is self-only. **Trade-off (accepted, must stay documented here): a
  shared project exposes all of your time-off dates to its members, viewers
  included.** The table deliberately carries nothing private so this exposure
  is limited to dates
- Exception (2026-07-08): `iteration_goals` allows `member` DELETE, not just
  `owner`. A row here is a *field value* (the draft goal for a not-yet-real
  iteration), not a record — deleting it is equivalent to clearing the goal,
  which `member`s can already do for a real iteration via `iterations.goal`
  UPDATE (`updateIterationGoal`). Restricting it to owner-only would silently
  no-op a member's "clear the goal" action (RLS filters DELETE rows rather
  than erroring), a worse outcome than the minor privilege widening of
  letting members delete each other's draft goals within their own project
- Cross-project or cross-user operations that RLS cannot express row-by-row go
  through SECURITY DEFINER RPCs with explicit membership checks inside:
  `invite_member` (existing), user search for invites (capped results, minimal
  columns: id / username / display_name / avatar_url), and story Move/Copy
  between projects (caller must be a member of **both** projects)
- Function EXECUTE (2026-07-15, TASK-55): `authenticated`/`anon` no longer have
  a blanket EXECUTE grant on public functions (the old schema-wide EXECUTE grant +
  the built-in PUBLIC default were the real remote-call surface). EXECUTE is
  granted explicitly to `authenticated` only for the policy-referenced helpers
  (`project_role`, `is_project_member`, `shares_project_with`) and the web
  `.rpc()` entry points; internal helpers/trigger bodies and service-role-only
  RPCs are not. The schema is **not** private-by-default, so every new function
  manages its own grants (see `.claude/commands/db-migrate.md` item 5); the
  `grant-lockdown` integration test is the backstop
- activity_logs (2026-07-15, TASK-55): the client INSERT policy was **dropped** —
  all writers are SECURITY DEFINER now (the `log_*` triggers, the move/copy RPCs,
  `split_story` (doc-18 §6), and the `is_container` maintenance trigger that logs
  a container's cleared points — doc-18 §4), so a direct client insert is denied.
  A composite FK `(story_id, project_id) → stories(id, project_id)` makes a
  cross-project story reference impossible
- iterations INSERT (2026-07-21, TASK-110): the client INSERT policy was
  **dropped** and the table-level INSERT grant revoked from `authenticated` —
  every new iteration row is created by the `finalize_iteration` SECURITY
  DEFINER RPC (which also owns rollover/skip), never a direct client write.
  This closes a forged-history hole: RLS can't restrict column values, so the
  old owner/member INSERT policy let a member insert a `state='done'` row with
  an arbitrary `number`/`velocity`/`capacity`, derailing sprint numbering and
  poisoning the velocity-rate window. Mirrors the `velocity`/`capacity` UPDATE
  lockdown (TASK-86); the only remaining client write is `update (goal)`
- project_states INSERT (2026-07-22, TASK-115): the client INSERT policy was
  **dropped** and the table-level INSERT grant revoked from `authenticated` —
  states are created only by `create_project_state` and the
  `handle_new_project_states` seed trigger (both SECURITY DEFINER), never a
  direct client write. RLS can't restrict column values, so the old
  owner/member INSERT policy let a member insert a row at an arbitrary
  `position`, bypassing `create_project_state`'s category-block contiguity
  and corrupting computeStateGate's advance-button graph. The same bypass
  still exists for `position` via the members UPDATE policy (a separate
  follow-up, out of TASK-115's INSERT-only scope)
- Membership admin (2026-07-15, TASK-54): role changes and removals are
  **RPC-only** — `change_member_role` / `remove_member` (SECURITY DEFINER,
  per-project `membership:` advisory lock). The direct owner UPDATE/DELETE
  policies on `project_members` were **dropped** so no table write can bypass
  the **last-owner invariant** (the sole owner can never be demoted or removed
  by any path — RPC, direct write, or re-invite). `invite_member` is
  insert-only (re-inviting an existing member is rejected, never a role
  overwrite). `remove_member` also permits **self-leave** by a non-owner
  (member/viewer), which the old owner-only DELETE policy blocked. The
  `project_members` SELECT and owner INSERT policies remain
- Project archive (`projects.archived_at`): set/cleared by owner only (no
  dedicated policy — covered by the existing owner-gated `projects` UPDATE
  policy). Read-only enforcement is scoped to (a) the Move/Copy story RPCs,
  which reject a source or target project that's archived, and (b) the web
  UI's display/archive-control gating on `/dashboard`. There is **no**
  DB-level lock across every write-capable table (`stories`, `comments`,
  `iterations`, `project_states`, `labels`, ...) — a member can still write
  directly to an archived project's data via PostgREST/the REST API,
  bypassing the UI. Full DB-level read-only enforcement is tracked as
  follow-up work (see Backlog), not implemented here.
- RPC role guards (2026-07-17, TASK-58): a new SECURITY DEFINER RPC that gates
  on role uses `require_project_role(project_id, variadic roles)` — it raises
  `not authorized` (42501) for a non-member or a role outside the list. Do
  **not** hand-write `coalesce(project_role(...), '') <> ...` or `role is null
  or role not in (...)` inline; the whole reason for the helper is that a
  forgotten NULL check in one of those is a privilege hole (`NULL <> 'owner'`
  is NULL, which `if` treats as false). The last-owner invariant is enforced
  by `assert_not_last_owner(project_id, user_id)`. Existing RPCs still carry
  the old inline dialects — they are converted as each is next touched, not in
  one sweep. A guard that is not a plain role-list check (e.g. `remove_member`'s
  self-leave allowance) stays bespoke
