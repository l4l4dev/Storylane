# Tracker-parity rewrite — design

Status: approved by the owner in the 2026-09-16 concept session (sections 1–2
approved section by section; sections 3–5 delegated to the orchestrator under
the approved approach). Reviewed by fable-advisor the same day
(approve-with-corrections; all corrections are folded in below). Supersedes Backlog doc-8 (2026-07-18 concept redesign)
and every spec/ decision derived from it. Complements, and does not replace,
`docs/design/2026-09-05-self-host-rewrite-design.md` (the server/deploy
foundation), whose phases 2–3 are replaced by the steps in §3.

## 1. Goal and non-goals

Storylane becomes a faithful re-creation of Pivotal Tracker as it was in its
final (2024) form: the same information architecture, the same panels, the
same story workflow, the same density and spacing, the same text sizes. The
owner's words: "UI や文字のつまり具合とかまで全部同じ形に" — everything except
the colour palette must read as the same product.

Non-goals:

- Matching Tracker's colours. Colour may differ; the default palette will
  start from Tracker's anyway and can be re-skinned later.
- Tracker's *Account* layer (billing container, plans, account settings). A
  self-hosted instance is one account. Projects live directly under the
  instance. Deliberate model-level divergence, recorded in
  `spec/glossary.md` when the spec is rewritten.
- Public (anonymous-readable) projects. Tracker had them; they collide with
  the foundation's fail-closed invariant (anonymous → 401, non-member →
  404). A self-hosted instance is private by construction. Deliberate
  divergence, recorded with the Account one.
- iOS. Stays deferred (Backlog doc-22).
- Any feature Tracker did not have. The old spec's inventions (category
  states, person-day velocity, Kanban view, Storylane-designed My Work, three
  dark palettes) are deleted, not carried.

The product name stays Storylane. "Pivotal Tracker" never appears in product
UI (public repository, third-party trademark). It does appear in specs and
reference notes, where it is the thing being described.

## 2. What is kept, what is discarded

The 2026-09-05 rewrite split cleanly into a foundation that is unrelated to
Tracker and a domain that is not.

Kept as-is (owner agreed 2026-09-16):

- Docker image, compose, CI, `/healthz`, graceful shutdown, config loading
- Authentication: setup page, email + password login, invite links, admin
  reset links, CSRF, rate limiting, `Secure`/`STORYLANE_TRUST_PROXY`
- `withProject()` / `ProjectTx` / `loadInProject()` and the route-manifest
  matrix test. The permission *fixture content* is rewritten to Tracker's
  Owner / Member / Viewer roles; the mechanism is unchanged.
- Migration runner (forward-only, pre-migration backup) and the SSE bus
  (project-scoped invalidation). Step 1 adds `projects.version` (Tracker has
  it too), bumped by every activity write and carried on the SSE event, so
  clients can later fetch `activity?since_version=` instead of refetching
  the whole project. A per-user channel (My Work, dashboard) comes with
  steps 7–8.
- Activity log *mechanism* only: `recordActivity` as the single writer,
  inside the same transaction. The action enum and payload are redesigned
  in step 1 to Tracker's activity shape (`kind`, `highlight`, `changes[]`
  with `original_values` / `new_values`, `primary_resources`), because the
  current `state.*` / `story.moved` vocabulary and free-form payload cannot
  render Tracker's story activity or Project History. Display names are
  never snapshotted into the payload.
- Tables: users, sessions, project memberships (roles already Owner /
  Member / Viewer). `projects` is kept **and extended** in step 1: four
  point scales (the current enum and its guard trigger allow three),
  iteration length, week start day, start date, time zone, velocity
  strategy, initial velocity, automatic planning, bugs/chores estimatable,
  `version`.
- `packages/core` as the home of Tracker's pure logic (velocity average,
  automatic-planning cut, search query parser) with new golden fixtures
  under `spec/fixtures/`. Its current contents are discarded (below).

Discarded:

- `project_states` and everything that reads `category`; the story/board
  schema, services, routes and tests built on it
- The `reorder` helper's role for stories. It renumbers a whole scope from a
  full id array the client sends, which breaks on Tracker's single
  priority list of hundreds of stories (Current is the head of the same list
  Backlog continues) and races under concurrent drags. Story ordering is
  redesigned in step 1 (§3.2); `reorder` stays only for small lists (tasks,
  labels, epic order, review types).
- `packages/core` contents: `capacity.ts`, `container-rollup.ts`,
  `story-state.ts`, `story-types.ts`, `velocity.ts` and the fixtures
  `spec/fixtures/{capacity,container-rollup,state-templates}.json` — all
  doc-8 domain (person-day capacity, container roll-up, category gate).
- All of `apps/web/src` (the phase-1 board UI)
- `spec/` content derived from doc-8: features, screens, velocity, the
  design-language half of ux-principles, and the data-model sections for
  states/stories. `spec/permissions.md`, `spec/local-dev.md`, `spec/mcp.md`,
  `spec/integrations.md` are revised, not discarded.
- Backlog doc-8, doc-12, doc-14, doc-15, doc-18, doc-27 as sources of truth
  (archived, see §4)

## 3. Method: corpus first, then screen by screen

### 3.1 Reference corpus (Step 0)

Tracker's help site is archived on the Wayback Machine (article pages serve
with `@2x` screenshots). The corpus lives at `docs/reference/tracker/` and is
**git-ignored** — it is Pivotal's copyrighted material and this repository is
public. What is committed is the fetch script (`scripts/tracker-corpus/`) so
anyone can regenerate the corpus, plus our own derived notes.

The script crawls every `/help/articles/<slug>/` page **and the REST API v5
reference under `/help/api/`**, converts them to Markdown, saves the raw HTML
and every image (preferring `@2x`), writes an `index.md`, and hunts for
archived CSS/JS bundles of the application itself. The API reference is the
primary source for the *model* (state enum, search operators, iteration and
override shapes, activity `changes[]`, label/epic/project fields and their
value ranges); the articles are the source for *behaviour* and screenshots.
If an application stylesheet is archived, font families, sizes, line heights
and spacing come straight from it; that is unlikely (logged-in pages were
not crawled), so the main path is screenshot measurement (§5).

Derived notes go to `docs/reference/tracker-notes/<screen>.md` (committed, in
our own words): the elements on the screen, their behaviour, the measured
dimensions, and the article slugs the note was derived from. States a
screenshot cannot show (hover, drag, keyboard focus) are written as
"unknown" unless an article describes them — never filled in by guess.
**A note is the gate for a screen**: no screen is designed or implemented
before its note exists. This replaces the softer "Tracker-parity verification" paragraph in
the old `spec/ux-principles.md`.

### 3.2 Core model (Step 1)

Everything below is Tracker's model. Items marked *(corpus)* are UI-level
details settled from the articles before the screen is built; everything
that shapes the step-1 schema is decided here, from Tracker's REST API v5.

- **Story**: type Feature / Bug / Chore / Release. State column is a CHECK
  over Tracker's eight API values: `unscheduled` (Icebox), `unstarted`,
  `planned`, `started`, `finished`, `delivered`, `accepted`, `rejected`.
  `planned` exists only under manual planning (a story placed in Current
  by hand; renders as unstarted with a Start button), so "unstarted"
  queries read `unstarted OR planned`. Transitions differ by type: a
  Release has no `started` (it goes straight to `finished`) and a Chore has
  no `finished` (Finish accepts it) — see
  `docs/reference/tracker-notes/core-model.md` §1. `#<n>` per-project sequence;
  one Requester; zero or more Owners; Markdown description; labels;
  estimate; followers; `created_at`, `updated_at`, **`accepted_at`** (the
  column iterations are derived from, present from step 1); Release
  stories carry an optional deadline; a `priority` column exists from step
  1 (Tracker's later "story priority" field) even though its UI ships in
  step 8.
- **Story ordering**: two ordered lists per project — one for
  Current + Backlog (Current is the head of the list, cut by planning) and
  one for the Icebox; Done is `accepted_at` order. Moves are expressed as
  Tracker's API does, `before_id` / `after_id`, and stored as a sparse
  position renumbered only around the target. A client never sends the
  whole list.
- **Epic**: its own table with a `label_id` (Tracker: an epic *has* a
  label); description, ordering, progress derived from its label's stories
  *(corpus: epic label colouring, story-count semantics)*.
- **Estimation**: per-project point scale — Linear (0,1,2,3), Fibonacci
  (0,1,2,3,5,8), Powers of two (0,1,2,4,8), Custom. Features only, unless
  the project setting "Bugs and chores may be given points" is on. An
  unestimated feature cannot be started.
- **Iterations are derived, not stored.** Iteration `n` is the date window
  computed from the project's start date, iteration length (1–4 weeks) and
  week start day in the project time zone; a story belongs to a done
  iteration by its `accepted_at`. The only stored rows are
  `iteration_overrides` (number, length, team strength %), as in Tracker's
  API. There is no materialized iteration row, no finalize step, and no
  rollover mutation — the time boundary is a read-time computation, so the
  old `spec/velocity.md` "finalization concurrency" hazard does not exist
  in this model.
- **Velocity and planning are computed on read.** Velocity is Tracker's
  published formula over the last N done iterations (N = 1–4, the velocity
  strategy): sum of accepted points divided by team strength, over the sum
  of iteration lengths in weeks, times the default iteration length,
  rounded down, skipping iterations with team strength 0; the initial
  velocity applies while there are fewer, and a manual override replaces
  it. With **automatic planning** on, the Current + Backlog list is cut by
  an asymmetric rule: Current keeps taking stories until its total is at or
  above velocity (unestimated bugs/chores keep flowing in until it is
  exceeded; Start always overrides capacity), while each future iteration
  takes only what fits. With automatic planning off, the user places
  iteration markers by hand. Details, worked examples and the remaining
  open questions (tie-breaking, oversize stories) are in
  `docs/reference/tracker-notes/core-model.md` §3. The pure functions live
  in `packages/core` with golden fixtures.
- **Attachments to a story**: Tasks (checklist, drag-ordered), Comments
  (with file attachments and `@mention`), Followers, Blockers (another
  story `#n` or free text; resolved when the referenced story is accepted),
  Reviews (per-project review types, per-story review status), story
  activity.
- **Activity**: Tracker's shape (§2), one row per user action, many
  `changes[]` per row; Project History and story activity are views over
  the same rows *(corpus: History filters)*.
- **Roles**: Owner / Member / Viewer. Instance admin exists only for setup
  and reset links (unchanged from the foundation). No public projects (§1).
- **Search**: Tracker's query syntax (`type:bug`, `label:"x"`, `owner:`,
  `state:`, `requester:`, `epic:`, `is:blocked`, `has:attachment`, free
  text, negation); the operator list is taken from the API reference in
  step 0 and the parser lives in `packages/core`.

Schema work follows `ARCHITECTURE.md` invariants: composite `(id,
project_id)` keys, `withProject()` only, behaviour in `services/`, guards in
triggers. The step-1 schema proposal (tables, CHECKs, triggers, activity
payload, ordering) goes through its own `/advisor` pass before
implementation (CLAUDE.md new-table gate); step 0 needs no gate.

### 3.3 Screens, in build order

Each step is one unit of work: read the articles → write the note → write
the spec section → implement (server + web) → compare the rendered screen
against the corpus screenshot (§5) → `/code-review` → fable-advisor UI
review → commit. Steps ship in this order because each later screen sits
inside the frame the earlier ones build.

| Step | Screen / capability | Why here |
|---|---|---|
| 0 | Reference corpus (articles + API reference) + notes for the project view | Gate for everything |
| 1 | Core model: schema, services, JSON API, activity shape, ordering, permissions rewrite; `packages/core` velocity / planning / search parser with fixtures | Every panel reads it |
| 2 | Project view frame: header, project bar, left panel toggles, side-by-side scrollable panels, panel headers; **Icebox**, **Backlog** and **Current** panels where Current is derived by automatic planning (iteration settings, velocity, capacity cut), collapsed story rows, state buttons, drag within and between panels, Add story, quick estimate; **Done** panel listing past iterations | The screen users live in — Current/Backlog *is* the planning algorithm, so planning cannot come later |
| 3 | Expanded story (inline editor): every field, state transitions, tasks, comments and attachments, followers, blockers, reviews, story activity, `#n` links | Second half of the daily screen |
| 4 | Manual planning markers, team strength, velocity override, iteration-boundary time handling (derived), remaining iteration details | Completes planning behaviour |
| 5 | Search engine + **search-results panel** | Labels, epics and My Work in Tracker are all search-results panels |
| 6 | **Epics** and **Labels** panels, label autocomplete, epic progress | Built on step 5 |
| 7 | **My Work**, **Blockers**, **Project History** panels, saved searches | Remaining panel toggles |
| 8 | Dashboard (projects list, workspaces), project settings, members, story priority UI and other settings *(corpus)* | Around the project |
| 9 | Analytics: velocity chart, release burndown, epic burnup, cycle time, rejection rate | Needs iteration history |
| 10 | Integrations and data: GitHub/Slack/webhooks, CSV import/export, API tokens, notifications | Periphery |

Steps 2–4 are the acceptance bar for "this is Tracker". Everything after
them is parity completion. MCP (spec/mcp.md) attaches to the JSON API after
step 7 and is unchanged in intent.

## 4. Repository, branches and Backlog

- New branch **`rewrite/tracker`** from `rewrite/phase-1` (HEAD eea9178). The
  foundation is inherited; the domain and web directories are removed in the
  first commits of the new branch rather than rewritten in place.
- **Migrations are squashed into a fresh `0000`** in the first commits of
  `rewrite/tracker`. Nothing in 0000–0004 has shipped (no push, no tag, no
  public image), so "never edit a shipped migration" is not violated, and
  dropping `project_states` on top of five files would carry forward
  workarounds (the three-value point-scale trigger, the missing
  `activity_logs.story_id` FK) that only exist because of forward-only
  history.
- `rewrite/self-hosted` and `rewrite/phase-1` exist only on this machine
  (91 commits; origin has `main` and one chore branch). Before any deletion
  work: tag them `rewrite-phase-0` / `rewrite-phase-1`; the owner pushes the
  branches and tags (push is an owner action).
- `main` is currently a strict ancestor of `rewrite/phase-1`. **No commits
  land on `main` until `rewrite/tracker` merges**, so the merge stays a
  fast-forward. This includes Backlog housekeeping (`.backlog/` is tracked
  and would conflict) — every Backlog operation happens on `rewrite/tracker`.
- TASK-244 and TASK-254 (merge phase 0/1 to main, tag v0.1.0) are on hold;
  the first release to `main` is the Tracker-parity build once steps 2–4
  pass. Proposal for the owner: fold both into one "Tracker first release"
  task so m-8 / m-9 can close.
- `.github/workflows/publish.yml` publishes the image from `main` and
  `rewrite/self-hosted`; replace the latter with `rewrite/tracker` so the
  Docker form is exercised on every push (PRs run tests only).
- Agent context must not describe deleted tables: in the step-1 commit
  series, revise the hook-injected part of `ARCHITECTURE.md` ("read
  `project_states.category`", "iteration rollover is lazy"), the CLAUDE.md
  lines pointing at the old Wayback procedure, `REVIEW.md`'s reference to
  it, and record a decision-3 (or amend decision-2 point 5): iterations are
  derived; Tracker parity is the product rule.
- Whether the Vercel deploy workflow on `main` is still live cannot be told
  from the repository (`chore/gate-deploy-behind-release` exists); owner to
  confirm.
- Backlog milestones m-10 "Self-host 2: Tracker core" and m-11 "Self-host 3:
  Periphery" are re-scoped to steps 1–4 and 5–10 respectively (owner
  decision pending — proposed at the first handoff, per the milestone
  policy). Tasks are proposed, not created, until the owner approves.
- Backlog docs superseded by this document (doc-8, 11, 12, 14, 15, 16, 18,
  20, 27) move to `archive/`.
- Spec files are rewritten step by step; each step's spec edit lands in the
  same commit series as its implementation so `spec/` never describes a
  screen that does not exist.

## 5. Reproducing dimensions without the original

Priority order of evidence:

1. **Archived application CSS** (if the corpus hunt finds it): copy font
   stack, sizes, line heights, paddings, borders as literal values into
   `apps/web/src/styles/tokens.css`. Colours are copied too as the starting
   palette.
2. **`@2x` screenshots**: choose a ruler element whose size is known from
   the CSS or from an unambiguous glyph (a 16px type icon, a 1px hairline
   rendered as 2 device pixels) and derive the image scale from it, since
   help-article images are cropped and their zoom is unknown. Then record
   two kinds of numbers in the screen note, with the source image filename:
   - **Measured**: row height, line box height, paddings, gutters, icon
     sizes, button heights, panel widths.
   - **Inferred**: font size, back-computed from the measured x-height and
     the x-height ratio of the chosen font. Always marked "inferred".
3. **Article prose** for behaviour only, never for dimensions.

Verification: each screen has a Playwright test (new dev dependency plus a
CI job; the repo has none today) that renders the screen and asserts the
*measured* table — row height, line height, paddings, icon sizes, element
order — within 1 CSS px, and reports the inferred font size next to the
note's value. No pixel diff against the reference: the reference's viewport
is unknown and colours differ on purpose. The render is saved beside the
reference under `docs/reference/tracker-notes/compare/<screen>/` for eyes.

Fonts: Tracker's actual font stack is taken from the CSS when found. If it
cannot be recovered, the note records the measured x-height/cap-height and
the closest freely licensed match is chosen and recorded as a divergence.

## 6. Accepted trade-offs

- Time to first visible screen is longer than a screen-first approach
  because step 0 and step 1 come first. Accepted: accidental divergence is
  the failure mode this rewrite exists to remove.
- The spec is rewritten incrementally, so for a while `spec/` mixes
  rewritten and not-yet-rewritten sections. Each section header states
  which it is.
- Reproducing from screenshots caps fidelity at roughly 1 CSS px per
  measurement, and font sizes are inferred rather than measured. Exact
  parity would require the application CSS, which is not expected to be
  archived; the corpus hunt for it is a bounded, one-time attempt.
- Squashing migrations discards the phase-1 upgrade path. Acceptable only
  because no instance exists outside this machine; the moment an image is
  published, forward-only applies again.
