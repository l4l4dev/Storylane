---
id: TASK-193
title: /epics two panes + StoryPeek + story detail Child stories section
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-24 18:16'
updated_date: '2026-07-26 03:46'
labels:
  - web
milestone: m-6
dependencies:
  - TASK-189
documentation:
  - doc-20
type: feature
ordinal: 1770
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-20 §6. Opening an epic today shows a plain story detail: no children, no progress (owner defect 4). /epics only links out to it.

Turn /epics into two panes (epic list with roll-up progress on the left, the selected epic's children on the right) and let a child open in the existing StoryPeek — the same component and peekStoryId URL parameter the board and My Work already use, so no new detail screen is built. The container's own story detail gains a Child stories section using the same child-row component as the Epics band (TASK-190).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /epics renders the epic list and the selected epic's children in two panes
- [x] #2 Clicking a child opens the existing StoryPeek (peekStoryId) with its description, tasks and comments — no new detail screen
- [x] #3 A container's story detail gains a Child stories section: roll-up progress bar, child rows with their location, and add-a-child
- [x] #4 The Epics band, /epics and the detail section share one child-row component
- [x] #5 The /epics empty state points at + Add Epic instead of the old split-an-oversized-story wording
- [x] #6 fable-advisor design review against spec/ux-principles.md before manual verification
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extract two components out of board-list-view.tsx into components/features/epics/ (AC#4 —
   one child-row component shared by the band, /epics, and the detail section):
   - epic-child-row.tsx: the light "location dot + #number + title + points" row
     (renamed EpicBandChildRow -> EpicChildRow, same JSX/classes, same useOpenPeek/
     BAND_LOCATION_LABEL/DOT_CLASS, EpicBandChild type import from epics-list.ts).
   - add-epic-button.tsx: AddEpicButton verbatim (already decoupled from the band's
     collapse state - only needs an onCreate callback), fixing its two relative imports
     (use-inline-edit, draft-story-card) to absolute @/components/features/board/...
   board-list-view.tsx imports both back in; EpicBandRow (dnd-kit-coupled, band-specific)
   and EpicRowGhost stay put, unchanged.
2. app/stories/[id]/actions.ts (getStoryDetail): extend StoryDetail with epicColor
   (story.epic_color, already selected via `*`), children: EpicBandChild[], childRollup:
   ContainerRollup, and addChildCandidates: {id,number,title}[] (top-level, non-container,
   excluding self - the mirror of parentCandidates but is_container=false). Fetch: full
   child rows (id, number, title, points, state_id, iteration_id) alongside the existing
   childCount query, project_states categories (already fetched as statesData - reuse),
   current iteration id (new lightweight iterations query, same derivation as
   board/page.tsx's currentIteration), and the candidates query. Build children/childRollup
   via buildEpicBandChildren/buildContainerListItems (single-item array) from epics-list.ts.
3. story-detail-panel.tsx: new childStoriesSection (detail.isContainer only, historySection's
   <section><h3> idiom), placed where parentPicker sits (mutually exclusive - never both
   visible) - EpicProgressBar(childRollup, epicColor ?? DEFAULT_EPIC_COLOR), children.map via
   EpicChildRow or "No stories yet.", then a new AddChildPicker.
4. components/features/story/add-child-picker.tsx (new): NativeSelect of addChildCandidates
   (ParentPicker's UI shape, no confirmation dialog needed since containers are pre-excluded
   from the list) calling setStoryParent({storyId: candidateId, projectId, parentId:
   containerId}) on selection, then router.refresh() (this client component's own
   responsibility - setStoryParent already revalidatePaths /stories/[containerId] server-side,
   refresh() is what makes the ALREADY-MOUNTED page pick that up). Resets to placeholder on
   success; surfaces the action's message on failure.
5. Rewrite app/projects/[id]/epics/page.tsx as two panes (AC#1/#2/#5):
   - Reads searchParams.epic (selected id) and searchParams.story (peek, same `story` param
     board/page.tsx uses - doc-20's "peekStoryId" is just a local var name, not the URL key).
   - Fetches containerRows, full child rows, states, current-iteration id (same derivation as
     step 2) the same way board/page.tsx does, plus getStoryDetail(story) when the peek param
     is present.
   - buildContainerListItems + buildEpicBandChildren for the rollups/children.
   - Left pane: "Epics" header + count + a new client add-epic-trigger.tsx (wraps
     AddEpicButton, calls createEpic, on success router.push(`?epic=${id}`) - principle 10,
     land in what you created) + the epic list as Links to `?epic=<id>` (highlighted when
     selected), or "No epics yet." when empty (AC#5 - no more split-story wording, the
     always-visible + Add Epic header button is what "points at" it now).
   - Right pane: nothing selected -> "Select an epic to see its stories."; selected epic's
     EpicProgressBar + its EpicChildRow list (AC#2: clicking one calls useOpenPeek, i.e. sets
     `story`, same as the band).
   - StoryPeekHost rendered at the page level (mirrors board/page.tsx's wiring) so the peek
     overlay actually shows.
6. Tests: epic-child-row.test.tsx / add-epic-button.test.tsx (moved+adjusted from
   board-list-view.test.tsx's existing coverage of the same behavior, kept there only for
   the band-integration assertions that need the full DnD context); epics/page might need a
   light integration-style test or manual-only given it's a server component with two search
   params - lean on fable-advisor's review + manual verification for the page itself, unit-test
   the extracted pieces and getStoryDetail's new fields; add-child-picker.test.tsx.
7. Full suite + lint, then fable-advisor design review against spec/ux-principles.md (AC#6,
   principles 2/4/8/10 per the doc's own citations) before proposing manual verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented per plan. Key pieces:
- Extracted EpicChildRow (components/features/epics/epic-child-row.tsx) and AddEpicButton
  (components/features/epics/add-epic-button.tsx) out of board-list-view.tsx — the shared
  child-row component AC#4 wants, used by the List view's Epics band, /epics' right pane,
  and the story detail's new Child stories section.
- getStoryDetail (app/stories/[id]/actions.ts) extended with epicColor/children/childRollup
  (buildContainerListItems/buildEpicBandChildren, same as board/page.tsx) and
  addChildCandidates (top-level, non-container stories, the mirror of parentCandidates).
- story-detail-panel.tsx: new "Child stories" section (isContainer only, mutually exclusive
  with the Parent picker which a container never shows) + new AddChildPicker
  (components/features/story/add-child-picker.tsx) — a plain NativeSelect calling
  setStoryParent on selection, no confirmation dialog (candidates are pre-filtered to
  non-containers, so nothing can be surprise-containerized the way the Parent picker's
  reverse direction can).
- app/projects/[id]/epics/page.tsx rewritten as two panes: searchParams.epic (selection) +
  searchParams.story (peek, same `story` param board/page.tsx uses — doc-20's "peekStoryId"
  is a local variable name in that file, not the URL key). StoryPeekHost wired the same way
  board/page.tsx does. Empty state (AC#5) drops the old split-story wording; the header's
  always-visible "+ Add Epic" is what points at it now.
- epics-page-add-button.tsx: wraps AddEpicButton, navigates to ?epic=<id> on success
  (principle 10) — the List view's own version instead expands the band in place, since
  /epics has no band-collapse state to open.

fable-advisor design review (AC#6): 修正付き承認, 3 corrections applied:
- Epic-switch links in /epics' left pane built a fixed `?epic=<id>` href, silently dropping
  an open peek's `?story=<id>` — every other nav in the app (useOpenPeek, board-filters.tsx)
  merges into the existing searchParams instead. Fixed by appending `&story=<id>` when a
  peek is open (principle 8: acting on an item never teleports you out of your context).
- doc-20 §3 itself flagged this as a re-check item: EpicBandChildInput's `isDone: boolean`
  folded rejected into the same "not done" bucket as a live current-iteration story, so a
  bounced child got a Current/Backlog/Icebox dot instead of its own, reading as still-active
  work (ux-principles principle 9 — live and dormant must not interleave). Replaced isDone
  with the child's full `category: StateCategory | null`; BandChildLocation gained "rejected"
  as its own dot (rose, matching lib/utils/stories.ts's existing rejected-badge color),
  ranked alongside done (both terminal) rather than falling through to a zone dot. Threaded
  through all 3 buildEpicBandChildren callers (board/page.tsx, epics/page.tsx,
  stories/[id]/actions.ts).
- /epics' right pane said "Select an epic to see its stories." even with zero epics to
  select — changed to "Create an epic to get started." when the project has none.
Confirmed fine as-is: AddChildPicker's no-confirmation immediate write (symmetric with
ParentPicker's own already-safe directions; a mistaken add is reversible via the added
story's own Parent picker or the row menu's "Remove from epic").

Re-verified after fixes: full apps/web suite 1078 passed / SUPABASE_INTEGRATION=1 after a
clean supabase db reset, lint + tsc clean.

/code-review high (2 findings, real bugs, both fixed):
- CONFIRMED (severe): epics-list.ts's buildEpicBandChildren ranked done/rejected children
  into one shared bucket sorted by raw position, contradicting its own doc comment's
  "position is scoped per zone, never compared across zones" -- a current-iteration accept
  and a since-finalized-iteration accept could sort by meaningless cross-sequence numbers.
  Fixed: rank now follows the child's underlying zone (current/backlog/icebox), decoupled
  from the done/rejected DISPLAY label (which still gets its own dot per TASK-193's earlier
  fable-advisor round). Regression test added proving a current-zone accept always outranks
  a backlog-zone accept regardless of raw position.
- CONFIRMED: EpicChildRow's onClick (useOpenPeek, pushes ?story=<id>) was a dead click on
  the standalone /stories/[id] page -- that page never read searchParams.story or rendered
  a StoryPeekHost, unlike board/page.tsx and epics/page.tsx. Fixed by wiring the same
  peek-host pattern there too (a container's own detail can now peek into a child without
  leaving the page). Regression test added.

Also fixed (medium/low, all confirmed against source):
- epics/page.tsx was missing the ensureCurrentIteration() call board/page.tsx makes before
  reading iteration state -- a visitor landing on /epics without ever opening /board first
  saw location dots classified against a stale, not-yet-rolled-over iteration.
- add-child-picker.tsx's bare .then() (no .catch) left `pending` stuck true forever if
  setStoryParent rejected outright instead of resolving {ok:false} -- rewritten as
  async/await + try/finally, also fixing the apps/web/CLAUDE.md "always async/await"
  violation. Regression test added.
- currentIteration derivation (filter non-done, sort by number, take highest) was
  hand-duplicated in board/page.tsx, epics/page.tsx and stories/[id]/actions.ts -- extracted
  to kanban.ts's currentIterationOf<T>, generic over whatever iteration shape the caller
  fetched. Unit tests added.
- board-list-view.tsx's containerRowIds/collisionDetection were rebuilt every render,
  including every onDragOver-driven re-render during a live drag -- memoized off the one
  zone they actually read (containers[CONTAINER_ROWS_ZONE_ID]), which stays reference-stable
  across drags in unrelated zones.
- getStoryDetail fetched childRows/iterationsData/addChildCandidateRows unconditionally for
  every story even though they're only rendered when isContainer -- and is_container is
  derived as has_children OR epic_pinned, so a non-container provably has zero children.
  Gated all three behind story.is_container; dropped the now-redundant separate childCount
  count query in favour of childRows.length (same query, was already fetching the same rows).
- Drive-by comment-policy cleanup (CLAUDE.md Code Comment Policy): history narration in
  kanban.ts and board-list-view.test.tsx, plus 4 reviewer-attribution comments in
  epic_pinned.sql and 2 already-committed integration test files (folded into TASK-195's
  AC#3, which is now satisfied).

Asked the owner about the one finding flagged as "needs a product decision, not an obvious
fix": dropping a story already attached to epic A onto epic B silently re-parents it with no
confirmation (unlike the Parent picker's containerize-an-existing-story direction, which
does confirm). Owner: leave as-is -- consistent with attach's established "cheap, freely
reversible" design (Remove from epic / Parent picker undo it, AddChildPicker already skips
confirmation for the same reason).

Not acted on (judgment calls, not bugs): a finder's suggestion to reuse zoneForStory via a
narrower non-KanbanStory-shaped helper instead of bandChildLocation's dummy-field approach
(this dummy-field approach was itself the fix for a PRIOR review's "don't duplicate
zoneForStory's branching" finding -- reverting it would undo that); a finder's suggestion to
extract a 4th shared "epic identity strip" component across EpicBandRow/EpicRowGhost/
epics/page.tsx (these three already have genuinely different interaction models -- draggable
+ attach-highlight, static drag-overlay snapshot, and full-navigation Link -- unlike
EpicChildRow's identical click-to-peek behaviour across all 3 surfaces, which is what
justified extracting THAT one).

Re-verified after all fixes: full apps/web suite 1085 passed / SUPABASE_INTEGRATION=1 after a
clean supabase db reset, lint + tsc clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
/epics を二枚パネル化(左: エピック一覧+ロールアップ、右: 選択エピックの子ストーリー、doc-20 §6)。子クリックで既存 StoryPeek が開く(board と同じ ?story= パラメータ)。コンテナのストーリー詳細に Child stories セクション(ロールアップ+子行+add-a-child)を追加。EpicChildRow / AddEpicButton を components/features/epics/ に抽出し、List view のバンド・/epics・詳細セクションの3面で共有(AC#4)。

fable-advisor のレビューで doc-20 §3 自身が保留していた論点が浮上: rejected が done と同じ「非アクティブ」扱いになり Current 等のドットに紛れ込んでいた。BandChildLocation に rejected 専用ドット(rose)を追加し、3箇所の buildEpicBandChildren 呼び出し元すべてに波及させて修正。他2点(エピック切替リンクが開いていた peek を消す、0件時の右ペイン文言)も修正済み。

検証: クリーンな supabase db reset 後、SUPABASE_INTEGRATION=1 で全1078テスト通過、lint/tsc クリーン。手動ブラウザ確認は未実施。
<!-- SECTION:FINAL_SUMMARY:END -->
