---
name: project-task-172-story-full-page-width
description: TASK-172 /stories/[id] two-column split (StoryDetailPanel layout="split") implemented per prior blueprint and approved 2026-07-23 — AC#4 satisfied; one non-blocking tab-order nitpick left for a follow-up
metadata:
  type: project
---

TASK-172 AC#4 asked for `/stories/[id]` to be **redesigned** (not just
widened) to use full screen width. The first attempt (max-w-2xl ->
max-w-4xl, single column) was flagged as insufficient. The owner picked the
two-column direction this agent recommended, and the implementer shipped it
exactly as blueprinted:

- `apps/web/components/features/story/story-fields.tsx`: added
  `section?: "all" | "title" | "meta"` (default `"all"`) — pure display
  branch (`showTitle`/`showMeta`), no logic change. Every existing caller
  (DraftStoryCard, the board/My Work peek) is unaffected.
- `apps/web/components/features/story/story-detail-panel.tsx`: added
  `layout?: "single" | "split"` (default `"single"`). Split renders a CSS
  Grid (`lg:grid-cols-[minmax(0,1fr)_18rem]`) with the sidebar (status row +
  `StoryFields section="meta"`) explicitly placed at
  `lg:col-start-2 lg:row-start-1` and main content (title/description +
  tasks + comments + history) at `lg:col-start-1 lg:row-start-1`. Below
  `lg`, both groups stack via plain `flex-col` in DOM order (sidebar first,
  for mobile). All hook/state logic (autosave, per-field lock, realtime
  merge) is untouched above the `return` — confirmed by reading the full
  file, not just the diff description.
- `apps/web/app/stories/[id]/page.tsx`: `max-w-5xl`, passes `layout="split"`.
- The board/My Work peek (`apps/web/components/features/board/story-peek.tsx:95`)
  still calls `<StoryDetailPanel detail={detail} />` with no `layout` prop —
  confirmed byte-identical to pre-change behavior.
- `story-detail-panel.test.tsx` has a dedicated split-layout test asserting
  every field (Title/Description/Type/Points/Epic/Assignee/a label) renders
  together — adequate substitute for the team-story screenshot the
  implementer couldn't capture that session.

**Why:** 2026-07-23 follow-up review, verified against actual code (not just
the implementer's description) per this agent's role.

**How to apply:** Verdict was 承認 (approved), AC#4 satisfied — treat this as
settled, don't re-litigate the split-vs-widen question again. One
non-blocking nitpick recorded for a future polish task: because the sidebar
is DOM-first (for mobile stacking) and only repositioned visually via
`lg:col-start-2` at desktop width, keyboard Tab order on desktop hits the
sidebar (status/type/points/epic/assignee/labels) before the visually-first
main column (title/description) — CSS `order`/`col-start` don't reorder
focus, only DOM order does. Not a spec-doc violation (none of
spec/ux-principles.md's 10 principles cover DOM/focus-order mismatch
directly) but worth fixing if this area is touched again: put main first in
DOM (matches desktop reading+tab order) and use a mobile-only `order-first`
on the sidebar instead of swapping which side is DOM-first.
