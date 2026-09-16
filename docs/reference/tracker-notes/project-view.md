# Reference note — project view (frame, panels, story rows, expanded story)

Derived note for the Tracker-parity rewrite, steps 2–3 of
`docs/design/2026-09-16-tracker-parity-rewrite-design.md` §3.3. Written from the
archived help site in `docs/reference/tracker/` (git-ignored, Pivotal's
copyrighted material) — behaviour is restated in our own words, never copied.

Model-level facts (field names, state enum, API shapes) are **not** repeated
here — see `core-model.md`.

Two vintages of screenshot live in the corpus. Captures from 2024-12 (e.g.
`density_mode_story_display_options_1`, `tagging_stories_with_labels_2`,
`work_with_a_single_story_2`) are the target; a handful of older captures
(`using_story_panels_3/4/5`, `working_with_stories_1`, `backlog_to_current_flow_1`)
differ in small ways and are used only where the 2024 set is silent. Differences
are flagged inline.

---

## 1. Frame

### 1.1 Top header

One flat bar across the full window, two rows tall, no gap between them
(source: tagging_stories_with_labels, work_with_a_single_story).

Row 1, left → right: project avatar/icon; project name; a caret opening the
project switcher. Right end, in order: notification bell with an unread-count
badge; a search field labelled "Search project" with a `?` affordance at its
right edge opening search help; "WHAT'S NEW" with a caret; "HELP" with a caret;
the signed-in user's avatar with a caret. On the older capture the account name
appears in place of the avatar.

Row 2 is the project tab strip: **STORIES · ANALYTICS · MEMBERS · INTEGRATIONS ·
MORE**, uppercase, separated by thin vertical rules, with a chevron at the right
end of the strip that collapses the header to give the panels more height. The
active tab carries an underline. "SETTINGS" appears instead of "INTEGRATIONS" on
the older capture — the 2024 set is authoritative (source: work_with_a_single_story,
density_mode_story_display_options).

When one or more stories are selected, the Bulk Actions menu **replaces** the top
navigation menu; it shows the selection count in orange plus the bulk action
buttons, and reverts to the normal header once the selection is cleared
(source: updating_multiple_stories_quickly).

### 1.2 Left sidebar

Collapsible navigation column pinned to the left of the panel area. The toggle
sits at its top-left; collapsed, the sidebar shows icons only, auto-expands on
hover and collapses again on mouse-out, and the toggle pins it back open
(source: using_the_sidebar).

Contents top → bottom (union of the 2024 captures):

1. Sidebar collapse toggle (hamburger).
2. A project stats strip: project velocity (chart glyph + number), member count
   (person glyph + number), project colour swatch, story-density control ("Aa").
   Each is a tooltip on hover and a menu on click (source: using_the_sidebar).
3. **+ Add Story** — full-width primary button (source: using_the_sidebar).
4. Panel toggles, in this order (source: using_the_sidebar, density_mode_story_display_options,
   tagging_stories_with_labels, blocked_stories):
   1. **My Work** — with a right-aligned story count
   2. **Current** *(only when Current and Backlog are split)*
   3. **Backlog** *(only when split)* / **Current/backlog** *(combined, the default)*
   4. **Icebox**
   5. **Done**
   6. **Blocked** — with a right-aligned count
   7. *(separator)*
   8. **Epics**
   9. **Labels**
   10. Saved searches, one row each, magnifier glyph (e.g. "Active production bugs",
       "Bugs", "My bugs & features")
   11. Favourite epics, one row each
   12. Integrations, one row each (e.g. "JIRA", "Other")
   13. **Project History**
5. **Display: <density>** — opens Dense / Normal / Projector
   (source: density_mode_story_display_options).
6. Panel width control: an **Auto** ⇄ **Fixed** toggle, a width slider, and a
   *fit panels to browser* button at the right end (source: using_story_panels).

An open panel's sidebar row is highlighted; toggling the row opens/closes that
panel (source: using_the_sidebar).

### 1.3 Panels

- Panels sit **side by side** in one horizontally scrolling strip to the right
  of the sidebar; each panel scrolls vertically on its own (source: using_story_panels).
- **Rearrange**: drag a panel by its header to the left or right of another panel.
- **Resize**: `Auto` sizes panels to the window; switching to `Fixed` enables a
  width slider. In Fixed mode, double-clicking any panel header — or pressing the
  *fit panels to browser* button — re-fits panels to the window width.
- **Clone**: most story panels can be duplicated via **Clone panel** in the panel
  actions menu, so stories can be dragged between the two copies of a long list.
- Panel arrangement is **per user**, not per project, and persists until changed
  (source: using_story_panels).

Panel header, left → right (2024 layout): panel name; the project velocity chip
(chart glyph + number) on Current/Backlog panels; then, right-aligned,
**+ Add Story**, the **panel actions** kebab, and a **✕** close control. In the
older captures the ✕ sits at the *left* of the header instead; the 2024 layout is
the target (source: density_mode_story_display_options, tagging_stories_with_labels
vs. using_story_panels).

Panel actions menu, in order: **Select all · Clone panel · Expand all iterations ·
Collapse all iterations · Hide empty iterations · Split current & backlog** (or
**Combine current & backlog**) **· Add stories to bottom of panel**. Panels that
cannot take an item (a stand-alone Current panel, an epic stories panel) simply
omit it (source: using_story_panels, adding_stories, updating_multiple_stories_quickly).

Narrow-width behaviour is **not documented** in any article — see §7.

---

## 2. Panels

### 2.1 Icebox

Unprioritised stories, all in the `unscheduled` state. No iteration headers. New
stories land at the **top** by default, or at the bottom when *Add stories to
bottom of panel* is set (source: terminology, adding_stories, using_story_panels).
Dragging a story out of the Icebox into Current or Backlog prioritises it.
Release markers can be used inside the Icebox purely as visual separators — e.g.
an "Inbox" marker above freshly added stories (source: managing_the_icebox).

### 2.2 Backlog

Prioritised, unstarted stories, ordered top = highest priority, divided by
**iteration headers**. Tracker fills each future iteration with as many points as
the current velocity allows and re-flows the iterations whenever estimates or
order change; new iterations are created as needed. An iteration may hold fewer
points than velocity when Tracker predicts a story will span the boundary, which
is why entirely **empty iterations** can appear and why *Hide empty iterations*
exists (source: backlog_to_current_flow, prioritizing_stories, using_story_panels).

Some future iterations start collapsed; the arrow at the left of the iteration
marker expands one, and the panel actions menu expands/collapses all
(source: using_story_panels).

### 2.3 Current, and the combined Current/Backlog

Current and Backlog are **one combined panel by default**, titled
"Current Iteration/Backlog"; *Split current & backlog* / *Combine current &
backlog* in the panel actions menu switches between one and two panels. Split or
not, Current is the top of the Backlog (source: using_story_panels, backlog_to_current_flow).

Contents: every started story, plus enough unstarted stories from the top of the
Backlog to reach the project velocity in points, plus everything accepted since
the iteration began. Clicking **Start** on any Backlog story moves it into Current
regardless of whether it fits. Unestimated stories (bugs, chores) can be planned
into Current as long as total points have not passed velocity. Stories cannot be
*dragged* into Current beyond velocity (source: backlog_to_current_flow, prioritizing_stories).

With **Plan Current Iteration Automatically** off, Current holds only in-progress
stories, stories accepted this iteration, and stories explicitly dragged in
(source: automatic_vs_manual_planning).

Accepted stories turn green and rise to the top of the Current iteration; a
**Hide N accepted stories** bar sits at the top of the iteration and collapses
them (source: story_states, backlog_to_current_flow).

### 2.4 Done

Iterations that have finished, newest first, each under its own iteration header
showing points completed. Accepted stories move here only when the iteration they
were accepted in ends; unaccepted stories roll over into the new Current instead.
The last 12 completed iterations show by default, with a **"Displaying last X
iterations"** banner at the top that reveals all of them; the count is a project
setting. Everything in Done is `accepted` (source: terminology, backlog_to_current_flow).

### 2.5 Iteration headers inside panels

One bar per iteration carrying, left → right: an expand/collapse arrow, the
iteration number, the iteration date range (the Current iteration reads
"<start date> - Current"), then right-aligned the points ("N points", or
"Pts: N of M" / "N of M points" for Current) and the **team strength** control
(a people glyph, showing the percentage when it is not 100%). Clicking the team
strength glyph opens a percentage entry dialog (source: terminology,
understanding_velocity, backlog_to_current_flow).

### 2.6 Add story, per panel

**+ Add Story** in the panel header (or the `a` key, which adds to the Icebox)
opens a **draft story detail window in that panel** — an expanded story with an
empty, focused title field and **Cancel** / **Save** buttons; Save is also
CMD/CTRL+S. Default landing position: top of the Icebox; in Current, Backlog or
the combined panel, **above all other unstarted stories** (so below started ones).
*Add stories to bottom of panel* flips this to the bottom for the Icebox, Backlog
and combined panels — but not for a stand-alone Current panel or an epic stories
panel. Stories added inside an epic panel follow the **Icebox** setting. A story
added to the Backlog may be pulled straight into Current if Current is below
velocity (source: adding_stories, using_story_panels).

Empty states are **not shown in any corpus screenshot** — see §7.

---

## 3. Collapsed story row

Left → right (source: density_mode_story_display_options, tagging_stories_with_labels,
understanding_velocity, blocked_stories):

1. **Expand caret** — a small triangle at the far left; click expands the story
   in place. In Projector density it takes a double-click instead
   (source: density_mode_story_display_options).
2. **Story type icon** — feature = star, bug = ladybug, chore = gear,
   release = flag. Under it, when present, the **blocked / blocking indicator**:
   a red arrow for "has unresolved blockers", a black arrow for "is blocking
   another story", and a combined red+black arrow icon for both. Resolving a
   blocker turns its icon grey (source: blocked_stories, adding_stories).
3. **Estimate slot** — for an estimated story, the point value drawn as a stack
   of short horizontal bars (one glyph per point in the 2024 captures; the older
   captures render a numeral instead). Empty for bugs/chores in projects that do
   not estimate them.
4. **Comment indicator** — a speech-bubble glyph when the story has comments
   (source: using_story_panels, understanding_velocity).
5. **Title** — wraps to as many lines as needed. Owner initials are appended
   inline in parentheses at the end of the title, in link colour; clicking a set
   of initials runs a My Work search for that person (source: mywork_panel).
6. **Labels** — comma-separated, coloured, on their own line below the title in
   **Normal** density; **inline before the title** in **Dense** density; each is
   a link that runs a label search (source: density_mode_story_display_options,
   tagging_stories_with_labels).
7. **Review chips** — when the story has reviews, a line of review-type chips
   with a status glyph and the reviewer's initials sits below the labels
   (source: tagging_stories_with_labels).
8. **State button**, right-aligned. One button per state, except delivered which
   shows two: `unscheduled`/`unstarted`/`planned` → **Start**; `started` →
   **Finish**; `finished` → **Deliver**; `delivered` → **Accept** + **Reject**;
   `rejected` → **Restart**; `accepted` → no button
   (source: story_states, tracker_workflow).
   For an **estimable but unestimated** story the state button is replaced by the
   **point buttons** — the project's point scale rendered as a row of clickable
   values ending in a `+` (source: story_states, tagging_stories_with_labels).
9. **Selection checkbox** at the far right; shift-click selects a range and the
   Bulk Actions menu takes over the top header (source: updating_multiple_stories_quickly).

Rendering differences:

- Row background encodes state: `unscheduled` light blue, `unstarted`/`planned`
  light grey, `started`/`finished`/`delivered`/`rejected` light yellow,
  `accepted` green (source: story_states). Colour is explicitly out of scope for
  parity; the *rule* (background varies by state) is in scope.
- **Release rows** render as a solid full-width coloured bar with the flag icon
  and no estimate slot. Blue while on schedule; **red** once the iteration holding
  the marker starts after the target date. A release with a target date also draws
  a **black release-date marker line** at the end of the iteration the date falls
  in (source: organizing_releases).
- **Accepted rows** sit at the top of the Current iteration and are collapsible
  behind the "Hide N accepted stories" bar (source: story_states).
- In the Icebox capture, unestimated story titles render *italic*; no article
  states this rule — treat as unconfirmed (source: managing_the_icebox image).

---

## 4. Expanded story

The same component renders in three places: inline inside a panel (narrow, single
column), as a full-page story view (two columns), and as a draft for a new story.

**Full-page / wide layout** (source: work_with_a_single_story):

- A context bar above the story: "Contained in <project>", with an expand control
  and a **✕** at the right.
- **Left column**, top → bottom: collapse caret + **title** (large, click to edit);
  **BLOCKERS** (`+ Add blocker or impediment`); **DESCRIPTION**; **LABELS** (chips
  each with an `×`, plus a caret that lists existing labels); **CODE**
  ("Paste link to pull request or branch…"); **TASKS (done/total)** (`+ Add a task`);
  **ACTIVITY** with a `Sort by` control (Oldest to newest ⇄ Newest to oldest), a
  **Write / Preview** tab pair, a **Formatting help** link, a comment composer with
  the author avatar, @-mention / attachment / emoji buttons, and a **Post comment**
  button; then the activity entries, each with avatar, author, body, timestamp,
  a **React** control, **Copy link**, and a per-comment kebab.
- **Right rail**, top → bottom: a permalink glyph, `ID #<story id>`, a copy glyph,
  a history glyph, a delete (trash) glyph, and a **Collapse** button; then the
  field rows **STATE** (the state buttons plus a state select; a calendar control
  appears on this row for accepted stories, to change the accepted date),
  **REVIEWS** (`+ add review`, one row per review type with a reviewer select and a
  status select), **STORY TYPE**, **POINTS**, **REQUESTER**, **OWNERS** (avatars
  plus `+`; up to five), **FOLLOW THIS STORY** (`(N followers)` and a checkbox),
  and a "Updated: <relative time>" footer.

**Narrow / in-panel layout** (source: adding_stories, working_with_stories): the
same content in one column — title, then the action strip (permalink, ID, copy,
history, delete, and **Cancel** / **Save** on a draft or **Collapse** on a saved
story), then the field block (STORY TYPE / POINTS / REQUESTER / OWNERS / FOLLOW),
then BLOCKERS, DESCRIPTION, LABELS, CODE, TASKS, ACTIVITY. The older in-panel
capture puts requester and story-ID text in a footer strip instead.

Cloning, moving between projects and CSV export are reached from the Bulk Actions
menu rather than from the expanded story (source: updating_multiple_stories_quickly).

**Save behaviour** (source: saving_your_changes, adding_stories, project_page_preferences):

- A brand-new story must be saved once with the **Save** button under the title.
- After that first save, most field changes save immediately on change.
- Description and comments are exceptions: they commit via their own blue button.
- Blockers and tasks commit via their blue **Add** button or `Enter`.
- Collapsing the story (either caret) saves in-progress changes.
- `ESC` collapses **without** auto-saving and asks "Abandon your changes?".
- With *Save story on Enter* enabled in the profile, `Enter` saves a story, task
  or epic title.
- *Click to copy* in the profile enables the click-to-copy Story ID and URL
  controls at the top of the expanded story.

**Keyboard shortcuts** (source: keyboard_shortcuts, prioritizing_stories_keyboard):

| Action | Keys |
|---|---|
| Open skiplink navigation | `Shift + a` |
| Toggle Backlog / Done / History / Icebox | `Shift + b` / `d` / `h` / `i` |
| Toggle My Work / Labels / Current / Epics | `Shift + w` / `l` / `c` / `e` |
| Collapse open story (no auto-save) | `ESC` |
| Help (this dialog) | `?` |
| Add story | `a` |
| Add epic | `e` |
| Select story | `Tab` |
| Start moving story / commit move | `Space` |
| Move story while moving | `↑` / `↓` |
| Search | `/` |
| Save currently open story | `CMD/CTRL + s` |
| Save comment or description being edited | `CMD/CTRL + Enter` |

Markdown is supported in titles, descriptions, comments and tasks
(source: adding_stories).

---

## 5. Drag and drop

- Stories are dragged to reorder within Current, within the Backlog, and from the
  Icebox into Current or Backlog (source: prioritizing_stories).
- **Unstarted stories cannot be dragged above started stories** (source: prioritizing_stories).
- Dragging *into* Current is capped: you cannot drag more points into Current than
  the current velocity allows. Clicking **Start** moves a story into Current
  regardless of the cap (source: prioritizing_stories, backlog_to_current_flow).
  With automatic planning off, any unscheduled or unstarted story can be dragged
  into Current and becomes `planned` (source: automatic_vs_manual_planning, story_states).
- Dragging a story into the Backlog re-flows the iterations below it
  (source: prioritizing_stories).
- Stories **cannot** be reordered inside My Work or any search-results panel; use
  the **Reveal** icon on the row to jump to the story in its real panel and drag
  it there (source: prioritizing_stories, mywork_panel).
- Epic stories panels support dragging within the panel, up into the Backlog
  section and down into the Icebox section (source: prioritizing_stories).
- Panels themselves are dragged by their headers to reorder
  (source: using_story_panels).
- Tasks are dragged to reorder inside the expanded story (source: working_with_tasks).
- **Multi-select**: the per-row checkbox selects, shift-click selects a range,
  *Select all* in the panel actions menu selects the panel; the article describes
  selection as the input to Bulk Actions and to *dragging to a new location*
  (source: updating_multiple_stories_quickly, prioritizing_stories).
- Accepted stories are ordered by acceptance date, not by drag; reorder them by
  changing the accepted date via the calendar control in the expanded story's
  STATE row (source: prioritizing_stories, updating_accepted_stories).

---

## 6. Dimensions

**Ruler and scale.** Every figure below comes from
`density_mode_story_display_options_1@1x-3cae8882…png` (728×529). Ruler: the
1 CSS px story-row separator renders as **exactly one** fully-saturated image
pixel row (e.g. y=273, y=325, y=365, colour `(226,226,219)` against a
`(243,243,210)` row background), and every structural measurement lands on a
round number (sidebar 200, gutter 10, panel header 36). **Derived scale = 1.0
image px per CSS px** — this was the first reading. **Superseded:** once the
application stylesheet was recovered (see "From CSS (authoritative)" below),
five independent pairs put the image at ~0.87 CSS px per image px (a ~838 px
window saved at 728 px). The measured figures below are kept as ink-extent
evidence only; the CSS table is the source for implementation.

Cross-check: `using_the_sidebar_1/2@1x` show the same sidebar at 300 image px
wide. Taking the sidebar as 200 CSS px gives **scale 1.5** for that pair; the
collapsed-sidebar figure below uses it and is marked medium confidence.

`tagging_stories_with_labels_2`, `backlog_to_current_flow_2/3` and every other
728-wide full-window capture are downscaled by an unknown factor and are used
for **layout order only**, never for dimensions.

### Measured (CSS px)

| Element | Value | Source image |
|---|---|---|
| Top header, total height (both rows) | 52 | density_mode_story_display_options_1 |
| Active-tab underline | 2 | density_mode_story_display_options_1 |
| Sidebar width, expanded | 200 | density_mode_story_display_options_1 |
| Sidebar width, collapsed | ~36 (scale 1.5, medium confidence) | using_the_sidebar_2 |
| Sidebar collapse-toggle strip height | 44 | density_mode_story_display_options_1 |
| Sidebar panel-toggle row pitch | 33 | density_mode_story_display_options_1 |
| Gutter, sidebar → first panel | 10 | density_mode_story_display_options_1 |
| Gap above panel header (page background) | 11 | density_mode_story_display_options_1 |
| Panel header height | 36 | density_mode_story_display_options_1 |
| Panel header bottom border | 1 | density_mode_story_display_options_1 |
| Iteration header height (incl. 1px top border) | 27 | density_mode_story_display_options_1 |
| Iteration header calendar icon | 15 × 18 | density_mode_story_display_options_1 |
| Collapsed row, 1-line title + 1 label line (Normal) | 40–41 | density_mode_story_display_options_1 |
| Collapsed row, 2-line title + 1 label line (Normal) | 56 | density_mode_story_display_options_1 |
| Collapsed row, 1-line title + labels + blocked indicator | 51 | density_mode_story_display_options_1 |
| Row separator | 1 | density_mode_story_display_options_1 |
| Panel left edge → type-icon ink | 11 | density_mode_story_display_options_1 |
| Type icon ink (feature star) | 14 × 12 | density_mode_story_display_options_1 |
| Estimate slot ink, 1-point bar glyph | 8 × 1 | density_mode_story_display_options_1 |
| Panel left edge → title text left edge | 55 | density_mode_story_display_options_1 |
| State button height | 21 | density_mode_story_display_options_1 |
| State button width, "Accept" | 45 | density_mode_story_display_options_1 |
| State button width, "Reject" / "Finish" | 43 | density_mode_story_display_options_1 |
| Gap between Accept and Reject | 1 | density_mode_story_display_options_1 |
| Selection checkbox | 12 × 12 | density_mode_story_display_options_1 |
| Checkbox right edge → panel right edge | 11 | density_mode_story_display_options_1 |
| Story title cap-height / x-height | 8 / 6 | density_mode_story_display_options_1 |
| Panel header title cap-height | 10 | density_mode_story_display_options_1 |
| Tab-strip label cap-height (uppercase) | 8 | density_mode_story_display_options_1 |
| Iteration header text, digit height | 8 | density_mode_story_display_options_1 |
| Label text, ascender-to-descender ink | 10 | density_mode_story_display_options_1 |
| Panel width (Auto and Fixed) | unmeasurable from corpus — see note | — |
| Label chip height (expanded story LABELS field) | unmeasurable from corpus | — |
| Expanded-story right-rail width | unmeasurable from corpus | — |

Panel width note: panels are sized to the window in **Auto** mode and by a slider
in **Fixed** mode, so there is no single value to match; no corpus screenshot is
both unscaled and wide enough to measure a panel edge-to-edge
(source: using_story_panels).

### Inferred

Back-computed from the measured cap-height (8) and x-height (6) of the story-row
title, assuming a humanist sans with cap ratio ≈ 0.72 and x-height ratio ≈ 0.52
(the range spanned by Lato, Open Sans, Source Sans Pro and Helvetica). Every row
below is **inferred**.

| Element | Inferred size | Basis | Source image |
|---|---|---|---|
| Story row title (Normal density) | 12 px (±1) | cap 8 → 11.1; x-height 6 → 11.5–12.3 | density_mode_story_display_options_1 |
| Panel header title | 14 px (±1) | cap 10 → 13.9 | density_mode_story_display_options_1 |
| Iteration header text | 11–12 px | digit height 8 → 11.1 | density_mode_story_display_options_1 |
| Story row labels | 10–11 px | asc-to-desc ink 10, low confidence | density_mode_story_display_options_1 |
| Tab-strip labels (uppercase, letter-spaced) | 11 px (±1) | cap 8 → 11.1 | density_mode_story_display_options_1 |
| Font family | ~~unknown~~ → **`"Open Sans", open-sans, EmojiFontFace, helvetica, arial, sans-serif`** | resolved by the recovered application stylesheet; self-hosted `@font-face` weights 300/400/**600**/700 normal + 400/700 italic. See `css-tokens.md` §1 | — |

Density modes: **Dense** puts labels inline with the title, **Normal** puts them
on their own line, **Projector** enlarges the type. The Projector sample row is
visibly larger than the Normal one but no ruler is available in those crops, so
the Projector/Dense font sizes are **unmeasurable from corpus**
(source: density_mode_story_display_options_2/3/5).

---

### From CSS (authoritative)

Since the tables above were written, the real application stylesheet was recovered
(`docs/reference/tracker/assets/assets.pivotaltracker.com/next/assets/next/*-next.css`,
git-ignored). Where it speaks, it — not a screenshot — is the source of truth. The
full token sheet is `css-tokens.md`; the rows here are only those that overlap the
measured/inferred tables above. Hash suffixes are stripped from selectors.

| Element | CSS value | Selector | Δ vs measured |
|---|---|---|---|
| Page/board background | `#212121` | `html, body`; `section.main` | new |
| Board offset, header collapsed | `top: 35px` | `section.main` | — |
| Board offset, tab strip shown | `top: 61px` (2024 capture; `80px` in 2025, see below) | `.layouts.expanded_header section.main` | measured 52 — **CSS 61** |
| Sidebar width, expanded | `width: 230px` | `.Sidebar--expanded` | measured 200 — **CSS 230** |
| Sidebar width, collapsed | `width: 46px` | `.Sidebar--collapsed`; `aside.sidebar.collapsed .fixed` | measured ~36 — **CSS 46** |
| Sidebar panel-toggle row | `height: 28px; padding: 9px 0 8px 15px; font-size: 12px` | `aside.sidebar .panel_toggle .panel_name` | measured pitch 33 — **CSS 28** |
| Sidebar stats strip | `height: 32px; padding: 10px 10px 10px 13px; font-size: 13px` | `aside.sidebar .details` | measured toggle strip 44 |
| Panel minimum width | `min-width: 375px`, `margin-right: 8px` (gutter) | `.panel` | resolves "unmeasurable" |
| Board padding | `padding: 12px 4px 12px 12px` | `section.panels .table` | measured gutter 10, gap 11 |
| Panel header | `border-top: 2px solid` (panel colour), `height: auto`; controls `height: 28px`; title `line-height: 14px; padding-top: 7px; color: #aaa; font-weight: 600; text-transform: uppercase` | `.panel .workspace_header(h3)(.controls)` | measured 36 ≈ 28 + 2 + padding |
| Iteration header | `height: 20px; line-height: 20px; padding: 1px 2px; font-size: 11px; background: #676E7A` + 1px top and bottom border | `.iteration .preview` | measured 27 — **CSS 24** |
| Collapsed row, padding | `padding: 4px 8px` | `.StoryPreviewItem__preview` (×3, lazy chunk) | resolves the 1px from `.story.feature .preview` |
| Collapsed row, base type | `font-size: 12px; line-height: 24px` | `.preview` | confirms the inferred 12px |
| Collapsed row, title | `margin: 4px 0 2px; line-height: 18px; letter-spacing: 0.1px` | `.StoryPreviewItem__storyName` | — |
| Collapsed row, label line | `line-height: 14px`; chip `font-size: 10px; font-weight: bold; color: #063` | `.layouts.normal … .post.labels`; `.label.std` | confirms the inferred 10–11px |
| Collapsed row height, 1-line title + 1 label line | **47** (derived: 4+4 padding + 1 border + 24 title + 14 labels) | — | measured 40–41 — **CSS 47** |
| Collapsed row height, 2-line title + labels | **65** (derived) | — | measured 56 — **CSS 65** |
| Collapsed row height, blocked | `min-height: 51px` | `.story.has_blockers_or_blocking header` | measured 51 — **match** |
| Type icon box | `18px × 18px; margin-right: 2px`; feature art `16px 16px`, bug `18px 15px`, chore `18px 14px` | `.StoryPreviewItem__storyType` | measured ink 14 × 12 |
| Estimate glyph | `height: 15px; width: 18px` | `.StoryPreviewItem__estimateImage` | measured ink 8 × 1 per bar |
| State button | `width: 47px`, `line-height: 22px` + 1px border top/bottom = **24px tall**; `font-size: 11px; font-weight: 600; border-radius: 3px`; `restart` `width: 66px` | `.state.button` | measured 21 × 45 — **CSS 24 × 47** |
| State button spacing | `margin: 0 0 0 4px` | `.preview .button.state` | measured gap 1 |
| Selection checkbox | `24px × 24px` hit area, `margin-left: 8px` | `.preview .selector`; `.StoryPreviewItem__selector` | measured ink 12 × 12 |
| Expanded-story right rail | `width: 288px` (`400px` in Projector) | `.info_box`, `.info_box_wrapper .state_box` | resolves "unmeasurable" |
| Expanded-story field label | `font-size: 11px; font-weight: 600; line-height: 16px; text-transform: uppercase; margin: 14px 0 8px` | `.model section.edit h4` | new |
| Story flyover | `width: 425px` | `.flyover.story_flyover` | new |
| Panel width (Auto / Fixed) | still **not in CSS** — only `min-width: 375px`; the Fixed slider writes an inline width | `.panel` | unchanged |

**The measured table is systematically ~13% small.** Five independent pairs give
the same ratio — sidebar 200/230 = 0.870, board offset 52/61 = 0.852, 1-line row
40–41/47 = 0.87, 2-line row 56/65 = 0.862, state-button height 21/24 = 0.875 —
which is what a 728-px-wide crop of an ~838-px-wide window produces (728/838 =
0.869). The §6 preamble's "derived scale = 1.0" is therefore wrong: the
`density_mode_story_display_options_1` capture is downscaled like the others, and
the 1px separator survived as one saturated pixel row because it sat on a
high-contrast boundary. **Use the CSS values, not the measured ones**, wherever
both exist; keep the measured table only for ink extents the CSS does not give
(glyph sizes, cap heights).

---

## 7. Unknowns

Resolved by the recovered application stylesheet (see `css-tokens.md`):

- ~~**Hover states**~~ — every one is in the CSS. Row `.story.feature .preview:hover`
  `#e6e6e6` (accepted `#c6d9b7`, unscheduled `#d1e0ed`, release `#306494`); panel-header
  icons `.panel .bright_icons:hover { opacity: 1 }`; state buttons one step darker per
  `.state.button.<action>:hover`; sidebar `aside.sidebar li.item:hover .panel_name
  { color: rgba(138,199,255,.5) }`; labels, checkbox and point buttons share a
  `rgba(74,74,74,.16)` wash.
- ~~**Drag states**~~ — `.ghost { opacity: .5 }`, `.multighost { background: black;
  color: white; padding: 4px }`, dragged row `.preview.dragging { background-color:
  #ff9 }`, drop line `.panel .item .preview.drop_hover:before { background-color: #666;
  height: 2px }` (`#333` over an iteration header, `black` over a list cap), epic drop
  overlay `.panel.epics .item.epic .preview.drop_hover.dragging_story:after`. No
  "cannot drop here" rule exists — refusal is not styled.
- ~~**Keyboard focus**~~ — one ring everywhere: `border: 2px solid #0046E0; outline:
  none` with `padding: 2px 6px 3px` compensation (`.panel:focus`, `.story.unstarted
  .preview:focus`, `.iteration .preview:focus`, `.epic .preview:focus`). The `Space`
  moving state is `.preview.keyboard-moving { margin: 4px 8px; opacity: .80 }`.
- ~~**Empty states**~~ — styled, and one string is in the CSS:
  `.panel .empty_message { color: #FFF; font-size: 14px }` over `#484F56` with a
  per-panel SVG (`.backlog` / `.icebox` / `.epics`); `.panel .empty_current_iteration_placeholder`
  `#D0CAC5` with a 66px header; `.panel.search .empty_list_message` `#EBE9E3`;
  `section.panels .table.no_panels_visible:before { content: 'There are no panels open' }`.
  The per-panel copy is still not recoverable (it is in the JS, not the CSS).
- ~~**Narrow / small-viewport behaviour**~~ — there are **no** project-view
  breakpoints. The only `@media` over the board chrome is `screen and (max-width:
  973px)`, which truncates the header's project name and profile dropdown. Panels keep
  `min-width: 375px` and `section.panels { overflow-x: auto }` scrolls horizontally.
- ~~Panel minimum width~~ — `.panel { min-width: 375px }`. The maximum and the
  Fixed-slider range are still unknown (written inline by JS).
- ~~Whether unestimated story titles render italic~~ — yes:
  `.story.feature.estimate_-1 .preview .name { font-style: italic }` (and `.priority`).
- ~~Transition/animation timings~~ — the project view has almost none. The only
  transitions in the recovered CSS are `section.edit .controls .bubble { transition:
  opacity 150ms ease-in-out }` and the activity timestamp's `transition: opacity 100ms`.
  Rows, panels and state buttons change instantly.

Still not settled by any article, screenshot or stylesheet in the corpus:

- The top header's own height, background and tab-strip typography — its base rules
  live in a stylesheet that was never archived. Only its offset is known
  (`section.main { top: 35px }`, `61px` with the tab strip).
- The per-panel empty-state copy (Icebox, Backlog, Current, Done, My Work, Blocked).
- Panel maximum width and the range of the Fixed-mode slider.
- How an estimate above 3 points renders in the collapsed row's bar-stack glyph
  (the CSS enumerates `.estimate_1/2/3` for linear, `1/2/3/5/8` for fibonacci,
  `1/2/4/8` for powers-of-2, and `-1` for none — nothing above those).
- The exact point-button set in the 2024 vintage (the older capture shows
  `0 1 2 3 4 +`; the project's point scale is configurable).
- Panel scroll behaviour at the boundaries: whether the panel header and iteration
  headers stick while the story list scrolls.

---

## 8. Sources

**Articles**: adding_stories, automatic_vs_manual_planning, backlog_to_current_flow,
blocked_stories, collaborating_with_comments, density_mode_story_display_options,
estimating_stories, keyboard_shortcuts, managing_the_icebox, mywork_panel,
organizing_releases, prioritizing_stories, prioritizing_stories_keyboard,
project_page_preferences, quick_start, saving_your_changes, story_owners,
story_states, tagging_stories_with_labels, terminology, tracker_workflow,
understanding_velocity, updating_accepted_stories, updating_multiple_stories_quickly,
using_story_panels, using_the_sidebar, work_with_a_single_story, working_with_stories,
working_with_tasks.

**Images** (`docs/reference/tracker/images/`, hash suffixes elided):
`adding_stories_2@1x`, `backlog_to_current_flow_1@1x`, `backlog_to_current_flow_2@1x`,
`backlog_to_current_flow_3@1x`, `blocked_stories_3@1x`,
`density_mode_story_display_options_1@1x` (primary, scale 1.0),
`density_mode_story_display_options_2@1x`, `density_mode_story_display_options_3@1x`,
`density_mode_story_display_options_5@1x`, `keyboard_shortcuts_1@1x`,
`managing_the_icebox_1@1x`, `organizing_releases_2@1x`, `story_states_1@1x`,
`tagging_stories_with_labels_2@1x`, `understanding_velocity_1@1x`,
`using_story_panels_1@1x`…`using_story_panels_6@1x`, `using_the_sidebar_1@1x`,
`using_the_sidebar_2@1x`, `work_with_a_single_story_2@1x`, `working_with_stories_1@1x`.

**Stylesheet** (recovered 2026-09-16, git-ignored):
`docs/reference/tracker/assets/assets.pivotaltracker.com/next/assets/next/89c0107749ba17e86dd4-next.css`
and its lazy chunk `1.89c0107749ba17e86dd4-next.css`, plus the 2024-10-09 pair
`eb3075d364e01fb6e5cc*`. Token sheet: `css-tokens.md`.

**Measurement tool**: `scripts/tracker-corpus/measure.py`
(`rows` / `cols` / `runs` / `glyph` / `size`; `--scale` converts image px to CSS px
once a ruler has been chosen).
