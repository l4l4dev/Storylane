# Reference note — CSS tokens (from the recovered Tracker application stylesheet)

Token sheet for the Tracker-parity rewrite, derived from the **real application
stylesheet** recovered from the Wayback Machine and stored (git-ignored) at
`docs/reference/tracker/assets/assets.pivotaltracker.com/next/assets/next/`:

| short name | file | role |
|---|---|---|
| `main` | `89c0107749ba17e86dd4-next.css` (511 KB) | application sheet, capture `20250303220533` |
| `lazy` | `1.89c0107749ba17e86dd4-next.css` (190 KB) | its lazy chunk (React/CSS-Modules components) |
| `main24` / `lazy24` | `eb3075d364e01fb6e5cc*-next.css` | capture `20241009004849` (see "Version note") |

Class names are CSS-Modules-hashed; the hash suffix is **stripped** in every
selector quoted below (`IterationMarker__points___2oAkK5Zn` → `IterationMarker__points`).
Only CSS values and selector names are quoted — no prose from Pivotal.

Where the `lazy` chunk restates a selector from `main` it wins (it loads later, and
several of its rules repeat the class three times to out-specify the main sheet).
Rows marked **[lazy]** are the effective value.

---

## 1. Type and fonts

Stack, written identically in ~40 rules (`.editor`, `input.std`, `.search_bar input`,
`.TaskEdit__description`, `.SmartList__noResults`, …):

```css
font-family: "Open Sans", open-sans, EmojiFontFace, helvetica, arial, sans-serif;
```

Document default (`body, input, textarea, keygen, select, button`):
`font-size: 10px; line-height: 1.2`, plus `body { -webkit-font-smoothing: subpixel-antialiased }`.
Every component sets its own size on top of that.

`@font-face` faces actually declared in `main` (self-hosted base64 WOFF, with
`local()` fallbacks first):

| family | style | weight |
|---|---|---|
| `open-sans` | normal | 300, 400, **600**, 700 |
| `open-sans` | italic | 400, 700 |
| `EmojiFontFace` | normal | 700 (WOFF2 + WOFF) |

600 is the semibold used for panel titles, state buttons and sidebar names; there
is no 500 and no 800.

**Icon font**: effectively none. `"Ionicons"` is declared in `lazy` (cdnjs ionicons
2.0.1) but only the bundled `image-gallery` attachment lightbox uses it
(`.image-gallery-left-nav::before`). Every project-view icon is a PNG/SVG background
image under `//assets.pivotaltracker.com/next/assets/next/`, with a
`@media (min-resolution: 144dpi)` sibling rule swapping in the 2× PNG.

---

## 2. Frame

| element | value | selector |
|---|---|---|
| page background (behind panels) | `#212121` | `html, body`; `section.main` |
| board area offset, header collapsed | `top: 35px` | `section.main` |
| board area offset, tab strip shown | `top: 61px` (2024) / `top: 80px` (2025) | `.layouts.expanded_header section.main` |
| board area, left of the sidebar | `left: 231px` | `section.workspace article.main` |
| bulk-actions bar | `height: 34px; background-color: #5A87CF` | `.selectedStoriesControls` |
| …with tab strip shown | `height: 60px` | `.expanded_header .selectedStoriesControls` |
| …selection counter chip | `background-color: #FB8D33; color: #FFFFFF; height: 21px; line-height: 21px; border-radius: 2px; padding: 0 4px` | `.selectedStoriesControls__counter` |
| …button hover | `background-color: #4977B9` | `.selectedStoriesControls__button:hover` |
| header search field | `background-color: rgba(255,255,255,.18); border-radius: 3px; height: 22px; border: 2px solid transparent` | `.search_bar` |
| …focused | `border-color: #fff` | `.search_bar_container.next.menu.focused .search_bar` |
| …text / placeholder | `color: #ECF0F4` / `#AFC5D2` | `.search_bar input`, `.search_bar input.placeholder` |
| notification bell | `height: 24px; width: 44px; padding: 0 7px`, icon `opacity: .25` → `.35` on hover | `.tc_page_header .notifications .bell` |
| unread badge | `background-color: #b20000; font-size: 9px; line-height: 13px; border-radius: 2px` | `.notifications .counter.unread` |

The top header's own height, background and tab-strip typography are **not** in
the recovered sheets (that chrome's base rules live in a stylesheet that was never
archived). Only its offset (35/61px) and the widgets above are recoverable.

---

## 3. Sidebar

| element | value | selector |
|---|---|---|
| surface | `background-color: #2F3337; border-right: 1px solid #000; height: 100%` (flex column) | `.Sidebar` **[lazy]** |
| width, expanded | `width: 230px` | `.Sidebar--expanded` **[lazy]** |
| width, collapsed | `width: 46px; overflow: hidden` | `.Sidebar--collapsed` **[lazy]**; also `aside.sidebar.collapsed .fixed { width: 46px }` |
| outer shadow | `box-shadow: 5px 0 10px 0 rgba(0,0,0,.15)` | `aside.sidebar` |
| panel-toggle list | `flex: 1 1 auto; overflow-y: auto` | `.Sidebar__panels` **[lazy]** |
| row (panel toggle) | `background-color: #303437`, `display: flex` | `aside.sidebar li.item` |
| row box | `box-sizing: border-box; padding: 9px 0 8px 15px; height: 28px` | `aside.sidebar .panel_toggle .panel_name` |
| row label (indented form) | `padding: 8px 8px 8px 0; text-indent: 32px` | `aside.sidebar .panel_toggle .panel_name` (later rule) |
| row font | `font-size: 12px`, `text-align: left`, transparent background | `aside.sidebar .panel_toggle` |
| row, **hover** | `color: rgba(138, 199, 255, .5)` | `aside.sidebar li.item:hover .panel_name` |
| row, **active/visible** | `color: #8AC7FF` | `aside.sidebar li.item.visible .panel_name` |
| sidebar link rows (My Work etc.) | `min-height: 32px; font-size: 12px; font-weight: normal; line-height: 1.3; padding-left: 38px` | `aside.sidebar .item.sidebar_link .sidebar_link` |
| …text / hover | `color: #CCC` → `rgba(138,199,255,.5)`; icon `opacity: .8` → `.5` | `…sidebar_link span`, `…:hover span`, `…:before` |
| project name | `color: #eee; font-weight: 600; text-transform: uppercase; white-space: nowrap` | `aside.sidebar .name` |
| project header strip | `background-color: #222529` | `aside.sidebar .project header` |
| details/stats strip | `background: #212123; border-top: 1px solid #000; padding: 10px 10px 10px 13px; font-size: 13px; font-weight: 400; height: 32px` | `aside.sidebar .details` |
| velocity / member counts | `font-size: 10px; color: #bbb; line-height: 14px; float: right` | `aside.sidebar .velocity, .count, .projects .readonly` |
| …count, expanded | `font-size: 12px; font-weight: 600; line-height: 34px; padding: 0 10px 0 12px` | `aside.sidebar .count` |
| …velocity, **hover** | `color: #ccc`; overridden velocity `#ffff99` → `#ffffee` | `aside.sidebar .velocity:hover`, `.velocity.overridden(:hover)` |
| settings strip | `background: #1f2021`; anchor `height: 34px; width: 36px; border-left: 1px solid #2f3337` | `aside.sidebar .settings_area(.anchor)` |
| collapse toggle strip | `background-color: #2C2D2F; border-top: 1px solid #393A3C; border-bottom: 1px solid #000` | `.Sidebar__toggleContainer` **[lazy]** |
| collapsed: hide labels | `visibility: hidden` on `.panel_name`; `display: none` on `a.sidebar_link span`, `form.search input`, `.projects .name .full` | `aside.sidebar.collapsed …` |

There is no "+ Add Story" rule in the recovered sheets under a sidebar selector;
the per-panel add control is `.panel .workspace_header .add_model { height: 28px }`
(shown only on `.panel.epics` / `.panel.epic_stories`, hidden by
`.panel.read_only .controls .add_model { display: none }`).

---

## 4. Panels

| element | value | selector |
|---|---|---|
| panel box | `position: relative; height: calc(100% - 1px); min-width: 375px; float: left; overflow: hidden; margin-right: 8px; display: none` | `.panel` |
| shown | `display: block` | `.panel.visible` |
| board strip | `overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; height: 100%; width: 100%` | `section.panels` |
| board padding | `padding: 12px 4px 12px 12px` | `section.panels .table` |
| panel header | `border-top: 2px solid; border-bottom: none; height: auto` (the 2px top border carries the per-panel colour) | `.panel .workspace_header` |
| panel header title | `padding-top: 7px; line-height: 14px; color: #aaa; text-overflow: ellipsis` + `font-weight: 600; text-transform: uppercase` on the inner span | `.panel .workspace_header h3(span)` |
| panel header controls | `height: 28px` | `.panel .workspace_header .controls, .close, .add_model, .refresh, .mark_all_read` |
| header icon buttons | `height: 24px; width: 26px`, icon `opacity: .4` → `1` on hover | `.panel .panel_settings`/`.split`/`.save_search`/`.pin_search`; `.bright_icons(:hover)` |
| labels panel | `width/min-width/max-width: 220px` (later relaxed to `auto`), content `#F3F3F3`, header `#1f3b18` | `.panel.labels…` |
| panel focus ring | `border: 2px solid #0046E0; outline: none; padding: 2px 6px 3px` | `.panel:focus` |
| results bar | `color: #fff; padding: 0 10px; font-size: 10px; line-height: 21px`; stories `#215900`, epics `#5b2d89` | `.results_bar(.stories/.epics)` |
| icebox / backlog markers | `background-color: #555; color: #fff; font-weight: bold; font-size: 10px; height: 21px; line-height: 21px; text-align: center; border-bottom: 1px solid #444` | `.panel .icebox_stories_marker.item`, `.backlog_stories_marker.item` |
| end-of-list cap | `height: 40px; background-color: #484F57; border-bottom-{left,right}-radius: 4px` | `.panel .end_of_list.item .preview` |
| empty current iteration | `background-color: #D0CAC5`; header `height: 66px`; message `width: 195px; padding-top: 26px; font-size: 11px`, `.message { font-weight: bold; margin-bottom: 16px }`, link `color: #1F5F88; text-decoration: underline; font-weight: 600` | `.panel .empty_current_iteration_placeholder.item …` |
| empty panel | `color: #FFF; font-size: 14px`, text column `width: 256px`, background art + `background-color: #484F56`, `padding-top: 152px` (backlog) / `176px` (icebox, epics) | `.panel .empty_message(.backlog/.icebox/.epics)` |
| empty search | `background-color: #EBE9E3; color: #777; font-weight: bold; font-size: 10px; line-height: 21px; text-align: center` | `.panel.search .empty_list_message` |

**There are no width breakpoints.** The only `@media` touching project chrome is
`screen and (max-width: 973px)`, which truncates the header's project name and
profile dropdown; every other `@media` is a `min-resolution: 144dpi` 2×-asset swap
or belongs to the attachment-gallery / cropper widgets. Narrow windows are handled
by `min-width: 375px` per panel plus horizontal scrolling of `section.panels`.

---

## 5. Iteration header / marker

| element | value | selector |
|---|---|---|
| bar | `background: #676E7A; border-top: 1px solid #787F8C; border-bottom: 1px solid #535965; color: #eee; height: 20px; line-height: 20px; padding: 1px 2px` | `.iteration .preview` (later rule; the earlier one uses a `#b5babf → #7b8590` gradient, `height/line-height: 19px`, `color: #fff`, `font-size: 11px`) |
| font size | `font-size: 11px` | `.iteration .preview` (first rule; not restated) |
| focus | `border: 2px solid #0046E0; outline: none; padding: 0` | `.iteration .preview:focus` |
| expander / current bubble | `13px × 13px`, `float: left`, `margin-top: 3px` | `.iteration .preview a.expander`, `a.current_iteration_bubble` |
| number separator | `border-left: 1px solid #7a848f; border-right: 1px solid #b0b6bb; width: 1px; height: 100%` | `.iteration .preview .number:after` |
| points | `float: right; margin-left: 5px` | `.iteration .preview .points`; `margin: 0 4px; flex: 1 1 auto` in `.IterationMarker__points` **[lazy]** |
| length, editable | `cursor: pointer`, `text-decoration: underline` on hover; custom length `color: #fc4` | `.IterationMarker__length(:hover)`, `.IterationMarker__customLength` **[lazy]** |
| team strength | `color: #FFF; margin: 0 4px`; underline hover `height: 15px; border-bottom: 1px solid white`; icon `16px × 15px` | `.IterationMarker__teamStrength`, `.iteration .team_strength_underline:hover`, `.team_strength_icon` |
| manual-planning toggle | `width: 18px; height: 12px; float: right; margin: 0 4px`, hover `background-color: #FFFFFF` | `.IterationMarker__manualPlanning(:hover)` **[lazy]** |
| deadline row | `background-color: #000; color: #fff; font-weight: bold; font-size: 10px; line-height: 13px; padding: 2px 0; text-align: center` | `.deadline .preview` |

---

## 6. Collapsed story row

### 6.1 Box

| element | value | selector |
|---|---|---|
| row base | `cursor: default; font-size: 12px; line-height: 24px` | `.preview` |
| row layout | `position: relative; display: flex` | `.story .preview` |
| padding | `padding: 4px 8px` **[lazy]** (overrides `padding-top/bottom: 1px` from `main`) | `.StoryPreviewItem__preview` ×3 |
| release row padding | `padding: 4px 8px 4px 0px` **[lazy]** | `.StoryPreviewItem__preview__release` ×3 |
| blocked row | `min-height: 51px` | `.story.has_blockers_or_blocking header` |
| title column | `display: flex; flex-direction: column; justify-content: space-between; min-height: inherit; flex: 1 1 auto; overflow: hidden` | `.story .preview .name` |
| title | `margin: 4px 0 2px 0; line-height: 18px; letter-spacing: 0.1px` **[lazy]** | `.StoryPreviewItem__storyName` |
| title, unestimated | `font-style: italic` | `.story.feature.estimate_-1 .preview .name` — confirms the italic observed in `managing_the_icebox_1` |
| label line (Normal / Projector) | `line-height: 14px` | `.layouts.normal .story .preview .post.labels` |
| meta column | `display: flex; flex-direction: column; height: 100%; flex-shrink: 0; margin-right: 8px` | `.StoryPreviewItem__meta` **[lazy]** |
| meta top row | `height: 20px; margin-bottom: 5px; width: 100%` | `.StoryPreviewItem__meta__top` **[lazy]** |
| custom point scale offset | `margin-left: 44px` | `.point_scale_custom .story .preview .name` |

Derived minimum row height (Normal density, 1-line title + 1 label line):
`4 + 4` padding `+ 1` bottom border `+ (4 + 18 + 2)` title `+ 14` label line = **47px**.
Without labels it is 33px; with a 2-line title and labels, 65px.

### 6.2 Per-type / per-state backgrounds (all with **hover**)

| state / type | background | border-bottom | hover background | selector |
|---|---|---|---|---|
| feature / bug / chore | `#f4f4f4` | `1px solid #DDD` | `#e6e6e6` | `.story.feature .preview` (grouped) |
| unscheduled (icebox) | `#e4eff7` | — | `#d1e0ed` | `.story.unscheduled .preview(:hover)` |
| rejected | `#f3f3d1` | `1px solid #DDD` | — | `.story.rejected .preview` |
| accepted | `#daebcf` | `1px solid #c3d5b4` | `#c6d9b7` | `.story.accepted .preview(:hover)` — also `cursor: default` |
| release | `#407AA5` | `1px solid #306494` | `#306494` | `.story.release .preview(:hover)` |
| release, late / past deadline | `#923131` / `#923030` | `1px solid #7C2324` | `#7C2323` / `#7C2222` | `.story.release.late .preview(:hover)`, `.is_release_past_deadline` |
| release text | name `color: #fff`, owner `color: #fff; text-transform: uppercase`, label `color: #EEDA7D; font-weight: normal` | | | `.story.release .preview .name/.owner`, `.release .preview .label.std` |
| any row, **focus** | `border: 2px solid #0046E0; outline: none; padding: 2px 6px 3px` | | | `.story.unstarted .preview:focus` and siblings |

Owner initials in the collapsed row are text, not an avatar:
`color: #0957a4; text-transform: uppercase` (`.story.feature .preview .owner`), with
`.preview .owner + .owner:before { content: ',\a0' }` between multiples.

### 6.3 Type icon, estimate, chips, controls

| element | value | selector |
|---|---|---|
| type icon box | `height: 18px; width: 18px; margin-right: 2px; background-repeat: no-repeat` | `.StoryPreviewItem__storyType` **[lazy]** |
| type icon art | feature `16px 16px`, bug `18px 15px`, chore `18px 14px`, release `18px 15px` (`…_external.png` variants when `linked_to_integration`, animated `spinner_<state>.gif` when `.pending`) | `.story.feature .StoryPreviewItem__storyType` etc. |
| estimate glyph | `height: 15px; width: 18px; background-size: auto` — one SVG/PNG per `.estimate_N` per `.point_scale_*` | `.StoryPreviewItem__estimateImage` **[lazy]** |
| estimate text (custom scale only) | `color: #999; font-weight: bold; font-size: 11px; width: 18px; text-align: center` (hidden for linear/fibonacci/powers_of_2) | `.StoryPreviewItem__estimateText` **[lazy]** |
| point buttons (unestimated row) | `color: #3F79A5; background-color: transparent; border: none; font-weight: 700; font-size: 12px; line-height: 1; min-width: 16px; height: 24px; margin: 0 2px; padding: 0` | `.preview .estimate .estimate__item` |
| …non-custom scales | `width: 16px; color: transparent; overflow: hidden; border-radius: 0` (icon-only) | `.point_scale_linear .preview .estimate .estimate__item` etc. |
| …hover | `color: #244B83`; **[lazy]** `background: rgba(74,74,74,.16); border-radius: 2px` | `.estimate__item:hover`, `.StoryPreviewItemButtons__estimateButton:hover` |
| …overflow "more" | `color: #999` | `.preview .estimate .estimate__item.more` |
| estimate container | `height: 24px; flex: 0 0 auto; cursor: default`, `margin: 0 0 0 4px` | `.preview .estimate` |
| label chip | `font-size: 10px; font-weight: bold; color: #063; text-decoration: none; word-wrap: break-word` | `.label.std` |
| label chip, epic | `color: #452481` | `.label.epic` |
| label chip, **hover** | `background: rgba(74,74,74,.16); border-radius: 2px` | `.story .preview .name .label:hover` |
| pill form (flyover) | `background-color: #588A00; border-radius: 20px; color: #fff; font-size: 11px; padding: 2px 8px`; epic `#7148B2` | `.label.pill(.epic)` |
| selection checkbox | `width: 24px; height: 24px; flex: 0 0 auto; cursor: pointer`, `margin-left: 8px`, hover `background: rgba(74,74,74,.16); border-radius: 2px` | `.preview .selector(:hover)`, `.StoryPreviewItem__selector(:hover)` **[lazy]** |
| expand ("reveal") button | `width: 24px; height: 24px; background-color: #9BA2A8; border: 1px solid #889096; border-radius: 3px; box-sizing: border-box`, icon `14px × 14px` at `margin: 4px 0 0 4px` | `.preview .reveal.button(.locator)` |
| …hover | `background-color: #878E95; cursor: pointer` | `.preview .reveal.button:hover` |
| priority chip | `color: #0957A4; border: 1px solid #0957A4; border-radius: 8px; width: 24px; height: 16px; background-color: #FFF; font-size: 11px; font-weight: bold` | `.StoryPreviewItem__priorityIcon` **[lazy]** |
| control spacing | `margin: 0 0 0 4px` on `.button.state`, `.estimate`, `.reveal.button`; `.reveal.reveal-panel.button { margin-right: 3px }` | `.preview .button.state, .preview .estimate, .preview .reveal.button` |
| blocked icon | `content: url(…b91829c0-blocked-icon.svg); margin: 1px 11px 0 3px` (resolved variant `77c9d36d-blocked-icon-resolved.svg`), art `18px × 10px` | `.flyover … .blocker:before`, `.item.notification .type.story.blocker` |
| blocked icon, row focused | shifts to `top: 29px` | `.story.feature .preview:focus .blocker` (grouped with `.blocking_preview`, `.combo_blocker`) |

### 6.4 State buttons

Base (`.state.button, a.state.button`):
`border: 1px solid #fff; color: #111; font-size: 11px; font-weight: bold; line-height: 19px;
text-align: center; text-decoration: none; padding-top: 1px; width: 47px; border-radius: 3px`

Overridden later in the same sheet by
`.state.button { padding-top: 0; line-height: 22px; font-weight: 600; display: inline-flex; justify-content: center }`
and `.state.button:after { border: none }` (the earlier rule drew a 1px inner
highlight ring via `:after`). Effective box: **47 × 24** (22px line box + 1px
border top and bottom); `restart` is `width: 66px`.

| button | background | border | text | hover background | hover border |
|---|---|---|---|---|---|
| start | `#e0e2e5` | `#c8cbd0` | `#111` | `#c8cbd0` | `#acb6c1` |
| restart | `#e0e2e5` | `#c8cbd0` | `#111` | `#c8cbd0` | `#acb6c1` |
| finish | `#203e64` | `#172c51` | `#eee` | `#172c51` | `#111e40` |
| deliver | `#f39300` | `#f08000` | `#eee` | `#f08000` | `#ec6b00` |
| accept | `#629200` | `#4e8200` | `#eee` | `#4e8200` | `#3c7100` |
| reject | `#A71f39` | `#950828` | `#eee` | `#950828` | `#82001b` |

`restart` additionally draws a red dot before the label:
`.state.button.restart:before { background-color: #AA1224; border-radius: 4px; width: 8px; height: 8px; margin: 7px 4px 0 1px }`.
Read-only rows dim to `opacity: 0.6` (`.item.read_only .state.button`) but keep
the accept/reject hover colours from the **earlier** palette (`#629200`/`#A71f39`).

### 6.5 Density modes

`Aa` maps to a class on the layout root — `.layouts.normal`, `.layouts.dense`,
`.layouts.projector`. There is no `.compact`.

| mode | rule |
|---|---|
| Normal | labels below the title: `.layouts.normal .story .preview .pre.labels { display: none }`, `.post.labels { line-height: 14px }` |
| Dense | labels inline: `.layouts.dense .story .preview .pre.labels { display: inline; margin-right: 2px }`, `.post.labels { display: none }` |
| Projector | `.layouts.projector .story .preview .story_name, .parens, .owner { font-size: 20px; line-height: 1.4 }`; labels `font-size: 13px`; meta `position: relative; left: 5px`; expanded story `.tracker_markup { font-size: 22px; line-height: 1.5 }`, field labels `16px`, right rail `width: 400px` |

---

## 7. Epic row

| element | value | selector |
|---|---|---|
| row | `display: flex; justify-content: space-between; background-color: #EBE9E3; border-bottom: 1px solid #C2C0B9` | `.epic .preview` **[lazy]** |
| hover / focus | `background-color: #DAD9CE` / `border: 2px solid #0046E0` | `.epic .preview:hover/:focus` **[lazy]** |
| name | `padding: 3px 8px` | `.epic .preview .name` **[lazy]** |
| progress bar | `height: 8px; min-width: 100px; margin-left: 8px; padding: 0 40px 5px 0`; segments accepted `#7CA43A`, active `#F8F5A3`, unstarted `#999999`, unscheduled `#90AECB` | `.epic .preview .progress(> span)(.accepted…)` **[lazy]** |
| chevron | `width: 25px; background-color: #E0DDD6`, hover `#BCBBAA`, glyph `6px × 12px` | `.epic .preview .chevron(:hover)(:before)` **[lazy]** |

---

## 8. Expanded story

| element | value | selector |
|---|---|---|
| panel surface | `background: #F1F0EA; box-shadow: inset #888 0 0 3px; padding-left: 10px; outline: 0` | `.model section.edit` |
| field label | `color: #000; font-size: 11px; font-weight: 600; line-height: 16px; text-transform: uppercase; margin: 14px 0 8px` | `.model section.edit h4` |
| title field | `flex-grow: 1; padding-right: 8px; word-wrap: break-word`; textarea `min-height: 23px`, placeholder `color: #757575` | `.model section.edit fieldset.name(textarea.editor)` |
| text editor | `font-size: 12px; line-height: 18px; padding: 2px 4px 1px 4px; width: 100%; overflow-x: hidden` | `.editor`, `input.std` (`background-color: #fff; border: 1px solid #CCC`) |
| description preview | `min-height: 19px; padding: 7px` | `.DescriptionEdit__preview` **[lazy]** |
| description controls | `display: flex; justify-content: space-between; flex-direction: row-reverse; padding-top: 25px` | `.DescriptionEdit .controls` **[lazy]** |
| body markup | `word-wrap: break-word; overflow-wrap: break-word; word-break: break-word; overflow: hidden`; `h4 { font-size: 1.15em }` | `.tracker_markup` |
| right rail (info + state boxes) | `width: 288px; background-color: #f6f6f6; border: 1px solid #ccc; border-radius: 3px`; info box `margin-right: 8px`, state box `margin-bottom: 8px` | `.info_box`, `.info_box_wrapper .state_box` |
| …owner avatar | `width: 24px; height: 24px; border-radius: 16px; background-color: #A1A4AD; color: #FFFFFF; font-size: 10px; line-height: 24px; margin: 2px 0 0 6px` | `.info_box .row .initials` |
| task row | `background-color: #E9E8E0; border-radius: 3px; font-size: 12px; line-height: 18px; margin-top: 4px; display: flex`, hover `#E3E2D8`, complete `#B9D089` | `.TaskShow(:hover)(.complete)` **[lazy]** |
| task checkbox | `align-self: start; margin: 8px 4px; flex-shrink: 0` | `.TaskShow__checkbox` **[lazy]** |
| task actions | `opacity: 0` until `.TaskShow:hover .TaskShow__actions`; icons `background-size: 11px 11px` | `.TaskShow__actions--unfocused`, `--edit:hover`, `--delete` **[lazy]** |
| task edit row | `background-color: #E9E8E0; border-radius: 3px; padding: 4px; font-size: 12px`; field `border: 1px solid #adb0b7; border-radius: 3px`; textarea `font-size: 12px; line-height: 18px; padding: 4px` | `.TaskEdit(__descriptionContainer)(__description)` **[lazy]** |
| task submit | `background-color: #3676c0; width: 50px; height: 32px; font-size: 12px`, hover `#305D93` | `.TaskEdit__submit(:hover)` **[lazy]** |
| "add …" affordance | `background: #E9E8E0; border-radius: 4px; color: #717170; font-size: 12px; margin-top: 4px; width: 100%`, hover `#E3E2D8`; label `line-height: 18px; padding: 10px 8px`; icon `14px × 14px; margin-left: 8px` | `.AddSubresourceButton(:hover)(__message)(__icon)` **[lazy]** |
| blocker card | `background-color: #E9E8E0; border: 1px solid transparent; border-radius: 3px; display: flex; align-items: flex-start` | `.BlockerShow` **[lazy]** |
| comment box | `min-height: 43px; overflow: auto; width: 100%` (preview), focused variant `.CommentEdit__commentBox--focused`; disabled tab hover `background-color: #E9E8E0; border-radius: 3px` | `.CommentEdit__preview`, `.CommentEdit__tab--disabled:hover` **[lazy]** |
| activity list | `line-height: 21px`; entry `line-height: 20px`; author name `font-size: 12px; font-weight: bold; color: #222`; username/meta `color: #898781`; timestamp `font-size: 10px; color: #777` (fades to `opacity: 0` on `.has_controls:hover`) | `.model section.activity …` |
| activity avatar | `38px × 38px` block form / `24px × 24px` inline form (`font-size: 8px; line-height: 24px`), `background-color: #E9E7DD; border: 1px solid #acaaa1; border-radius: 3px` | `.model section.activity .activity header .author (span).initials` |
| cancel link | `color: #666; font-weight: 600`, hover `background-color: #E3E2D8`; `height: 23px; line-height: 23px; width: 51px` | `.details.edit .cancel(:hover)`, `.controls .cancel` |
| simple-edit control group | `border-radius: 4px; background-color: #dfdcd0; padding: 1px 0 1px 7px` | `.details.edit .show_simple_edit .controls` |
| single-story (maximized) view | `min-width: 968px`; title `line-height: 33px`; body `top: 34px` | `section.maximized(…)` |
| flyover surface | `background-color: #f4f5f7; position: absolute; z-index: 99`; story flyover `width: 425px; border: 1px solid #323232; border-radius: 4px; box-shadow: rgba(0,0,0,.4) 2px 2px 7px; font-size: 12px` | `.flyover`, `.flyover.story_flyover` |
| flyover state text | unscheduled/unstarted `#444`/`#333`, finished `#254265`, delivered `#E07B00`, rejected `#BB0707`, accepted `#5A840B`; `font-size: 11px; font-weight: bold; padding-left: 10px` | `.flyover.story_flyover .<state> .state` |

---

## 9. Drag, drop and keyboard move

| element | value | selector |
|---|---|---|
| dragged element ghost | `opacity: 0.5; z-index: 4; pointer-events: none` | `.ghost` |
| multi-story drag ghost | `background: black; color: white; padding: 4px` | `.multighost` |
| dragged row | `background-color: #ff9` (release rows: `border-top-color/border-bottom-color: #ff9`) | `.panel .item .preview.dragging`, `.panel .item section.edit.dragging`, `.panel .release .preview.dragging` |
| drop indicator | `background-color: #666; height: 2px; top: -1px; left: 0; right: 0; z-index: 1` (a `:before` line) | `.panel .item .preview.drop_hover:before` |
| …over an iteration header | `background-color: #333` | `.panel .item.iteration .preview.drop_hover:before` |
| …over a list cap | `background-color: black` | `.panel .icebox_stories_marker.item .preview.drop_hover:before`, `.end_of_list…` |
| …onto an epic | `border: 2px solid #888; background-color: #bbb; opacity: 0.5` overlay; the 2px line is suppressed | `.panel.epics .item.epic .preview.drop_hover.dragging_story:after/:before` |
| …empty current iteration | `background-color: #C4BEBA` | `.empty_current_iteration_placeholder .drop_hover` |
| draggable cursor | `cursor: move` | `.panel.items_draggable .model.draggable .preview` |
| keyboard "moving" row | `margin: 4px 8px; opacity: 0.80` | `.preview.keyboard-moving` |
| panel drag | panel itself `visibility: hidden`, placeholder `border: 4px dashed #49515A` | `section.panels .panel.dragging(:before)` |
| panel drag ghost | `position: absolute; opacity: 0.92`, scrollbars hidden | `.panel_ghost` |

Focus is uniform and explicit across the board: every focusable surface uses
`border: 2px solid #0046E0; outline: none` with a padding compensation of
`2px 6px 3px` — `.panel:focus`, `.story.unstarted .preview:focus`,
`.story.release .preview:focus`, `.iteration .preview:focus` (padding `0`),
`.epic .preview:focus`, `.item.integration_story .preview:focus`.

---

## 10. Colour palette

| hex | where |
|---|---|
| `#212121` | page/board background (`html, body`, `section.main`) |
| `#2F3337` / `#303437` / `#2C2D2F` | sidebar surface / sidebar row / sidebar toggle strip |
| `#222529` / `#212123` / `#1f2021` | sidebar project header / details strip / settings strip |
| `#8AC7FF`, `rgba(138,199,255,.5)` | sidebar active panel / sidebar hover |
| `#484F56`, `#484F57` | empty-panel background, end-of-list cap |
| `#49515A` | panel drag placeholder dashes |
| `#f4f4f4` / `#e6e6e6` | story row (feature/bug/chore) / its hover |
| `#DDD` | story row separator |
| `#e4eff7` / `#d1e0ed` | unscheduled (icebox) row / hover |
| `#f3f3d1` | rejected row |
| `#daebcf` / `#c6d9b7` / `#c3d5b4` | accepted row / hover / separator |
| `#407AA5` / `#306494` | release row / hover + separator |
| `#923131`, `#923030` / `#7C2324` | late or past-deadline release / its separator |
| `#EEDA7D` | label text on a release row |
| `#676E7A`, `#787F8C`, `#535965` | iteration bar, its top and bottom borders |
| `#555` / `#444` | icebox & backlog markers / their separators |
| `#EBE9E3` / `#DAD9CE` / `#C2C0B9` | epic row / hover / separator; also empty-search bg |
| `#E0DDD6` / `#BCBBAA` | epic chevron / hover |
| `#7CA43A`, `#F8F5A3`, `#999999`, `#90AECB` | epic progress: accepted, active, unstarted, unscheduled |
| `#e0e2e5` / `#c8cbd0` / `#acb6c1` | start & restart button, its border, its hover border |
| `#203e64` / `#172c51` / `#111e40` | finish button and hover |
| `#f39300` / `#f08000` / `#ec6b00` | deliver button and hover |
| `#629200` / `#4e8200` / `#3c7100` | accept button and hover |
| `#A71f39` / `#950828` / `#82001b` | reject button and hover |
| `#AA1224` | restart button's dot |
| `#0957a4` | owner initials, links, priority chip |
| `#3F79A5` / `#244B83` | unestimated point buttons / their hover |
| `#0046E0` | focus ring, everywhere |
| `#063` / `#452481` | label text / epic label text |
| `#588A00` / `#7148B2` | label pill / epic label pill |
| `rgba(74,74,74,.16)` | hover wash on labels, checkbox and point buttons |
| `#F1F0EA` | expanded-story surface |
| `#E9E8E0` / `#E3E2D8` | task, blocker and "add …" cards / their hover |
| `#B9D089` | completed task row |
| `#f6f6f6` / `#ccc` | expanded-story right rail / its border |
| `#3676c0` / `#305D93` | primary submit button / hover |
| `#5A87CF`, `#4C76B8`, `#4977B9`, `#FB8D33` | bulk-actions bar, status block, button hover, counter |
| `#215900` / `#5b2d89` | search results bar (stories / epics) |
| `#f4f5f7` / `#323232` | flyover surface / border |
| `#D0CAC5` / `#C4BEBA` | empty current iteration / its drop hover |
| `#ff9` | dragged row |

---

## Version note — 2024-10-09 vs 2025-03-03

The two captures are all but identical: parsing both sheet pairs into rules and
diffing gives **three** differences, all in the main sheet.

1. `.layouts.expanded_header section.main { top: 61px }` (2024) → `top: 80px` (2025).
2. Added in 2025: `header.end-of-life { height: 20px; background-color: #FFE269 }`.
3. Added in 2025: `header.end-of-life h2.eol-msg { text-align: center; color: black; font-size: medium; }`.

(2) and (3) are the service-shutdown banner, and (1) is the board pushed down to
make room for it. **For project-view geometry the 2024-10-09 value (`top: 61px`) is
the one to clone**; nothing else — no panel, row, button, colour or font rule —
changed. The lazy chunks differ in 0 rules.

---

## Sources

- `docs/reference/tracker/assets/assets.pivotaltracker.com/next/assets/next/*-next.css` (git-ignored corpus)
- `docs/reference/tracker/assets/README.md` §"Extracted CSS (2026-09-16)"; `extracted/COVERAGE.md`
