---
id: doc-13
title: >-
  13 — Full codebase review 2026-07-21 — 8-layer audit
  (web/ios/core/mcp/migrations)
type: specification
created_date: '2026-07-21 10:56'
updated_date: '2026-07-22 09:04'
---
# Full codebase review 2026-07-21 — 8-layer audit

## Method

Not a diff review — an audit of the codebase as it stands, split into 8
independent areas and reviewed by separate agents in parallel (no shared
context, no cross-referencing between areas). Each area's agent read every
non-test file in scope and reported only findings it could point to exact
lines for. The `supabase/migrations/` area additionally got a live
confirmation (local `supabase db reset` + a raw authenticated-role session)
for its top finding rather than static reading alone.

Areas: `apps/web/app/` (routes + server actions) · `apps/web/components/features/board/`
· `apps/web/components/features/story/` + `projects/` · `apps/web/components/features/{my-work,shell,epics,settings}/`
+ `apps/web/components/ui/` · `apps/web/lib/` · `supabase/migrations/` (83 files,
10,478 lines) · `apps/ios/Storylane/` · `packages/core/src/` + `apps/mcp/`.

No verify/dedup pass ran across areas (unlike `/code-review`'s diff workflow) —
each finding below is single-agent-read confidence, not cross-verified, except
the `iterations` INSERT finding which was tested live. Total findings: 36
across all 8 areas.

## Status note (2026-07-21)

iOS implementation is currently paused. iOS findings are recorded below for
whenever iOS work resumes, but were **not** turned into Backlog tasks in this
pass — only Web-relevant findings were (see linked tasks below, most severe
first). Web-relevant here includes `apps/web/`, `apps/mcp/`, `packages/core/`,
and `supabase/migrations/` — everything except `apps/ios/`.

---

## Findings — Web-relevant (tasked)

### 🔴 High severity

**1. `iterations` table has no INSERT restriction** — `supabase/migrations/20260627000004_iterations.sql:26`
The only INSERT policy allows any owner/member to insert an arbitrary row
(state, velocity, capacity, number) with no server-side validation, unlike the
UPDATE-side lockdown added for the same columns (`20260720000002_iteration_capacity.sql:37-38`).
**Confirmed live** against a local DB: an ordinary project member can
`INSERT INTO iterations (..., number, state, velocity, capacity) VALUES
(999999, 'done', 999999, 0.001)` directly, which succeeds. A later
`finalize_iteration` call then starts iteration #1,000,000, permanently
derailing sprint numbering, and the forged velocity/capacity poisons the
rolling velocity-rate window forever (spec/velocity.md). Fix: revoke
table-level INSERT on `iterations` from `authenticated` — `finalize_iteration`
is SECURITY DEFINER and is already the sole intended writer of new rows.

**2. Kanban/List position-scope mismatch corrupts List-view story order** — `apps/web/lib/utils/kanban.ts:254` (`flattenCurrentZone`)
`flattenCurrentZone` sorts merged stories by raw `position` assuming one
shared sequence, but Kanban drags reset `position` per-state-column
(`move_story_board`'s `tracker` branch) while List drags use one project-wide
sequence (the `else` branch) — the two scopes are incompatible. A user who
reorders stories within two different Kanban columns (each column's positions
reset to 0,1,2…), then switches to List view, sees stories from different
columns interleave in the wrong order.

**3. Move/Copy target picker ignores the caller entirely** — `apps/web/app/stories/[id]/actions.ts:303` (`getMoveTargetProjects`)
The query never filters by the signed-in user's id, so it returns projects
where *any* member holds owner/member role, not projects the caller
themself has that role in. A viewer-only member of Project B can see Project
B offered as a Move/Copy target from Project A, contradicting the documented
owner/member-only rule (the transfer RPC likely still rejects it, but the
picker misleads the user).

**4. Drag-failure rollback discards unrelated confirmed moves** — `apps/web/components/features/board/kanban-columns-board.tsx:511` (also `board-list-view.tsx:1284`)
The catch handler for a rejected drag reverts to `synced` (the last
server-confirmed snapshot from props), not "state right before this drag" —
conflating undo-this-drag with discard-everything-since-last-sync. A second,
unrelated already-accepted drag can be visually undone until the next
refresh arrives.

**5. Realtime prop refresh can clobber an in-progress drag** — `apps/web/components/features/board/kanban-columns-board.tsx:415` (also `board-list-view.tsx:1188`)
Containers resync whenever `initialContainers` changes reference — including
realtime updates from unrelated concurrent users — even while a drag is
physically in progress (`activeId` non-null). If the dragged story's DOM node
unmounts as a result, the eventual drop computes anchors against an item no
longer present, silently falling back to append semantics.

**6. `toggleStoryTask`'s archived-project guard is skippable** — `apps/mcp/src/handlers.ts:638`
Every other MCP write tool unconditionally asserts the project is writable
(not archived) before writing; `toggleStoryTask` only does so `if (projectId)`
is truthy, silently skipping the check if the `stories(project_id)` embed
ever resolves null (an RLS/embedding edge case, or a future refactor).

### 🟡 Medium severity

**7. `project_states` INSERT has no position-contiguity check** — `supabase/migrations/20260719000005_project_states.sql:40`
The bare owner/member INSERT policy has no constraint on `position`, letting
a direct client insert bypass `create_project_state`'s advisory-lock-protected
contiguity logic that the board's advance-button graph depends on.

**8. Cadence RPCs check role before the lock, not after** — `supabase/migrations/20260720000006_flexible_cadence.sql:146` (`override_iteration_length`) and `supabase/migrations/20260721000005_reshape_current_iteration.sql:34` (`reshape_current_iteration`)
Both check the caller's project role before taking the advisory lock and
never re-check after, unlike `finalize_iteration`/`transition_story`/
`set_story_state` which re-derive authorization after locking specifically
to close a role-revoked-mid-flight race. Narrow TOCTOU, requires a concurrent
admin action against the same caller.

**9. Stale user-search results can overwrite fresher ones** — `apps/web/components/features/projects/invite-member-form.tsx:33`
The debounced search effect calls `setResults` unconditionally on resolution
with no request-id/abort guard — a slower earlier query can resolve after a
faster later one and overwrite its results.

**10. Project-creation failure throws uncaught, no inline error** — `apps/web/components/features/projects/inline-create-panel.tsx:29`
`handleCreate` awaits `createProject` with no try/catch; `createProject`
throws on a DB error instead of returning a value like every sibling action
in this directory — an uncaught exception reaches the nearest error boundary
instead of an inline message.

**11. Shared `pendingKey` lets a second delete fire mid-flight** — `apps/web/components/features/story/task-checklist.tsx:29`
A single shared `pendingKey` string (not per-task) backs every task's
busy-lock. Clicking Delete on task A then Toggle on task B before A's request
resolves re-enables task A's Delete button while A's delete is still in
flight.

**12. Favorite toggle silently reverts on failure, no error** — `apps/web/components/features/projects/project-card-menu.tsx:43`
On RPC failure the optimistic favorite toggle just reverts with zero message,
unlike the sibling pin toggle which explicitly follows ux-principles.md
principle 2 ("a failed action must say so").

**13. Promote-to-Epic dialog shows stale error on reopen** — `apps/web/components/features/story/story-peek-menu.tsx:144`
The dialog's `error`/`pending` state isn't reset when reopened, unlike the
sibling MoveCopyDialog which clears its error in an open-keyed effect.

**14. Epic dialog closes before knowing if the save succeeded** — `apps/web/components/features/epics/epic-form-dialog.tsx:46`
`onSubmit={() => setOpen(false)}` fires synchronously, before the server
action resolves; both create/update epic return early with no error signal
on an empty/whitespace-only name — the dialog closes as if it succeeded.

**15. MCP `points` schema unconstrained vs. project point scale** — `apps/mcp/src/index.ts:88` (`create_story`/`update_story`)
Accepts any `points >= 0` with no check against the project's configured
point scale (fibonacci/linear/custom), even though `packages/core` already
exports `pointScaleValues()` for this — an agent can land an off-scale value
the Web UI's point picker can never produce.

### 🟢 Low severity (cleanup / efficiency / conventions)

- **Dead code**: `quickCreateStory` (`apps/web/app/projects/[id]/board/actions.ts:88-152`, superseded by `createDraftStory`) · `EpicPanel`/`EpicPanelData` (`apps/web/components/features/board/epic-panel.tsx`, unreferenced) · `rowInsertAnchors` (`apps/web/lib/utils/iterations.ts:238-248`, unreferenced) · `acceptedPoints` (`packages/core/src/velocity.ts:85-89`, unreferenced — finalization is done in SQL, not TS)
- **Efficiency**: N+1 per-project queries in dashboard (`apps/web/app/dashboard/page.tsx:59-79`, fetchIterations/fetchMembers loop instead of `.in("project_id", ...)`) · sequential `invite_member` RPC calls in project creation (`apps/web/app/dashboard/actions.ts:106-116`, up to 20 one-at-a-time instead of `Promise.all`) · My Work's story query has no `.in("project_id", ...)` filter, over-fetching then discarding in JS (`apps/web/app/my-work/page.tsx:79-88`) · `MyWorkSections`' `hasFilterableItems` recomputes `buildMyWorkSections` a second time just for a boolean (`apps/web/components/features/my-work/my-work-sections.tsx:72-75` — introduced by this session's own TASK-109 fix, worth a follow-up)
- **Duplication**: `evaluateDrop`/`evaluateListDrop`'s icebox-demotion and backlog-return blocks are near-verbatim copies (`apps/web/lib/utils/kanban.ts`) · hand-rolled debounce timers duplicated in `story-detail-panel.tsx` and `invite-member-form.tsx` (no shared `useDebouncedCallback`) · `formatDate`/`formatDateTime` both inline the same date-part extraction (`apps/web/lib/utils/format.ts:30-40`)
- **CLAUDE.md convention violations**: `.then()` chain instead of async/await (`apps/web/components/features/shell/notification-listener.tsx:34`) · repeated history-narration comments citing "TASK-70"/"TASK-86" as justification instead of stating the current invariant (`apps/mcp/src/handlers.ts:106,192-196,509,550`) · stale comment referencing removed "Free mode" (`apps/web/components/features/board/mutation-error-banner.tsx:5`) · `utcTodayKey` in `apps/mcp/src/handlers.ts:13-15` reimplements `packages/core`'s `formatDateOnly` instead of importing it

---

## Findings — iOS (recorded, not tasked — iOS work is paused)

1. **`AuthManager` bypasses the Repository layer** — `apps/ios/Storylane/Features/Auth/AuthManager.swift:14,21-24,27-31,35` calls Supabase directly instead of through a Repository, unlike every other feature; no seam to inject a fake for ViewModel-style unit testing.
2. **Assignee/epic assignment silently dropped on create and update** — `apps/ios/Storylane/Repositories/StoryRepository.swift:22-34,36-47`. `NewStoryPayload`/`StoryUpdatePayload` don't encode `assigneeId`/`epicId` even though the params/model carry them — a future assignee/epic picker would silently discard the value server-side.
3. **State-advance logic duplicated verbatim** — `apps/ios/Storylane/Features/Backlog/BacklogViewModel.swift:29-50` and `apps/ios/Storylane/Features/Story/StoryDetailViewModel.swift:24-41` implement identical advance/reject try/catch logic.
4. **Full backlog refetch after creating a single story** — `apps/ios/Storylane/Features/Story/StoryEditViewModel.swift:52` discards the repository's returned `Story`, forcing a full reload instead of a local append.
5. **Member-list mutations always trigger a full refetch** — `apps/ios/Storylane/Features/Projects/ProjectSettingsViewModel.swift:37-63` (invite/updateRole/remove) re-fetch the entire roster instead of updating locally.
6. **`BacklogViewModel.load()` has no in-flight guard** — `apps/ios/Storylane/Features/Backlog/BacklogViewModel.swift:18-27`. Two concurrent `load()` calls (view re-appear + pull-to-refresh) can race; an out-of-order response silently reverts newer state.

---

## Task tracking

Web-relevant findings above were turned into Backlog tasks, most-severe-first
(iOS findings were not tasked — iOS implementation is paused):

| Finding | Task |
|---|---|
| #1 iterations INSERT unrestricted | TASK-110 (@claude-opus-4-8, High) |
| #2 Kanban/List position-scope mismatch | TASK-111 (@claude-opus-4-8, High) |
| #3 getMoveTargetProjects ignores caller | TASK-112 (@claude-sonnet-5, High) |
| #4 + #5 Board drag concurrency (rollback scope + realtime clobber) | TASK-113 (@claude-opus-4-8, High) |
| #6 toggleStoryTask archived-project guard | TASK-114 (@claude-sonnet-5, Medium) |
| #7 project_states INSERT position-contiguity | TASK-115 (@claude-opus-4-8, Medium) |
| #8 Cadence RPCs TOCTOU | TASK-116 (@claude-opus-4-8, Medium) |
| #9 Stale user-search race | TASK-117 (@claude-sonnet-5, Medium) |
| #10 Project-creation uncaught throw | TASK-118 (@claude-sonnet-5, Medium) |
| #11 Shared pendingKey double-delete | TASK-119 (@claude-sonnet-5, Medium) |
| #12 Favorite toggle silent revert | TASK-120 (@claude-haiku-4-5, Medium) |
| #13 Promote-to-Epic stale error on reopen | TASK-121 (@claude-haiku-4-5, Medium) |
| #14 Epic dialog closes before result known | TASK-122 (@claude-sonnet-5, Medium) |
| #15 MCP points schema unconstrained | TASK-123 (@claude-sonnet-5, Medium) |
| Low-severity: dead code removal | TASK-124 (@claude-haiku-4-5, Low) |
| Low-severity: efficiency bundle | TASK-125 (@claude-sonnet-5, Low) |
| Low-severity: duplication cleanup | TASK-126 (@claude-sonnet-5, Low) |
| Low-severity: CLAUDE.md convention fixes | TASK-127 (@claude-haiku-4-5, Low) |
