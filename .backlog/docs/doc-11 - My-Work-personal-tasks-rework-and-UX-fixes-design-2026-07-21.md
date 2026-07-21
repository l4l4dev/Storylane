---
id: doc-11
title: My Work personal-tasks rework and UX fixes design 2026-07-21
type: specification
created_date: '2026-07-21 05:46'
updated_date: '2026-07-21 05:57'
---


Batch of five UX fixes from dogfooding, agreed in brainstorming with the owner.
Several revise decisions from doc-8 (§3, §9, §10) and TASK-87/89/93, so this doc
is the alignment artifact before an advisor review and implementation planning.

**Prerequisite ordering:** land before TASK-98 (the release squash + production
reset) so the new column, trigger change, and onboarding fold into the baseline
and get exercised by the owner's post-reset re-signup.

## Context (as-is)

- My Work (`/my-work`, doc-8 §9, TASK-89): a cross-project read of the signed-in
  user's assigned, non-Icebox, non-done stories, split into **Today** (a personal
  project's current iteration + pinned) and **Assigned** (grouped by project). A
  quick-add appears only when the user has exactly one "personal" project, writing
  into that project's current iteration.
- "Personal" is currently inferred as `iteration_length === 1` — there is **no
  flag** (doc-8 deliberately avoided one: "My Work accent keys off
  iteration_length=1, not a flag").
- TASK-93: signup auto-creates a "My Tasks" project (1-day cadence, minimal
  template) via the `handle_new_user` trigger. It is an ordinary project, so it
  **appears in the projects list** (`/dashboard`) and the sidebar switcher.
- TASK-87 / doc-8 §3: changing `iteration_length` applies only to the **next**
  iteration row; the current iteration is never re-shaped.
- Leftover from the removed Tracker/Free `workflow_mode` split (doc-8 single-mode):
  a `<Badge>Tracker</Badge>` still renders on every project card
  (`project-card.tsx`) and in the sidebar (`app-sidebar.tsx`).
- Login/dev-login redirects to `/dashboard`; `auth/callback` honors a `next` param.
- No toast/feedback infrastructure exists. Project Settings `updateProject` is a
  bare `<form action={updateProject}>` with no success feedback.

## Problems (owner feedback)

1. Saving Project Settings gives no confirmation it saved.
2. Changing cadence to 1-day leaves the current iteration at the old length; the
   owner expected the current one to switch too (they had just created the project
   at 1w).
3. New accounts should land on My Work, and it should be possible to create a
   project from My Work; keep the projects list, but make My Work ↔ Projects flow
   smoother.
4. The "Tracker" badge is a meaningless leftover now that mode is single and the
   axis is My Work vs Projects.
5. Adding a task in My Work silently lands in a project (the personal "My Tasks",
   which also shows in the projects list). My Work is empty by default and its
   purpose is unclear. The owner wants personal tasks kept separate from the
   projects list.

## Decisions

### D1 — My Work = personal todo + cross-project dashboard (items 5, 3)

My Work keeps both sections (Today / Assigned) and doubles as the entry point for
**personal tasks** that don't belong to any team project. Personal tasks are still
backed by the real "My Tasks" project, but that project is **hidden from the
projects list and the sidebar switcher**, so personal tasks and team projects no
longer mix in the list.

- **`projects.is_personal boolean NOT NULL DEFAULT false`** identifies the personal
  project. This reverses doc-8's "no flag" call; justified because the new
  requirement (hide it from the list) cannot be met by `iteration_length === 1` —
  a real 1-day *team* project is legitimate and must stay in the list. Exactly one
  personal project per user (created at signup).
- `handle_new_user` (TASK-93) is amended to set `is_personal = true` on "My Tasks".
- `/dashboard` project query and the sidebar switcher exclude `is_personal = true`.
- My Work's `isPersonal` / solo-personal-project detection switches from
  `iteration_length === 1` to the `is_personal` flag.
- Empty state: My Work always shows the personal quick-add (when the user has a
  personal project) and copy that frames it as "add a personal task" — so an empty
  My Work explains itself.

### D2 — Onboarding & navigation (item 3)

- Login, dev-login, and the OAuth `callback` default redirect target become
  **`/my-work`** (was `/dashboard`).
- My Work gains a **"New project"** entry that navigates to `/dashboard` with the
  existing inline create panel opened (e.g. `?new=1`), reusing that panel rather
  than duplicating a creation form. The projects list (`/dashboard`) stays as the
  dedicated project index.
- Sidebar already makes My Work ↔ project switching easy; no nav restructure beyond
  the badge change (D4) and the personal-project exclusion (D1).

### D3 — Cadence change: choose scope at change time (item 2)

Project Settings offers, when `iteration_length` changes, a choice:

- **From the next iteration** (default — the current TASK-87 behavior, unchanged).
- **Also re-shape the current iteration now** — re-derive the current iteration's
  `end_date` for the new length (1-day snaps to the working-day rule). Reuses the
  `override_iteration_length` advisory-lock pattern (or a sibling RPC) so a rollover
  can't race it; rejected if the current iteration is already `done`.

Keeps TASK-87's default (stable running-sprint boundaries) and makes re-shaping an
explicit opt-in, which covers the just-created case the owner hit.

### D4 — Remove the "Tracker" badge (item 4)

Delete `<Badge>Tracker</Badge>` from `project-card.tsx` and the sidebar
`mode-badge`. No replacement badge for now (single mode; the projects list holds
only team projects after D1, so a per-card mode label carries no information).
Update `project-card.test.tsx` / `app-sidebar` tests accordingly.

### D5 — Shared save feedback via a toast (item 1)

Add a lightweight shared toast built on Radix Toast (the `radix-ui` meta package is
already a dependency — no new dep). A `<Toaster>` mounts once in the app shell; a
small `toast()` helper is called from client components after a server action
resolves. First consumer: Project Settings save ("Project updated"). Shaped so
other forms (labels, working days, states, invites) can adopt it incrementally.

## Affected surfaces

- **DB:** new migration — `projects.is_personal` column; amend `handle_new_user`;
  possibly a new/extended RPC for D3's "re-shape current" path. rls-security-reviewer
  pass required. Optional one-time backfill (mark existing `iteration_length = 1`,
  single-owner projects personal) — likely unnecessary since TASK-98 resets prod;
  decide in planning.
- **Web:** `/dashboard` query + sidebar switcher (exclude personal); `my-work/page.tsx`
  + quick-add + empty state; `auth/login`, `auth/callback` redirects; Settings form
  (cadence choice + toast); app shell (`<Toaster>`); `project-card.tsx` +
  `app-sidebar.tsx` (badge removal); a new toast module + helper.
- **Spec:** `spec/data-model.md` (is_personal), `spec/screens.md` (onboarding →
  My Work, personal-tasks framing, badge removal), `spec/features.md` (My Work as
  personal todo; cadence-change choice), `spec/velocity.md` (§3 cadence-change
  scope option). Record the doc-8 §9/§10 and §3 revisions with rationale.

## Task decomposition (for planning / Backlog)

Independent enough to be separate tasks, ordered:

1. **is_personal + hide personal project + My Work personal-todo framing** (D1) — the
   core; DB migration + trigger amend + list/switcher/My Work changes + spec.
2. **Onboarding → My Work + New-project entry** (D2) — depends on 1 (personal
   project must exist / be identifiable).
3. **Cadence-change scope choice** (D3) — independent DB + Settings work.
4. **Shared toast + Settings save feedback** (D5) — independent infra.
5. **Remove Tracker badge** (D4) — trivial cleanup, independent.

## Risks / open points

- **is_personal reverses a doc-8 decision** — advisor review required; confirm one
  personal project per user is enforced (or acceptable if not).
- **D3 touches the finalize/iteration-boundary path** (concurrency) — advisor +
  rls-security-reviewer.
- **Onboarding redirect** interacts with `auth/callback`'s `next` param — make sure a
  deep link (`next`) still wins over the `/my-work` default.
- Order vs TASK-98: these should merge before the squash.

## Process gate

Per repo CLAUDE.md, this plan (new column, trigger change, concurrency-sensitive
cadence path) must pass an `/advisor` (fable-advisor) review before implementation,
and each migration needs an `rls-security-reviewer` pass. This doc is the input to
that review; after it, decompose into the Backlog tasks above and implement each
with its own review + tests.

## Advisor corrections (2026-07-21, fable-advisor — approve-with-fixes)

- **D1 exclusion filter must be `is_personal AND created_by = auth.uid()`**, NOT bare
  `is_personal`. `projects` SELECT RLS is member-scoped, so if "My Tasks" ever gets an
  invited member (features.md currently allows invites), a bare filter would hide it from
  that member's own `/dashboard` + switcher too. Hide only the viewer's own personal project.
- **D1 add a partial unique index** `create unique index ... on public.projects(created_by) where is_personal` to enforce one-personal-project-per-user at the DB (decision-1), not just trust the signup trigger.
- **D1 Move/Copy picker:** `getMoveTargetProjects` (`apps/web/app/stories/[id]/actions.ts`) queries `project_members` directly and is independent of the list filter — "My Tasks" stays a move/copy target. Decided **intentional**; note it in the task's acceptance criteria so it isn't re-flagged.
- **D1 migration:** new migration `create or replace`s `handle_new_user` to add `is_personal = true`; do NOT edit `20260721000001_personal_project_on_signup.sql`. Leave a comment on TASK-93 that doc-11 reversed the no-flag decision. Update the "no flag" wording in `spec/data-model.md`, `spec/features.md` (§ Personal project), `spec/screens.md` (Onboarding) with the reversal rationale.
- **D2 also fix `apps/web/app/page.tsx`** (signed-in `/` → `/my-work`) and the dev-login line in `auth/login/page.tsx` (`window.location.href`). `auth/callback/route.ts`: change only the default fallback (`?? "/"`), keep the `next`-priority branch. The `next` deep-link path is currently dead (OAuth start / middleware don't set `next`); reviving it is out of scope.
- **D3 is a NEW RPC `reshape_current_iteration(p_iteration_id)`, not an extension of `override_iteration_length`.** It reads `iteration_length` from `projects` itself (closes TOCTOU); for 1-day it re-derives via DB-side `next_working_day` (reuse finalize_iteration's branch — no client re-implementation of calendar logic); it takes the same `hashtext('iteration_finalize:'||project_id)` advisory lock + re-read-after-lock pattern and reuses override_iteration_length's guards (not-past / ≤90d / no-op-if-unchanged). **Add an explicit error when the project has no current iteration** (`v_latest IS NULL`) — Settings/layout don't run `ensureCurrentIteration`, so a direct Settings deep-link on a brand-new project can reach this with no iteration row.
- **D3 no renumber/retitle needed:** `iterationLabel()` already derives the title from the project's current `iteration_length` at render (TASK-87 behavior), so switching to 1-day flips all titles to date form automatically. Add a spec note that the default ("from next") path leaves the running iteration as "date-titled but multi-day span" until it ends — expected, not a bug.
- **D3 no conflict** with the capacity snapshot (only set at finalize) or iteration_goals (keyed by next number) — confirmed, no guard needed there.
- **D4:** when removing the `mode-badge` in `app-sidebar.tsx`, do NOT touch `ModeToggle` (that's the light/dark theme toggle — unrelated name).
- **D5 signal mechanism:** reuse the existing `invite_failed` query-param + client-read pattern (redirect with a success param a client component reads and fires the toast on) rather than new plumbing; the toast itself is the shared UI.
- **Ordering:** D1 (incl. the handle_new_user change) MUST land before TASK-98 (its baseline expects the final personal-project trigger). D2 only *soft*-depends on D1 (My Work's `iteration_length===1` detection already works since TASK-93 is Done) — parallelizable. D3/D4/D5 are independent of TASK-98 and need not ship pre-reset.
