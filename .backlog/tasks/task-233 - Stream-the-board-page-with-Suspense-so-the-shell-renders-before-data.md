---
id: TASK-233
title: Stream the board page with Suspense so the shell renders before data
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-12 15:05'
updated_date: '2026-08-13 04:42'
labels: []
milestone: m-2
dependencies:
  - TASK-232
priority: medium
ordinal: 1200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The board page currently blocks on the slowest of all its queries before anything renders — loading.tsx exists but there is no Suspense boundary anywhere, so navigation shows a blank/stale view until every query resolves. Render the app shell (sidebar, header, board frame) immediately and stream the board content in when its data resolves, so the page feels responsive even when queries are slow. Follow-up to TASK-232; do after it lands so the streamed subtree wraps the already-slimmed data fetch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Navigating to /projects/[id]/board paints the sidebar and board frame before board data resolves (Suspense boundary with a skeleton fallback around the board content)
- [x] #2 Story side peek (?story=) does not block the initial board paint
- [x] #3 No behavior regression: board interactions (drag, quick-add, filters) work as before
- [x] #4 Full suite passes from apps/web/: pnpm test and pnpm run lint
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Split board/page.tsx: the exported BoardPage stays lean -- reads params/searchParams, computes inviteFailedCount, awaits only getProject(id) (fast + cached with layout.tsx's own call per TASK-232), notFound()s if missing, then renders the <main> shell (h1 with the real project name, InviteFailedBanner) plus <Suspense fallback={<BoardContentSkeleton/>}><BoardContent .../></Suspense>.
2. New async (non-exported) BoardContent function in the same file, taking id/project/type/assignee/label/peekStoryId as props: does everything currently after the project fetch (getUser, getProjectMembers, ensureCurrentIteration -- still only after the project is confirmed to exist per the code-review fix, the peek fetch fired at its own top for concurrency, the 7-query batch, capacity resolution, card/epic/backlog building) and renders KanbanBoard + StoryPeekHost exactly as today. StoryPeekHost stays unconditionally rendered (per its own header comment -- must never be gated by a Suspense boundary, it manages its own mount lifecycle across realtime-triggered refreshes) -- no nested Suspense around just the peek.
3. Extract loading.tsx's filters-row+skeleton-rows markup into an exported BoardContentSkeleton (excluding the outer <main>/title skeleton, which stays real in the fast shell now) so loading.tsx (full first-paint) and the new inner Suspense fallback share one skeleton definition instead of two.
4. Add a small sr-only status span to the inner Suspense fallback (loading.tsx's own aria-busy/status wrapper only covers the very first paint, not a later client-side re-navigation between boards).
5. Verify board/page.test.tsx's existing test (project-read-failure -> throws) still passes unchanged (BoardPage itself still awaits getProject directly, before any JSX/Suspense is constructed).
6. Run pnpm test and pnpm run lint from apps/web/.
7. This touches user-facing loading UI -- run a fable-advisor design review against spec/ux-principles.md before handing off for manual verification (per CLAUDE.md Critical Rules).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
fable-advisor design review: approved, no changes required. Clarification per the advisor: AC#2 ("story side peek does not block the initial board paint") is satisfied in the sense that the page SHELL (title, sidebar) paints immediately regardless of the peek -- but when ?story= is set, the KanbanBoard itself (inside the same Suspense boundary as the peek) still waits for the peek fetch to resolve before it flushes, since StoryPeekHost must stay outside any nested Suspense boundary (its own header comment: gating it would risk unmounting an open peek mid-edit across a realtime-triggered refresh). This is a deliberate single-boundary trade-off, not a gap. Advisor also confirmed: the shared BoardContentSkeleton (loading.tsx + the new inner Suspense fallback) is the correct structure (a separate skeleton design would make the loading.tsx-to-shell handoff visibly jump), the double sr-only "Loading board" status announcement (outer loading.tsx + inner Suspense fallback) is intentional and should not be collapsed (removing either leaves a real gap silent to screen readers), and the error path (assertReadOk throws inside BoardContent) still reaches error.tsx unchanged.

Second /code-review (after the initial Suspense split) found 3 real regressions I introduced while restructuring: (1) getUser/getProjectMembers/ensureCurrentIteration had gone back to firing serially inside BoardContent -- fixed: restored full concurrency (safe now, since BoardContent only ever renders after BoardPage already confirmed the project exists, unlike TASK-232's board/page.tsx which had to gate ensureCurrentIteration behind that same check itself). (2) The 7-query batch was entirely gated behind ensureCurrentIteration's rollover even though only the iterations select needs it -- fixed: the other 6 queries (both stories fetches, labels, dividers, iteration_goals, project_states) now fire immediately, concurrently with ensureCurrentIteration, and only the iterations query itself waits for it. (3) The outer <main> lost the aria-busy the old loading.tsx had -- fixed: the Suspense fallback is now wrapped in its own aria-busy div (fallback and resolved content each carry their own state correctly, since Suspense swaps the whole subtree). Also fixed: a stale comment on peekDetailPromise's timing, truncateDescription materializing the whole string via Array.from before slicing (now a for...of loop with an early break, plus a length fast-path for the common short-description case), a redundant projectId prop (BoardContent now derives id from project.id, which BoardPage already guarantees matches), and the duplicated sr-only "Loading board" span (extracted a shared BoardLoadingStatus from loading.tsx, used by both the route-level fallback and the new inner Suspense fallback). Declined: (a) the streamed-response/200-status-before-error-surfaces observation -- this is inherent to Next.js's own loading.tsx Suspense mechanism, which already existed on this route before TASK-233; not a new regression, and fixing it would mean removing streaming/loading.tsx entirely. (b) getProject/getProjectMembers not taking an injected supabase client like fetchSidebarData -- this is deliberate (cache() dedupes by argument identity, so an object-typed client parameter would break the cross-call-site dedup this exists for); added a comment explaining why. (c) getStoryDetail's generic error message on a null project -- assertReadOk already preserves the original Postgrest message for any real read failure; my generic throw only covers the (FK-guaranteed-near-impossible) zero-rows-no-error case, which never had a specific message to preserve. Follow-up idea surfaced by the review, not actioned: extending getProject/getProjectMembers's dedup to iterations/epics/activity/settings pages, which still run their own inline projects queries -- out of scope for both TASK-232 and TASK-233 (board + story detail only); flagged to the owner rather than task-created unilaterally. Re-verified after all fixes: pnpm test 935 passed, pnpm run lint 0 errors, tsc --noEmit clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split board/page.tsx into a lean BoardPage (awaits only the fast, per-request-cached project row, then renders the real title shell immediately) and a new BoardContent async component (everything else: members, ensureCurrentIteration, the 7-query batch, capacity, the story-peek fetch, KanbanBoard/StoryPeekHost) wrapped in <Suspense fallback={<BoardContentSkeleton/>}>. Extracted BoardContentSkeleton out of loading.tsx so the route-level fallback and the new inner Suspense fallback share one skeleton definition. StoryPeekHost stays outside any nested Suspense boundary per its own mount-lifecycle constraint. Verified via pnpm test (935 passed, including the existing project-read-failure test unchanged), pnpm run lint (0 errors), tsc --noEmit (clean), and a fable-advisor design review against spec/ux-principles.md (approved, no changes requested; clarified that AC2 means the shell's initial paint isn't blocked by the peek, while the board content itself intentionally still waits on the peek fetch when ?story= is set, since StoryPeekHost can't be gated by its own nested boundary). AC3 (no interaction regression) rests on KanbanBoard/BoardFilters receiving byte-identical props from unchanged logic, just relocated into the new component -- no dnd-kit/filter/quick-add code was touched. Recommend the owner do one quick manual pass (drag a card, quick-add a story, apply a filter) as a sanity check, matching the same review-and-tests-first approach used on TASK-232.
<!-- SECTION:FINAL_SUMMARY:END -->
