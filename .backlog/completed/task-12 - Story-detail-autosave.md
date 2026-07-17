---
id: TASK-12
title: Story detail autosave
status: Done
assignee:
  - '@l4l4dev'
created_date: '2026-07-07 14:26'
updated_date: '2026-07-08 12:25'
labels:
  - web
dependencies: []
references:
  - spec/screens.md
priority: high
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per spec/screens.md 'Story detail editing': remove Save buttons from the side peek and /stories/[id]. Title/description autosave on ~800ms debounce and on blur (Esc reverts); discrete fields save on change; a 'Saving… / Saved' indicator sits in the peek header; failed saves keep the local value with error + retry; Realtime updates must not clobber a field being edited.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No Save button remains in the side peek or /stories/[id]
- [x] #2 Title and description autosave after debounce and on blur; Esc reverts to last saved value
- [x] #3 Saving/Saved indicator reflects in-flight state; save failure shows an error, keeps local value, and offers retry
- [x] #4 An incoming Realtime update does not overwrite a field with uncommitted local edits
- [x] #5 Tests cover debounce save, blur save, Esc revert, and failure retry
- [x] #6 Conflict rules per spec/screens.md 'Conflict & failure rules': saves serialized per story with one trailing save, field-level lock vs Realtime (last-write-wins per field, self-echo ignored)
- [x] #7 Pending edits flush on blur / peek close / route change; empty title is never saved; a remotely deleted story shows a state that keeps unsaved text copyable
- [x] #8 Autosave produces no per-save activity-log rows or Slack notifications (verified against the existing trigger)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design reviewed by fable-advisor before implementation, per CLAUDE.md advisor rule. Advisor caught four real correctness gaps in my initial plan before I wrote any code: a plain UPDATE cannot detect a deleted/inaccessible row (zero rows affected is not an error), throwing from a server action loses the ability to distinguish deleted-vs-transient-error in production (Next.js masks thrown messages), the client-side synced value must come from what the server actually persisted (not what was sent, since the server trims/normalizes/nulls points), and the label replace (delete then insert) needed to become one transaction given autosaves frequency.

DB: new update_story RPC (no SECURITY DEFINER - runs under the calling users own RLS, same as the plain UPDATE it replaces) does, in one transaction: SELECT...FOR UPDATE to lock and detect not-found (returns zero rows, which the caller treats as not_found rather than success), rejects empty title, validates points against the projects point scale (mirrors parsePoints in stories.ts), updates the row (never touching project_id or state), and replaces story_labels. Verified directly via SQL: trims correctly, nulls points when switching to a non-point type, returns zero rows for a nonexistent id, rejects blank title.

Server action: updateStory now takes a typed input object (not FormData) and returns a discriminated result { ok: true, story } | { ok: false, reason: not_found | error, message }. Never calls revalidatePath - the caller applies the returned row directly into local state, and the board picks up the change through its existing useProjectBoardRealtime subscription instead of a second refresh channel that could race the per-field lock.

Realtime: useStoryRealtime now takes three callbacks (onFieldsChanged, onDeleted, onCommentsChanged) instead of one generic refetch signal - split so the panel can merge only into unlocked fields on UPDATE and switch straight to the deleted state on DELETE. useDebouncedCallback became overloaded (plain no-arg vs payload-carrying) rather than a single generic default, since a naive generic default produced a callback type the Realtime SDKs on() overload resolution could not structurally match.

Client (StoryDetailPanel): full rewrite from one uncontrolled form + Save button to a controlled snapshot (local) plus a synced (last server-confirmed) ref, per-field dirty/focused Sets that define lock, and a save orchestrator serialized per story (at most one in-flight update_story call; edits arriving during flight are collapsed into exactly one trailing save with the latest snapshot, always sending full field values per spec, never diffs). Text fields debounce 800ms and flush on blur; discrete fields (type, points, epic, assignee, custom status, labels) save immediately on change. Escape reverts to the synced value and stops propagation so it does not also trigger the peeks close-on-Escape; both the fields own handler and the peeks global listener additionally ignore Escape while isComposing (IME conversion cancel) per the advisors specific callout - this was not something I would have caught unprompted and is exactly the kind of bug that silently breaks Japanese input. A failed save keeps the typed value, shows the servers error message, and offers Retry. A not_found result (or a Realtime DELETE) switches to a dedicated deleted-story view that still shows the unsaved text, read-only but selectable/copyable.

Found and fixed during live verification (not caught by the advisor or my own unit tests, since it only shows up with two independent Realtime subscriptions racing): the boards own useProjectBoardRealtime already refreshes the whole route on any stories change in the project, including a delete of the currently-peeked story; that refresh re-runs getStoryDetail server-side, gets null back, and the boards {peekDetail && <StoryPeek/>} conditional unmounted the whole panel before its own delete-detection ever got a chance to run - silently closing the peek instead of showing the deleted state, the opposite of AC#7. Fixed by adding StoryPeekHost, an always-rendered client wrapper that remembers the last non-null detail for the current peekStoryId in its own state, so StoryDetailPanel never unmounts just because the boards coarse refresh raced ahead of the panels own fine-grained Realtime subscription. Reproduced the original bug and confirmed the fix live: edited a title, deleted the row directly in the database, and the peek showed This story was deleted with the unsaved edit intact instead of closing.

Verified live end to end: no Save button; title debounce-autosaves and the change reflects on the boards card via Realtime with no page reload; a discrete field (type) saves immediately without blur; activity_logs held exactly one row (story.created) after several autosaves, confirming AC#8 needed no new code since the trigger already only fires on state changes; delete-while-editing correctly shows the deleted state with the unsaved title preserved. Could not reliably exercise the sub-800ms Esc-before-save-fires window through this browser automation tool (unavoidable latency between tool calls exceeds the debounce), so that exact behavior relies on the fake-timer unit test rather than live confirmation - the unit test controls timing precisely and passes.

Tests: 14 in story-detail-panel.test.tsx (up from 4) covering debounce save, blur flush, Esc revert, IME-composing Escape is ignored, failure keeps value and retries, in-flight edits collapse to one trailing save, not_found switches to deleted state with text preserved, discrete field needs no blur, and Realtime respects the per-field lock. 5 in realtime.test.tsx for the new split UPDATE/DELETE/comments subscriptions and payload-preserving debounce.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the story detail forms single Save button with field-level autosave: a new update_story Postgres RPC makes the label replace transactional and gives a reliable not-found signal, the server action returns a discriminated result instead of throwing, and StoryDetailPanel now tracks a local/synced snapshot with per-field dirty/focused locks feeding a per-story save orchestrator (debounced+blur-flushed text fields, immediate-save discrete fields, one collapsed trailing save for edits made mid-flight). Escape reverts with IME-composition awareness, failures keep the typed value with retry, and a deleted story (via Realtime or a failed save) switches to a copyable read-only view instead of silently closing - including a live-discovered fix (StoryPeekHost) so the boards own coarse Realtime refresh cannot unmount the peek out from under that detection. Verified with tsc, eslint, vitest (208 passing, 19 new/changed across the two touched test files), and a live browser walkthrough of autosave, immediate discrete-field save, activity-log quiet-ness, and delete-while-editing.
<!-- SECTION:FINAL_SUMMARY:END -->
