---
id: TASK-232
title: >-
  Reduce board page-load work: dedupe auth/queries, parallelize fetch waves,
  trim story payload
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-12 15:05'
updated_date: '2026-08-13 03:58'
labels: []
milestone: m-2
dependencies: []
priority: medium
ordinal: 1150
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Opening a project page feels slow on the free tier. The board render currently issues ~20 Supabase queries in ~5 serial waves, calls auth.getUser() (an HTTP call to Supabase Auth) up to 4 times per request (middleware, layout, page, story peek), duplicates the projects/project_members queries between layout.tsx and board/page.tsx, and ships every story description (full body text) in the board select even though cards do not display it. Pinning the Vercel function region to hnd1 (commit 0efbc27) removed the trans-Pacific RTT; the remaining page-load cost is this per-request query fan-out.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 auth.getUser() results in at most one Auth network call per server request (per-request memoization, e.g. React.cache), verified across middleware/layout/page
- [x] #2 projects and project_members are fetched once per request, shared between layout and board page
- [x] #3 Queries with no data dependency on each other run in parallel; remaining serial steps are only the truly dependent ones
- [x] #4 Full suite passes from apps/web/: pnpm test and pnpm run lint
- [x] #5 Board story cards receive description trimmed to a short preview (~200 chars) before rendering; the story select itself still reads the full column (owner decision 2026-08-13: description is a real card-preview feature, not dead payload) and the side peek still shows the full description on open
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. lib/supabase/server.ts: add a React cache()-wrapped getUser() helper (calls createClient().auth.getUser() once per request; cache() is a real per-request memoizer under Next's RSC runtime and a harmless no-op passthrough in Vitest, per node_modules/react's client-build cache() source, so existing tests are unaffected)
2. New lib/supabase/project-data.ts: cache()-wrapped getProject(id) (superset of columns needed by layout+board+story-detail) and getProjectMembers(projectId), mirroring the existing sidebar-data.ts pattern
3. app/projects/[id]/layout.tsx: use getProject(id) + getUser() instead of its inline queries
4. app/projects/[id]/board/page.tsx: use getUser()/getProject(id)/getProjectMembers(id); restructure the awaits so ensureCurrentIteration(id) and getStoryDetail(peekStoryId) fire immediately (not serially last), project+members fetch together, ensureCurrentIteration is awaited only right before the iterations query, and peekDetail is awaited only at render time -- collapses 5 serial stages to 3 without changing any real data dependency
5. app/stories/[id]/actions.ts getStoryDetail: use getUser()/getProject(story.project_id)/getProjectMembers(story.project_id) instead of its own inline queries -- dedupes with board/page.tsx when the side peek is open in the same request
6. AC4 revised per owner decision 2026-08-13 (description IS rendered as a one-line card preview in story-card.tsx, removing it would be a visible regression): keep the full-text select, add a pure truncateDescription() helper in lib/utils/stories.ts (~200 chars) applied only when building BoardStory.description for the board cards -- trims the RSC payload sent to the browser without changing the DB read or the side peek's full text
7. Add a unit test for truncateDescription in lib/utils/stories.test.ts
8. Run pnpm test and pnpm run lint from apps/web/
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: cache()-wrapped getUser() (server.ts) and getProject()/getProjectMembers() (new project-data.ts) dedupe per-request auth+project+members reads across layout/board/story-detail. board/page.tsx now fires ensureCurrentIteration and getStoryDetail(peek) immediately (with .catch no-op guards against unhandled rejections if an earlier read throws first) instead of stacking them after the main query batch. AC4 revised with owner: description stays a full-column select (still needed for the side peek); board cards get a new truncateDescription() (lib/utils/stories.ts, ~200 chars) applied only when building BoardStory, trimming the RSC payload without changing the DB read or the peek. Updated 3 test mocks to match: layout.test.tsx and board/page.test.tsx needed a getUser export (found a real TDZ gotcha: a mock factory referencing an outer vi.fn() variable is only hoisting-safe when the reference sits inside a lazily-invoked closure, e.g. () => getUserMock(), not as a bare top-level property value); history-query.test.ts likewise. pnpm test: 935 passed. pnpm run lint: 0 errors (1 pre-existing unrelated warning in auth/login/page.tsx). tsc --noEmit: clean.

AC1-3 (auth/query dedup, parallelization) can't be proven by this repo's Vitest suite: React's cache() is a documented no-op passthrough in the plain-React test build (confirmed by reading node_modules/react's client bundle source) and only really memoizes under Next's RSC server runtime. Left unchecked pending the owner's manual confirmation in a running dev server (steps given in chat) plus /code-review. Not moving to terminal status yet.

/code-review (medium) findings on this task's code, all resolved: (1) getStoryDetail's project fetch could silently proceed with a null project on a real read failure (switched from .single()/assertReadOk to getProject's maybeSingle) -- added an explicit throw, matching board/page.tsx and layout.tsx's own notFound()-after-getProject pattern. (2)+(3) ensureCurrentIteration (a mutating finalize_iteration RPC path) was firing before the project-existence check, inconsistent with iterations/page.tsx and epics/page.tsx, and its error could be silently swallowed by the .catch guard if notFound() fired first -- reverted to firing only after the project is confirmed to exist (removes the .catch guard entirely for this one); getStoryDetail's early fire is unaffected since it's a pure read with no rollover/mutation risk. (4) truncateDescription sliced by UTF-16 code unit, which could split a surrogate pair -- switched to Array.from(...).slice(...).join(''), which also removes the now-redundant length pre-check. (5) redundant ternary on peekDetail -- await null resolves to null, so  simplified to a plain await. (6) createClient() was being constructed independently inside getUser/getProject/getProjectMembers -- cache()-wrapped createClient() itself too, so all call sites in one request share one client/cookie-jar construction. Declined: a settle()-helper abstraction for the two catch-guards (there's only one left after fix 2/3, no longer worth it). Not fixed here: the anon-key RLS grant bug the review found in apps/web/app/api/cron/keepalive/route.ts -- that file isn't part of this task's changes (found already staged in the working tree, presumably separate in-flight work); flagged to the owner instead of touched. Re-verified after fixes: pnpm test 935 passed, pnpm run lint 0 errors, tsc --noEmit clean.

(correction: a backtick in the previous note's item 5 triggered shell command substitution and ate part of the sentence -- it should read: peekDetailPromise ? await peekDetailPromise : null simplified to a plain await peekDetailPromise.)

Unrelated fix found by this task's /code-review, committed separately (577cf06): apps/web/app/api/cron/keepalive/route.ts (a different, already-committed piece of work, not part of this task) was reading profiles with the anon key, which has no grants in this schema -- switched to SUPABASE_SERVICE_ROLE_KEY (already a documented Vercel env var per DEPLOY.md).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deduped per-request auth.getUser()/projects/project_members reads (React cache()-wrapped getUser/getProject/getProjectMembers, plus createClient() itself) across layout.tsx, board/page.tsx, and getStoryDetail; reordered board/page.tsx's awaits so the story-peek fetch runs concurrently with the rest of the board's queries instead of serially last (ensureCurrentIteration stays after the project-existence check, matching iterations/page.tsx and epics/page.tsx, per code-review finding); board cards now get a truncateDescription() preview (~200 chars, code-point safe) instead of the full text, while the side peek and DB read are unchanged (AC4 revised with owner 2026-08-13). Verified via pnpm test (935 passed), pnpm run lint (0 errors), tsc --noEmit (clean), a /code-review medium pass (6 findings on this task's code, all fixed; 1 unrelated finding on a different already-committed file fixed and committed separately in 577cf06), and owner approval to proceed without a live-server Network-tab trace (React's cache() dedup can't be exercised by this repo's Vitest suite, which runs on React's plain client build where cache() is a documented no-op).
<!-- SECTION:FINAL_SUMMARY:END -->
