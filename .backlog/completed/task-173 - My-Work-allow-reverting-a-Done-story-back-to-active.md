---
id: TASK-173
title: 'My Work: allow reverting a Done story back to active'
status: Done
assignee:
  - '@claude-opus-4-8'
created_date: '2026-07-23 06:42'
updated_date: '2026-07-23 13:41'
labels: []
milestone: m-2
dependencies: []
references:
  - spec/data-model.md
  - apps/web/lib/utils/my-work.ts
  - apps/web/app/my-work/actions.ts
priority: high
type: feature
ordinal: 1900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Done in My Work is currently an append-only log by design (doc-15): story_completions rows are written by the maintain_story_completed_at trigger and there is no path back to an active column. The owner reports this doesn't match reality — a done story is sometimes rejected/reopened and needs to move back to Todo/Today.

Scope needs a decision before implementation: for personal-project stories, My Work's Todo/Done drags already write the real story state directly via the set_story_state personal-project exemption (see spec/data-model.md My Work state / set_story_state), so reverting is a same-project state change. For TEAM stories, the story's real state lives on its own project board and My Work's Done entry is only a live-joined log row of a state that happened elsewhere — reverting a team story from My Work would mean writing that story's real state from outside its board's normal drag path, which is more architecturally sensitive (cross-project-style write, RLS/membership implications). This task's implementer must resolve the personal-vs-team scope (get a fable-advisor + owner decision per CLAUDE.md's architectural-change rule) before writing code, and it's acceptable to ship personal-project revert first and scope team-story revert as a follow-up if the two turn out to need different mechanisms.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Done entry for a personal-project story can be moved back to an active column (Todo/Today/a free column) directly from My Work, and this updates the story's real state
- [x] #2 The chosen behavior for team-story Done entries (revert supported directly, or a clear path to the story's own board to change state) is implemented and documented in the task's final summary
- [x] #3 RLS/membership rules are respected for whichever write path is used (rls-security-reviewer pass if the migration/RPC surface changes)
- [x] #4 Reverting a Done story back to an active column leaves the append-only story_completions log intact (never deleted — doc-14/doc-15, spec/data-model.md); the story may correctly appear as both a live card and a historical Done entry, distinguished by the existing 'Completed' marker (doc-17 #12 owner decision). No completion-deletion path is added.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Per fable-advisor verdict (2026-07-23): AC#3 rewritten (no completion deletion — spec/doc-17 #12 locked). No new migration/RPC/trigger.

1. Fix the silent-disappear bug in setMyWorkColumn (apps/web/app/my-work/actions.ts): a personal Done card dragged to Today or a free column skips the isPersonal Todo/Done branch, so set_story_state is never called, completed_at stays 'done', and the card is filtered out of the next assigned fetch (page.tsx .is('completed_at', null)) — it silently vanishes (ux-principles principle 2). Widen the branch: if the story's CURRENT real category is 'done' and isPersonal, reopen it to the lowest unstarted state via set_story_state FIRST (for any active target: todo/today/free), then fall through to the existing today/free/todo mark writes. target==='done' completion path unchanged.
2. Team story revert stays rejected (personal-only now per task), but replace the plain rejection string with a clickable link to the story (/stories/<id>) so the user isn't dead-ended (principle 8). Widen MutationErrorBanner message to ReactNode, or attach the link on the Done card — implementer's call; leaning ReactNode on the banner since that's where the drag rejection already surfaces.
3. Tests: (a) personal Done->Today and Done->free column both call set_story_state(lowest unstarted) then persist the mark; (b) existing Done->Todo drag-out still reopens; (c) team Done drag-out still rejected AND the rejection now carries a working link.
4. No rls-security-reviewer (no migration/RPC). UI/drag behavior changes -> fable-advisor design review before commit (CLAUDE.md).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
No migration/RPC/trigger (fable-advisor verdict). Reused set_story_state (existing personal-exemption RLS). AC#3 rewritten with owner approval — story_completions stays append-only (spec/doc-17 #12 lock), not deleted.

Root fix (actions.ts setMyWorkColumn): a personal real-done card dragged out of Done to Today OR a free column now reopens the real state (set_story_state -> lowest unstarted) FIRST, then falls through to the existing local-mark write. Previously only Todo reopened; Today/free skipped it, so completed_at stayed 'done', the page's completed_at-is-null filter dropped the card from the next fetch, and it silently vanished (principle 2). Personal Todo kept as its own branch (doc-15: My Work Todo always maps to real unstarted, unconditional). Non-real-done personal cards keep pure-local overlays.

Team story out of Done stays rejected (personal-only revert now), but the rejection is now a clickable link to /stories/<id> (principle 8) instead of a dead-end string: MutationErrorBanner message widened string->ReactNode (board callers unaffected), dragError state widened to ReactNode, and a new pure helper isTeamDoneOutRejection gates the link.

Verified: actions.test.ts (+3: Done->Today reopen+mark, Done->free reopen+mark, non-done Today mark-only), my-work.test.ts (+isTeamDoneOutRejection), full suite 713 pass, tsc+eslint clean. Live Playwright: personal card dragged to Done then back out reappears as a live active card (state flipped Done->Todo = reopened) alongside its append-only Done log entry (Completed marker) — never vanished. Team link not live-tested (needs a completed team story assigned to dev user); predicate + ReactNode banner are unit/type-covered. Two fable-advisor passes: scope/design verdict (rewrote AC#3, found the Today/free vanish bug, required the team link) and a closing design review (approved; required one spec/screens.md line update, done).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reverting a Done story back to an active column now works for personal projects: dragging a real-done personal card out of Done to Todo/Today/a free column reopens its real state (set_story_state) instead of silently vanishing (the Today/free path skipped the reopen — a pre-existing bug). Team stories stay reopen-on-their-own-board, but the rejection is now a clickable link to the story (principle 8). No completions are deleted — the append-only Done log is preserved and the live+historical duplicate is distinguished by the existing Completed marker (AC#3 rewritten with owner approval to match locked spec/doc-17 #12). No migration/RPC (reuses set_story_state). Verified with unit tests, a live drag through the app, and two fable-advisor reviews.
<!-- SECTION:FINAL_SUMMARY:END -->
