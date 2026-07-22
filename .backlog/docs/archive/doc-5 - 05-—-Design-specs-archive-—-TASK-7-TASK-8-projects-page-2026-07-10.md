---
id: doc-5
title: 05 — Design specs archive — TASK-7/TASK-8 projects page (2026-07-10)
type: specification
created_date: '2026-07-17 12:42'
updated_date: '2026-07-22 09:03'
---
> Archived from docs/superpowers/specs/ (2026-07-17). The matching implementation plans in docs/superpowers/plans/ were execution checklists and were deleted — full text in git history before this date.

---

# TASK-7: Projects page redesign with inline creation — Design

## Scope

Rebuild `/dashboard` per `spec/screens.md` "Projects page": inline creation panel
(no overlay dialog), mode selection as Tracker/Free comparison cards, all
initial settings in the form, optional initial member invites via a
new exact-match search, and project cards with mode badge, mode-specific
summary, member avatars, and last-updated time.

Out of scope (belongs to TASK-8, which depends on this task): archive,
favorites, search box, sort select. This task's cards do not include those
controls; TASK-8 adds them afterwards.

## 1. New RPC: exact-match user search before a project exists

`search_users_for_invite(p_query, p_project_id)` (TASK-6) requires
`p_project_id` and cannot be reused here — an earlier draft that made
`p_project_id` optional was flagged by `rls-security-reviewer` as reopening
the directory-enumeration hole that `20260709000001_rls_hardening.sql`
closed (profiles RLS is `id = auth.uid() or shares_project_with(id)`, and
this class of RPC is `SECURITY DEFINER`, bypassing RLS entirely). Fuzzy
ILIKE search with no project scope is unsafe; exact match is not (each call
can only confirm/deny one specific username, not enumerate a set).

New function: `search_users_for_new_project(p_query text)`:

- `SECURITY DEFINER`, `stable`, `set search_path = public`; raises if
  `auth.uid() is null` (function-level gate, not just relying on grants)
- Validates the input against the same format as `profiles_username_format`
  (`^[a-z0-9_]{3,30}$` on the trimmed/lowered query) before touching the
  table — a non-matching input returns empty without a query
- Exact match only: `lower(username) = lower(p_query)`, no ILIKE/wildcard
- **Excludes the caller**: `where p.id <> auth.uid()` — prevents the
  caller from ever selecting themselves in the picker (see invite-loop
  note below for why this matters)
- No `p_project_id` parameter — nothing to scope to yet
- Returns the same minimal columns as `search_users_for_invite`: id,
  username, display_name, avatar_url
- At most one row (usernames are unique)

Reviewed by `fable-advisor` (2026-07-10): exact-match is an acceptable
narrowing — each call only confirms/denies one specific username (a
different capability class than the ILIKE/`ANY project` enumeration that
was closed off), and this app already exposes an equivalent exact-match
oracle via the "username already taken" error in `/settings` username
edits. No new rate-limiting infra is justified for this; the migration
should note wordlist-brute-force as an accepted residual risk.

Migration: `supabase/migrations/<timestamp>_search_users_for_new_project.sql`.
Must be reviewed by `rls-security-reviewer` before merging (this
fable-advisor pass was a design gate, not a migration-body review).

UI: a new lightweight picker component (not `InviteMemberForm`, which is
tied to an existing `projectId` and invites immediately via RPC). The new
picker takes a username input, calls the exact-match RPC on submit/blur,
and on a hit adds the user to a local "to invite" list rendered as chips
(no fuzzy dropdown, since none is possible).

## 2. Screen structure

`app/dashboard/page.tsx` (server component): fetch the project list plus
the aggregate data cards need (below), pass to client components.

`InlineCreatePanel` (client component) replaces `CreateProjectDialog`:
expands in place above the card grid when "New project" is clicked; no
dialog/overlay, no route change.

- name, description
- mode selection: two `ModeComparisonCard`s side by side (Tracker / Free),
  selectable (highlighted), not radio buttons
- Tracker fields: iteration length, point scale, **velocity window** (new
  field — not present in the current dialog)
- Free fields: column template (KanbanFlow / Basic), reusing the existing
  template definitions
- optional initial invites: the exact-match picker, chips with remove,
  hidden inputs carrying the selected user ids

`ProjectCard` (new component):

- name, mode badge (Tracker / Free)
- mode-specific summary line: Tracker → "Iteration #N · velocity X pts";
  Free → "Y columns · Z open cards"
- overlapping member avatars (initials or OAuth avatar), capped with "+N"
- last-updated relative time
- no archive/favorite/search/sort controls (TASK-8)

### Data fetching for card summaries

- One query for the project list.
- For tracker projects: batch-fetch `iterations` (`state = 'done'`, order
  by `end_date desc`, `limit velocity_window` per project) and compute
  velocity with the existing `calculateVelocity` util; fetch the current
  (non-done) iteration's `number` separately.
- For free projects: count `custom_statuses` rows and count `stories`
  rows whose status is not an `is_done` column.
- Members: `project_members` joined with `profiles` for avatar/display
  name.
- Accept N+1-per-project queries, parallelized with `Promise.all` — this
  app's expected scale (projects per user) doesn't warrant a single
  aggregate query. No premature optimization.

## 3. Server actions

`app/dashboard/actions.ts`:

- Extend `createProject` to accept `invited_user_ids: string[]`. Before
  calling `invite_member`, dedupe the array, drop the caller's own id
  (defense in depth alongside the RPC-side exclusion — the picker is
  client-controlled), and cap it at 20. After the existing `projects`
  insert (and `custom_statuses` insert for free mode), call the existing
  `invite_member(p_project_id, p_user_id, p_role)` RPC once per remaining
  id, role fixed to `"member"` (the creation panel has no role selector —
  ownership/role changes happen later in Settings).
  - Why excluding the caller matters: `invite_member` upserts membership
    with `on conflict do update set role = excluded.role`. If the creator
    could invite themselves, the just-created owner row would be
    overwritten to `member`, leaving the project without an owner.
- Invite failures do not roll back project creation — invites are
  best-effort at creation time; the project itself is the transactional
  unit that matters. This matches the existing (non-transactional)
  `projects` → `custom_statuses` pattern already in `createProject`.
  Failures are **not** swallowed silently: collect per-user failures and
  surface them to the caller (e.g. a returned list of failed
  usernames/reasons) so the UI can show which invites didn't go through.
- New `searchUsersForNewProject(query: string)` action wrapping the new
  RPC.

`CreateProjectDialog` and its test file are deleted once the new panel
replaces it.

## Testing

- `lib/utils/*.integration.test.ts` (`SUPABASE_INTEGRATION=1`): exact-match
  RPC — case-insensitive match, non-match, unauthenticated rejection.
- `ProjectCard.test.tsx`: mode badge, summary line (both modes), avatar
  "+N" overflow.
- `InlineCreatePanel.test.tsx`: mode switch shows/hides the right fields,
  invite picker adds/removes chips, submitted form data shape.

## Spec update required

`spec/screens.md` "Projects page" currently says initial invites use "the
same user-search picker as project settings" — this is now intentionally
different (exact-match only, pre-project). Update that line as part of
this task's implementation to describe the exact-match picker and link the
reasoning back to TASK-6's directory-enumeration finding.

## Review gates before implementation

- `fable-advisor`: new SECURITY DEFINER RPC design (`search_users_for_new_project`)
  — done 2026-07-10, approved with the changes folded into section 1 above.
- `rls-security-reviewer`: the migration, once written.
- `web-conventions-reviewer`: after implementation, per repo convention.


---

# TASK-8: Project archive, favorites, search and sort — Design

## Scope

Per `spec/screens.md` "Projects page" and `spec/data-model.md`: owner-only
project archive/unarchive, per-user favorites (pinned first), name search,
and sort (last updated default / name / created) on `/dashboard`. Also
closes a deferred item from TASK-14: `move_story_to_project` /
`copy_story_to_project` re-check that neither project is archived.

**Deliberately out of scope (explicit decision):** full DB-level read-only
enforcement for archived projects (locking every write-capable table —
stories, comments, iterations, custom_statuses, labels — behind an
"is this project archived" check). That would be a much larger, invasive
RLS change touching most of the schema. This task implements read-only
only at the two points the spec calls out concretely: the Move/Copy RPCs
(TASK-14's deferred check) and the Projects page/sidebar's display and
archive-control gating. Blocking in-project edits (e.g. still being able
to edit a story inside an archived project's board) is a known limitation,
tracked as follow-up work, not a bug in this task.

## 1. Migration

- `projects.archived_at timestamptz` (nullable, `null` = active). Writes
  already go through the existing `"owners can update projects"` policy
  (`using (project_role(id) = 'owner')` on UPDATE) — no new policy needed
  for this column.
- `project_members.is_favorite boolean not null default false`.
- New RPC `toggle_project_favorite(p_project_id uuid, p_favorite boolean)`:
  `SECURITY DEFINER`, `set search_path = public`, updates only the caller's
  own `project_members(project_id, user_id = auth.uid())` row's
  `is_favorite`. Available to any member (not owner-gated) — favoriting is
  a personal preference, not a role change. This RPC exists because the
  current `project_members` UPDATE policy (`"owners can update member
  roles"`) is owner-gated for the whole row, and a plain "users can update
  their own row" RLS policy would let a non-owner rewrite their own `role`
  in the same PATCH (RLS can't restrict by column for an arbitrary
  PostgREST UPDATE) — the RPC is the safe way to expose only the one
  column. Reviewed by `fable-advisor` (2026-07-10): approved with changes,
  folded in below.

  - `if p_favorite is null then raise exception 'p_favorite is required'`
    up front (a plain `strict` function would silently no-op on NULL
    instead of surfacing an error).
  - `update ... where project_id = p_project_id and user_id = auth.uid()`,
    then `if not found then raise exception 'Not a project member'` — a
    non-member's row simply doesn't exist, so this can't leak whether the
    project itself exists (matches the existence-probe caution already
    applied to Move/Copy in `20260711000001_move_copy_story.sql`).
  - No explicit GRANT needed — blanket default privileges
    (`20260630000002_grants.sql`) already grant `authenticated` EXECUTE,
    same as every other RPC in this codebase.
  - **Known, accepted limitation** (documented in the migration comment,
    not fixed by this task): the existing owner-gated `project_members`
    UPDATE policy still lets an owner PATCH `is_favorite` on another
    member's row directly (the policy is row-scoped, not column-scoped).
    Harmless (non-destructive, reversible, not the RPC's problem to fix)
    but worth flagging so `rls-security-reviewer` doesn't re-discover it
    as a surprise.
  - **Favoriting is allowed on archived projects** — the RPC does not
    check `archived_at`. `is_favorite` is the viewer's own display
    preference, not project data, so it's outside this task's (already
    narrow) read-only scope.
- `move_story_to_project` / `copy_story_to_project`
  (`supabase/migrations/20260711000001_move_copy_story.sql`, TODO at line
  23-24): add the "neither source nor target project is archived" check
  that was deferred pending this column's existence, and a test covering
  archived-project rejection (closes TASK-14 AC#7/#9). Placement: after
  the existing membership checks, before any write — at that point the
  caller is already confirmed a member of both projects, so distinct
  error messages (`'Source project is archived'` /
  `'Target project is archived'`) don't leak anything an existence probe
  could exploit.
- All reviewed by `rls-security-reviewer`.

## 2. UI

- `ProjectCard` (`apps/web/components/features/projects/project-card.tsx`):
  add an overflow menu (`DropdownMenu`, same pattern as
  `story-peek-menu.tsx`) with Archive/Unarchive (owner-only, confirmation
  `Dialog` before the action — matches the destructive-action pattern
  already used for story deletion) and a pin/favorite toggle icon
  (available to any member, calls `toggle_project_favorite` immediately,
  no confirmation needed since it's non-destructive and reversible). An
  archived project's card shows an "Archived" badge.
- `/dashboard` page: a search input (name substring match) and a sort
  select (last updated / name / created), both applied client-side over
  the already-fetched project list (same scale assumption as TASK-7 — no
  new server query). An "Archived" filter toggle, default off (archived
  hidden); toggling on reveals archived projects. Favorited projects
  always sort first, regardless of the chosen sort key.
- Sidebar project switcher (`apps/web/components/features/shell/app-sidebar.tsx`):
  `ProjectRef` gains `isFavorite: boolean`; the switcher's project list
  sorts favorites first and excludes archived projects. Broader switcher
  visual polish (mode badge, chevron affordance) stays TASK-17's scope —
  not touched here.

## 3. Testing

- `*.integration.test.ts` (`SUPABASE_INTEGRATION=1`):
  - `toggle_project_favorite`: owner and non-owner members can each toggle
    their own `is_favorite`; a caller cannot toggle another member's row;
    the RPC never changes `role`; a non-member caller gets a raised
    exception (not a silent no-op); `p_favorite = null` is rejected with a
    clear error, not a raw NOT NULL constraint violation.
  - Regression test: a non-owner's direct PostgREST PATCH to their own
    `project_members` row is still rejected by the existing owner-gated
    UPDATE policy — confirms the direct-write path stays closed and the
    RPC is the only way in, which is the whole reason the RPC exists.
  - Archive/unarchive permission: confirms the existing owner-gated
    `projects` UPDATE policy rejects a non-owner's attempt to set
    `archived_at` (this is existing-policy behavior, not new code, but
    worth a regression test now that the column exists and is exercised).
  - Move/Copy: archived-source and archived-target rejection cases added
    to the existing move/copy integration test file.
- Component tests: `ProjectCard`'s overflow menu (archive confirmation
  flow, favorite toggle, "Archived" badge rendering).
- Pure-function tests for the dashboard's search/sort/archived-filter
  logic, extracted into `lib/utils` following the `calculateVelocity`
  precedent (framework-free, easy to test exhaustively).

## Review gates before implementation

- `fable-advisor`: `toggle_project_favorite` RPC design (new SECURITY
  DEFINER surface, column-scoped write).
- `rls-security-reviewer`: the migration, once written.
- `web-conventions-reviewer`: after implementation.
