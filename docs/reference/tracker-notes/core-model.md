# Tracker core model — derived note

Derived in our own words from the local reference corpus (`docs/reference/tracker/`,
git-ignored). Sources: `api §<resource|endpoint>` = an `api/rest-v5.md` heading,
`article:<slug>` = `articles/<slug>.md`. Input for step 1 (schema + services);
it records what Tracker's documentation settles, not what Storylane will build.

Field tables use the API's snake_case. RO = read only, CO = writable only on
create, excl = excluded from responses unless requested via `fields`. Bracketed
numbers are documented max lengths.

---

## 1. Story

### 1.1 Story resource fields

Source for the whole table: `api §story`.

| field | type | values / constraints |
| --- | --- | --- |
| `id` | int | RO, always returned |
| `project_id` | int | |
| `name` | extended string[5000] | required on create |
| `description` | extended string[20000] | |
| `story_type` | enum | `feature`, `bug`, `chore`, `release` |
| `current_state` | enum | `accepted`, `delivered`, `finished`, `started`, `rejected`, `planned`, `unstarted`, `unscheduled` |
| `estimate` | float | point value; see 1.4 |
| `accepted_at` | datetime | acceptance time |
| `deadline` | datetime | release-type stories only |
| `projected_completion` | datetime | RO, excl; release-type only |
| `points_accepted`, `points_total` | float | RO, excl; release-type rollups |
| `counts_accepted`, `counts_total` | int | RO, excl; release-type rollups |
| `requested_by_id` | int | serialized as `requested_by` or `requested_by_id` |
| `owned_by_id` | int | serialized as `owned_by` or `owned_by_id` |
| `owner_ids` | int[] | nested as `owners` by default |
| `label_ids` | int[] | nested as `labels` by default |
| `task_ids` | int[] | CO, excl; nested as `tasks` |
| `pull_request_ids`, `branch_ids` | int[] | CO, excl |
| `cicd_event_ids` | int[] | RO, excl |
| `blocker_ids` | int[] | CO, excl; nested as `blockers` |
| `follower_ids` | int[] | excl; nested as `followers` |
| `comment_ids` | int[] | CO, excl; nested as `comments` |
| `created_at` / `updated_at` | datetime | CO / RO |
| `before_id` / `after_id` | int | excl; null when the story is last / first |
| `integration_id` | int | |
| `external_id` | string[255] | integration's own id, not an association |
| `url` | string | RO |
| `transitions` | story_transition[] | RO, excl |
| `blocked_story_ids` | int[] | RO, excl; stories this one blocks |
| `review_ids` | int[] | CO, excl |
| `cycle_time_details` | cycle_time_details | RO, excl |
| `story_priority` | enum | `p0`, `p1`, `p2`, `p3`, `none` |
| `kind` | string | RO, `"story"` |

Both `owned_by_id` (a single id) and `owner_ids` (a list) exist on the same
resource; the list is authoritative and the singular field is the legacy
single-owner view (source: `api §story`).

### 1.2 The eight states, and `planned`

1. The enum is fixed at eight values and is shared by stories, releases and
   story transitions (source: `api §story`, `api §release`, `api §story_transition`).
2. `unscheduled` is the Icebox state and the only state an Icebox story can be
   in — hence `state:unscheduled` as the documented Icebox filter
   (source: `article:story_states`, `article:advanced_search`).
3. `unstarted` = prioritized into Backlog or Current, no work started
   (source: `article:story_states`).
4. `planned` exists **only in a manually planned project**: with automatic
   planning off, a story dragged into Current becomes `planned`. It still shows
   a Start button and renders like an unstarted story
   (source: `article:story_states`, `article:automatic_vs_manual_planning`).
5. Because of 4, "everything unstarted" in a manually planned project must
   query `unstarted` **and** `planned` (source: `article:advanced_search`).
6. Start enters `started` and makes the clicker an owner. Release stories have
   no `started` state (unscheduled/unstarted/planned → `finished`); chores have
   no `finished` state (Finish → `accepted`) (source: `article:story_states`).
7. `delivered` exits via Accept or Reject; `rejected` exits via Restart back to
   `started` (source: `article:story_states`).
8. Accepted stories turn green and move to the top of Current; they reach Done
   only at iteration rollover (source: `article:story_states`,
   `article:backlog_to_current_flow`).
9. An estimable story with no estimate shows estimate buttons instead of state
   buttons — an unestimated feature cannot be started
   (source: `article:story_states`).
10. Accepting a story with unresolved blockers, reviews or tasks raises a
    confirmation modal rather than being refused
    (source: `article:blocked_stories`).

### 1.3 Story types

`feature`, `bug`, `chore`, `release` (source: `api §story`). Release is a
milestone marker placed at the *end* of the stories it covers; it carries an
optional `deadline`, and cannot be finished while still in the Icebox
(source: `article:organizing_releases`).

### 1.4 Estimates

1. Only features are estimable by default (source:
   `article:planning_with_velocity`, `article:estimating_stories`). Valid
   values come from the project's `point_scale`; see 2.2.
2. `bugs_and_chores_are_estimatable` enables bug/chore estimation. The API
   calls it "strongly not recommended"; the articles add that it cannot be
   turned off again (source: `api §project`,
   `article:changing_project_settings`, `article:planning_with_velocity`).
3. `estimate` is typed as a float, but search documents `-1` as the
   unestimated sentinel (`estimate:-1` / `-estimate:-1`)
   (source: `api §story`, `article:advanced_search`).
4. An accepted story must be estimated; enabling bug/chore estimation after the
   fact leaves older accepted unestimated bugs/chores raising rollback errors
   until given a value (source: `article:planning_with_velocity`).

### 1.5 Owners, requester, followers

1. One requester (`requested_by_id`), zero or more owners (`owner_ids`);
   clicking Start adds the clicker as an owner (source: `api §story`,
   `article:story_states`).
2. Requester and owners follow automatically, as does anyone who comments or is
   @mentioned (source: `article:collaborating_with_comments`).
3. `follower` is a person projection (`id`, `name`, `email`, `initials`,
   `username`); a `following` row joins `person_id` to `story_id` or `epic_id`,
   all CO (source: `api §follower`, `api §following`). Following and @mentions
   are gated per project by the read-only `enable_following`
   (source: `api §project`).

### 1.6 Blockers

Fields: `id` (RO), `story_id` (RO), `person_id` (CO, creator),
`description` (extended string[1000], required on create), `resolved`
(boolean), `created_at`/`updated_at` (RO), `kind` (source: `api §blocker`).

1. A blocker is free text that may link to another story; the linked story then
   shows a "blocking" indicator. Any project member may add, update or delete
   one (source: `article:blocked_stories`).
2. A blocker referencing a story resolves automatically when that story is
   accepted or deleted, and can also be resolved by hand
   (source: `article:blocked_stories`).
3. `blocked_story_ids` on a story is the reverse direction, read only
   (source: `api §story`). Search: `is:blocked` / `has:blocker(s)` /
   `no:blocked`, `is:blocking` / `has:blocking` / `no:blocking`
   (source: `article:advanced_search`).

### 1.7 Reviews

`review`: `id` (RO), `story_id` (RO), `review_type_id` (nested as
`review_type`), `reviewer_id`, `status` (enum: `unstarted`, `in_review`,
`pass`, `revise`), `created_at`/`updated_at` (RO), `kind`.
`review_type`: `id` (RO), `project_id` (RO), `name` (required on create),
`hidden` (boolean — removes it from the review menu),
`created_at`/`updated_at` (RO), `kind`. The project carries `review_type_ids`
(RO, excl) (source: `api §review`, `api §review_type`, `api §project`).

1. Four built-in types ship per project — Test (QA), Design, Code, Security.
   Types can be renamed and hidden but never deleted; custom types can be added
   (source: `article:reviews`).
2. A review is one (type, reviewer, status) triple on a story; reviewers are
   project members. Search: `review:<type>`, `review_status:<status>`,
   `review:<type>&<status>` (type first), `reviewer:<person>`; there is no
   `has:reviews` (source: `article:reviews`, `article:advanced_search`).

### 1.8 Ordering — `before_id` / `after_id`

1. A move is `before_id` and/or `after_id` on POST or PUT of a story; both are
   also readable fields (excl). `before_id` is null for the last story,
   `after_id` null for the first (source: `api §story`,
   `api §/projects/{project_id}/stories`,
   `api §/projects/{project_id}/stories/{story_id}`).
2. A `group` parameter "should be supplied when specifying the story's
   `before_id` and/or `after_id`", values `scheduled`, `unscheduled`,
   `current` — the target list is named explicitly, so ordering is per group,
   not one global list
   (source: `api §/projects/{project_id}/stories/{story_id}` PUT parameters).
3. A cross-project move is the same PUT with a new `project_id` beside `group`
   and `after_id`/`before_id`; reads can be windowed by position with
   `after_story_id` / `before_story_id`
   (source: `api §/projects/{project_id}/stories/{story_id}`,
   `api §/projects/{project_id}/stories`).

### 1.9 Story list and bulk endpoints

1. `GET /projects/{id}/stories` filters: `with_label`, `with_story_type`,
   `with_story_priority`, `with_state`, `after_story_id`, `before_story_id`,
   plus a general `filter` search string (combinable only with `project_id`,
   `date_format`, `limit`, `offset`; anything else errors). Paginated via
   `X-Tracker-Pagination-*`, versioned via `X-Tracker-Project-Version`
   (source: `api §/projects/{project_id}/stories`).
2. `GET /projects/{id}/stories/bulk?ids=...` takes a comma-separated id list,
   max 500, silently ignoring ids that are gone (deleted or moved). It is a
   read-only convenience endpoint, **not** a bulk write
   (source: `api §/projects/{project_id}/stories/bulk`).

---

## 2. Project settings

### 2.1 Project resource fields

Source for the whole table: `api §project`.

| field | type | values / constraints |
| --- | --- | --- |
| `id` | int | RO |
| `name` | extended string[50] | required on create |
| `status` | string | excl |
| `version` | int | RO; incremented on every change in the project |
| `iteration_length` | int | weeks; articles constrain to 1–4, default 1 |
| `week_start_day` | enum | `Sunday`…`Saturday`; default Monday |
| `point_scale` | string[255] | comma-separated values; built-ins `0,1,2,3`, `0,1,2,4,8`, `0,1,2,3,5,8` |
| `point_scale_is_custom` | boolean | RO; set when the string is not a built-in |
| `bugs_and_chores_are_estimatable` | boolean | |
| `automatic_planning` | boolean | false suspends emergent planning of the Current iteration |
| `enable_following` | boolean | RO; gates following and @mentions |
| `enable_tasks` | boolean | |
| `show_story_priority`, `show_priority_icon`, `show_priority_icon_in_all_panels` | boolean | priority-field visibility; see Unknowns 5 |
| `start_date` | date | `YYYY-MM-DD`; must agree with `week_start_day` |
| `time_zone` | time_zone | project-native zone |
| `velocity_averaged_over` | int | number of iterations averaged; articles: 1–4, default 3 |
| `shown_iterations_start_time` | datetime | RO, excl |
| `start_time` | datetime | RO; computed, see 2.3 |
| `number_of_done_iterations_to_show` | int | default 4 per the articles |
| `has_google_domain` | boolean | RO |
| `description` | extended string[140] | |
| `profile_content` | extended string[65535] | project profile page body |
| `enable_incoming_emails` | boolean | replies to notification emails become comments |
| `initial_velocity` | int | used until a real velocity can be computed; default 10 |
| `project_type` | enum | `demo` (deprecated), `private`, `public`, `shared` |
| `public` | boolean | world-readable project |
| `atom_enabled` | boolean | Atom/RSS feed of project changes |
| `current_iteration_number` | int | RO |
| `current_velocity` | int | RO, excl |
| `current_standard_deviation`, `current_volatility` | float | RO, excl |
| `account_id` | int | |
| `join_as` | enum | `owner`, `member`, `viewer`; excl |
| `story_ids` / `epic_ids` / `membership_ids` / `label_ids` / `integration_ids` / `review_type_ids` / `story_template_ids` | int[] | RO, excl |
| `iteration_override_numbers` | int[] | RO, excl |
| `created_at` / `updated_at` | datetime | RO |
| `scm_type_host_url_mapping` | object | RO, excl |
| `kind` | string | RO, `"project"` |

### 2.2 Point scale rules

1. `point_scale` is a comma-delimited string; an exact match against a built-in
   scale selects it, anything else is custom. Clients must not hardcode the
   built-in list — `point_scale_is_custom` is the authority, since the set of
   built-ins is explicitly outside the API version contract
   (source: `api §project`).
2. Built-in → built-in rewrites existing estimates (accepted stories included)
   to the nearest value on the new scale. Any → custom preserves values but is
   one-way: you cannot return to a built-in scale
   (source: `article:changing_project_settings`,
   `article:planning_with_velocity`).
3. Built-in scales render as clickable bars on collapsed cards; a custom scale
   renders as numbers, first five values plus a `+`
   (source: `article:planning_with_velocity`).

### 2.3 Start date and start time

1. `start_date`'s day of week must equal `week_start_day` (source:
   `api §project`, `article:setting_iteration_start_day_project_start_date`).
2. `start_time` is computed, not stored: if any story was accepted before the
   date implied by `start_date`/`week_start_day`, that earlier `accepted_at`
   wins (source: `api §project`).
3. Iterations roll over at midnight in the project time zone on the start day;
   weekends count as part of the iteration
   (source: `article:changing_project_settings`).
4. Changing start day or start date recalculates all iterations, can move Done
   stories between iterations, and **resets iteration overrides (length and
   team strength) to defaults** (source: `article:changing_project_settings`).

---

## 3. Iterations, velocity and planning

### 3.1 Iteration resource

| field | type | values / constraints |
| --- | --- | --- |
| `number` | int | RO, always returned; 1 for the project's first iteration |
| `project_id` | int | RO |
| `length` | int | weeks |
| `team_strength` | float | 1.0 = full strength |
| `story_ids` | int[] | RO; nested as `stories` |
| `start` / `finish` | datetime | RO |
| `velocity` | float | RO, excl; average over `velocity_averaged_over` iterations |
| `points` | int | RO, excl |
| `accepted_points` | int | RO, excl |
| `effective_points` | float | RO, excl; normalized by length and team strength |
| `accepted` / `created` | daily_history_container | RO, excl |
| `analytics` | analytics | RO, excl; `kind` = `"iteration"` |

Source: `api §iteration`.

`iteration_override` is the same shape minus everything derived: `number` (RO),
`project_id` (RO), `length`, `team_strength`, `kind`
(source: `api §iteration_override`). It is written with
`PUT /projects/{id}/iteration_overrides/{number}` carrying only `length` and
`team_strength` (source: `api §/projects/{project_id}/iteration_overrides/{iteration_number}`).

`GET /projects/{id}/iterations` takes `scope` ∈ {`done`, `current`, `backlog`,
`current_backlog`, `done_current`} (default: all including done), plus `label`,
`offset`, `limit`. Iterations are ordered oldest first, and for `done` a
negative `offset` counts back from Current
(source: `api §/projects/{project_id}/iterations`).

### 3.2 Derivation and overrides

1. Iteration windows come from start day + project start date + length; the
   first iteration is the one containing the first accepted story unless an
   earlier `start_date` is set
   (source: `article:setting_iteration_start_day_project_start_date`).
2. Only current and done iterations may have their length overridden — future
   iterations are predictions. An override may be 1–99 weeks and shifts every
   later boundary, which is the documented way to realign iteration dates
   (source: `article:understanding_velocity`,
   `article:setting_iteration_start_day_project_start_date`).
3. Team strength normalizes an iteration's points to a 100%-strength team:
   1–99% inflates the contribution, >100% deflates it, 0% excludes the
   iteration entirely (source: `article:understanding_velocity`).

### 3.3 Velocity

1. Formula, stated explicitly by the help site:
   `velocity_per_week = SUM(iteration.points / iteration.team_strength) / SUM(iteration.length_in_weeks)`
   over the iterations selected by the velocity strategy, excluding iterations
   with team strength 0 from both sums
   (source: `article:understanding_velocity`).
2. The displayed project velocity is that per-week value multiplied by the
   project's default iteration length and rounded **down** to an integer
   (source: `article:understanding_velocity`).
3. `velocity_averaged_over` (UI: Velocity Strategy) is the number of done
   iterations averaged; default 3, range 1–4
   (source: `article:understanding_velocity`, `article:changing_project_settings`).
4. `initial_velocity` (default 10) applies before any completed iteration
   exists, and again whenever the run of consecutive iterations with zero
   accepted points reaches the velocity strategy number
   (source: `article:planning_with_velocity`, `article:understanding_velocity`).
5. Velocity cannot be set manually; the UI override is a per-user, client-side
   what-if, never stored, lost on reload
   (source: `article:understanding_velocity`).
6. Volatility is the relative standard deviation of velocity over the same
   iterations, as a percentage, exposed as `current_volatility` beside
   `current_standard_deviation` (source: `api §project`,
   `article:understanding_velocity`).

### 3.4 How Current and Backlog are cut

Rules 1–6: source `article:backlog_to_current_flow`.

1. With automatic planning on, stories are pulled from the top of the Backlog
   into Current until the point total reaches velocity.
2. **Overflow rule for Current**: once Current's total is at or above velocity,
   the next *estimated* story — and everything after it — stays in the Backlog.
   Unestimated stories (bugs, chores) can still be planned into Current while
   the total has not yet exceeded velocity. Clicking Start always moves a story
   into Current regardless of capacity.
3. **Overflow rule for future iterations**: unlike Current, each Backlog
   iteration takes only what fits within velocity — a story that would push it
   over goes to the next iteration. Hence one iteration may hold fewer points
   than velocity and the next more; the article's example is velocity 8 giving
   a 7-point iteration then a 9-point one, because the next story was 3 points
   (also `article:planning_with_velocity`).
4. Backlog contents are recomputed continuously as stories are reprioritized or
   re-estimated and as velocity moves.
5. There is no negative capacity: 100 points of started work in Current with
   velocity 10 still leaves the next iteration a capacity of 10.
6. At rollover, accepted stories move to Done and everything else in Current
   rolls into the new Current.
7. With automatic planning off, Current holds only in-progress stories, stories
   accepted since the iteration began, and stories dragged in (which become
   `planned`). Future Backlog iterations are still planned automatically
   (source: `article:automatic_vs_manual_planning`).

---

## 4. Labels and epics

### 4.1 Label

| field | type | values / constraints |
| --- | --- | --- |
| `id` | int | RO |
| `project_id` | int | RO |
| `name` | extended string[255] | required |
| `created_at` / `updated_at` | datetime | RO |
| `counts` | story_counts | RO, excl |
| `kind` | string | RO, `"label"` |

Source: `api §label`. `story_counts` is three maps keyed by story state:
`number_of_stories_by_state`, `sum_of_story_estimates_by_state`,
`number_of_zero_point_stories_by_state` (source: `api §story_counts`,
`api §counts_by_story_state`).

Labels are attached to and detached from a story through
`/projects/{id}/stories/{story_id}/labels[/{label_id}]`
(source: `api §/projects/{project_id}/stories/{story_id}/labels`).

### 4.2 Epic

| field | type | values / constraints |
| --- | --- | --- |
| `id` | int | RO |
| `project_id` | int | |
| `name` | extended string[5000] | required on create |
| `label_id` | int | the epic's label; nested as `label` |
| `description` | extended string[20000] | |
| `comment_ids` | int[] | CO, excl |
| `pull_request_ids` / `branch_ids` | int[] | CO, excl |
| `follower_ids` | int[] | excl |
| `created_at` / `updated_at` | datetime | RO |
| `after_id` / `before_id` | int | excl; epic ordering |
| `past_done_story_estimates` | float | RO, excl |
| `past_done_stories_count` | int | RO, excl |
| `past_done_stories_no_point_count` | int | RO, excl |
| `url` | string | RO |
| `completed_at` | datetime | RO, excl |
| `projected_completion` | datetime | RO, excl |
| `kind` | string | RO, `"epic"` |

Source: `api §epic`.

1. An epic *has* a label; a story is in an epic exactly when it carries the
   epic's label (source: `api §epic`).
2. Epic order is a list moved like stories — `before_id` / `after_id`. There is
   no `position` field on the epic resource (source: `api §epic`).
3. Progress is the three `past_done_*` counters plus `completed_at` /
   `projected_completion`; live totals come from the label's `counts`
   (source: `api §epic`, `api §label`). Epics are searchable alongside stories
   and come back in their own bucket
   (source: `api §/projects/{project_id}/search`).

---

## 5. Activity and project version

### 5.1 Activity resource

| field | type | values / constraints |
| --- | --- | --- |
| `kind` | string | RO; `<something>_activity`, see 5.2 |
| `guid` | string | RO, always returned; `"<project_id>_<project_version>"` |
| `project_version` | int | RO, always returned |
| `message` | string | RO; human-readable sentence |
| `highlight` | string | RO; the bold fragment of `message` |
| `changes` | object[] | RO |
| `primary_resources` | object[] | RO |
| `secondary_resources` | secondary_resource[] | RO |
| `project_id` | int | RO; nested as `project` |
| `performed_by_id` | int | RO; nested as `performed_by` |
| `occurred_at` | datetime | RO |

Source: `api §activity`.

Each entry in `changes[]` carries `kind` (the changed resource type), an
`id`/`number` identifying it, `change_type` (`create` / `update`, and by
symmetry `delete`), and `original_values` / `new_values` objects holding only
the fields that moved. Example from the doc: an `iteration_update_activity`
whose change is `kind: "iteration_override"`, `change_type: "update"`, with
`original_values` `{number, finish, team_strength, length: "default"}` and
`new_values` `{number, team_strength, length, finish}` — note that a derived
field (`finish`) appears in the payload and that "default" is used as the
pre-override sentinel for `length`
(source: `api §/projects/{project_id}/activity` example).

`secondary_resource` is `{message, highlight, resource, kind}`, where the
message strings are phrased relative to that secondary resource
(source: `api §secondary_resource`).

`change_type` values observed in the doc: `create`, `update`
(source: `api/rest-v5.md` activity examples).
`changes[].kind` values observed: `story`, `epic`, `comment`, `task`, `label`,
`iteration_override` (source: same).

### 5.2 Activity `kind` values

Observed in the corpus, all suffixed `_activity` (source: `api/rest-v5.md`,
activity examples across endpoints): `story_{create,update,delete,move}`,
`story_move_{into,from}_project`, `story_move_into_project_and_prioritize`,
`epic_{create,update,delete,move}`, `comment_{create,update,delete}`,
`task_{create,update,delete}`, `label_{create,update,delete,merge}`,
`blocker_{create,update,delete}`, `blocking_{create,delete}`,
`review_{create,update,delete}`, `review_type_{create,update}`,
`follower_{create,delete}`, `reaction_{create,update,delete}`,
`pull_request_{create,update,delete}`, `branch_{create,delete}`,
`cicd_event_create`, `iteration_update`, `project_update`, `model_import`,
`project_membership_{create,update,delete}`.

The doc does not publish this as an enumeration — it only states the naming
rule ("ends in `_activity`, starts with a name based on the change")
(source: `api §activity`). The list above is what the corpus happens to show.

### 5.3 Project version

1. `project.version` is a per-project counter bumped on every change; clients
   use it to detect a stale local copy, and every response carries it as the
   `X-Tracker-Project-Version` header (source: `api §project`,
   `api §/projects/{project_id}/stories`).
2. `GET /projects/{id}/activity?since_version=N` returns only activity after
   version N — the resync primitive. Also takes `occurred_before`,
   `occurred_after`, `limit`, `offset`
   (source: `api §/projects/{project_id}/activity`).
3. Activity exists per project, per story, per epic, per person
   (`/my/activity`) and per workspace, all the same resource
   (source: `api §Activity`).
4. Retention is ~6 months on non-Enterprise plans — a hosting limit, not a
   model constraint (source: `api §/projects/{project_id}/activity`).

---

## 6. Search

### 6.1 Endpoint

`GET /projects/{id}/search?query=<string>` returns a `search_result_container`
with separate `stories` and `epics` buckets; the stories bucket carries
`total_points`, `total_points_completed`, `total_hits`, `total_hits_with_done`
(source: `api §/projects/{project_id}/search`).

The same syntax is the `filter` parameter on list endpoints, combinable only
with `project_id`, `date_format`, `limit`, `offset`
(source: `api §/projects/{project_id}/stories`). The UI panel returns at most
500 items per project, ordered recently-accepted, in-progress, unstarted,
unscheduled, then accepted stories from completed iterations. Free text matches
title, description, comments, tasks, requester, owners, attachment filename,
attachment description and labels (source: `article:advanced_search`).

### 6.2 Keywords

Source for the whole section: `article:advanced_search`.

| keyword | accepts |
| --- | --- |
| `name` | quoted or unquoted text |
| `label` | quoted or unquoted text; `label:""` = unlabeled |
| `epic` | quoted or unquoted text; `epics:""` = no epic |
| `type` | `feature`, `bug`, `chore`, `release` (comma-separable) |
| `state` | `unscheduled`, `unstarted`, `planned`, `started`, `finished`, `delivered`, `accepted`, `rejected` (comma-separable) |
| `estimate` | any non-negative integer; `-1` = unestimated |
| `review` | review type name, or `<type>&<status>` |
| `review_status` | `unstarted`, `in_review`, `pass`, `revise` |
| `reviewer` | full name, initials, username, user id, or a name fragment |
| `requester` / `requested_by` | same person forms |
| `owner` / `owned_by` | same person forms; `owned_by:""` = unowned |
| `is` | `blocked`, `blocking`, `following` |
| `has` | `blocker(s)`, `blocking`, `label(s)`, `owner`, `attachment`, `external_id`, `epic(s)` |
| `no` | `blocked`, `blocking`, `label(s)`, `owner`, `epic(s)`, `attachment` |
| `mywork` | a username — in-progress work for that person, accepted stories excluded |
| `includedone` | `true` / `false` (default false) |
| `id` | positive integer, comma-separable |
| `external_id` | positive integer, comma-separable |
| `integration` | `Lighthouse`, `Jira`, `Get Satisfaction`, `Zendesk`, `Bugzilla`, `Other` |
| `created` / `created_on`, `created_since` / `created_after`, `created_before` | date, date range `a..b`, or relative (`today`, `yesterday`, `-2w`, `-nh`, `-nd`, `-nhours`, `-nday`, `-nweeks`) |
| `updated` / `updated_on`, `modified_since` / `updated_since` / `updated_after`, `updated_before` | same date forms |
| `accepted` / `accepted_on`, `accepted_since` / `accepted_after`, `accepted_before` | same date forms |

### 6.3 Syntax rules

All rules in this list: source `article:advanced_search`.

1. Whitespace-separated terms are ANDed. `AND` and `OR` are explicit, have
   equal precedence and group left to right, so parentheses are needed for
   anything non-trivial.
2. Any term except a date term can be negated with a leading `-`;
   `no:<keyword>` is the equivalent spelling for absence.
3. Double quotes give an exact phrase and are required for values containing
   spaces, dashes, underscores or parentheses. No space is allowed between a
   keyword's colon and its value.
4. A comma lists alternatives within one term, documented as valid only for
   `state`, `type`, `id`, `external_id`, with no spaces around it. The API doc
   states the comma rule generically for `filter`
   (source: `api §/projects/{project_id}/stories`); the two disagree on scope —
   treat the article as the narrower, tested claim.
5. `*` and `?` wildcards work on bare terms; a double-quoted term is *not* a
   pattern; full regular expressions need forward slashes (`/seriali.e/`).
6. Dates are read in the searcher's time zone and need a 4-digit year.

### 6.4 Saved searches

`id` (int, RO), `project_id` (int, RO), `name` (string[255], required on
create), `query` (string[1000], required on create), `kind`
(source: `api §saved_search`). Per-person, per-project
(`/projects/{id}/my/searches`), shown in the sidebar
(source: `api §Saved Search`, `article:advanced_search`).

---

## 7. Tasks, comments, releases, source commits, webhooks, notifications

**Tasks.** `id` (RO), `story_id` (RO), `description` (extended string[1000],
required on create), `complete` (boolean), `position` (int, 1-based from the
top), `created_at`/`updated_at` (RO), `kind`; per-project opt-in via
`enable_tasks` (source: `api §task`, `api §project`).

**Comments.** `id` (RO), `story_id` **or** `epic_id` (RO; the other is absent),
`text` (extended string[20000]), `person_id` (CO), `created_at` (RO),
`updated_at` (RO — bumped by attachment add/remove as well as text edits),
`file_attachment_ids` (CO, excl), `google_attachment_ids` (CO, excl),
`attachment_ids` (CO, excl), `commit_identifier` and `commit_type` (CO; present
only on comments created through the source-commits endpoint), `external_source`
/ `external_author` / `external_link` (CO, always returned; set when the comment
was cloned from another tool), `kind` (source: `api §comment`). A file
attachment carries `filename`, `uploader_id`, `size`, `content_type`,
`thumbnailable`, `height`, `width`, `download_url`, `big_url`, `thumbnail_url`,
`uploaded` — all read only (source: `api §file_attachment`); a Google attachment
carries `comment_id`, `person_id`, `google_kind`, `title`, `google_id`,
`alternate_link`, `resource_id` (source: `api §google_attachment`). `@mention`
in a comment notifies the mentioned person and makes them a follower of the
story or epic; viewers cannot be @mentioned
(source: `article:collaborating_with_comments`). Only the author may edit a
comment; the author or any project owner may delete it
(source: `article:project_member_roles`).

**Releases.** The `release` resource mirrors a release-type story: `name`,
`description`, `current_state` (same eight values), `accepted_at`, `deadline`,
`label_ids`, `story_ids` (excl), `projected_completion` and
`projected_completion_interval` (RO, excl), and the rollups `points_accepted`,
`points_total`, `counts_accepted`, `counts_total` (RO, excl)
(source: `api §release`). `GET /projects/{id}/releases/{id}/stories` returns the
stories a release covers — i.e. everything above the marker
(source: `api §/projects/{project_id}/releases/{id}/stories`). A release marker
sits at the end of the stories it covers and rides up the Backlog as they are
accepted; a deadline draws a marker line at the end of the iteration containing
that date, and the card turns red once the containing iteration starts after the
deadline (source: `article:organizing_releases`).

**Source commits and webhooks.** `POST /source_commits` takes
`{commit_id, message, url, author, repo}` and turns a commit message
referencing `#<story id>` into a comment on that story, attributed to the
project member whose name matches `author` exactly, otherwise to the API caller
(source: `api §source_commit`); the comment keeps `commit_identifier` /
`commit_type` (source: `api §comment`). Outbound, a project webhook is
`{id, project_id, webhook_url (required), enabled, last_error_code,
last_response_body, created_at, updated_at, kind}` — the last error code and
body are always returned, which is how a broken endpoint surfaces
(source: `api §webhook`). Commit hooks can also drive `finished` /
`delivered` transitions (source: `article:story_states`).

**Notifications.** `id` (RO), `project_id` (RO, nested as `project`),
`performer_id` (RO, nested as `performer`), `message` (RO), `link` (RO),
`context` (RO — e.g. the comment text), `notification_type` (RO, enum:
`story`, `epic`, `comment`, `comment_with_mention`, `blocker`),
`new_attachment_count` (RO), `action` (RO), `story_id` (RO, nested as `story`),
`epic_id` (RO, nested as `epic`), `comment_id` (RO), `created_at` (RO),
`updated_at` (RO), `read_at` (writable), `kind` (source: `api §notification`).
Read state is managed through `/my/notifications/mark_read` and
`/my/notifications/read_list` (source: `api §Notifications`).

---

## 8. Memberships

### 8.1 Project membership

| field | type | values / constraints |
| --- | --- | --- |
| `id` | int | RO |
| `person_id` | int | CO; nested as `person` |
| `project_id` | int | CO |
| `role` | enum | `owner`, `member`, `viewer`, `inactive` |
| `project_color` | string | hex, per-member project colour |
| `favorite` | boolean | |
| `last_viewed_at` | datetime | approximate |
| `wants_comment_notification_emails` | boolean | RO |
| `will_receive_mention_notifications_or_emails` | boolean | RO |
| `created_at` | datetime | CO |
| `updated_at` | datetime | RO |
| `kind` | string | RO, `"project_membership"` |

Source: `api §project_membership`.

1. `inactive` memberships are never returned by any v5 endpoint; the listing
   supports `sort_by=name`
   (source: `api §/projects/{project_id}/memberships`).
2. Members may do anything with stories, comments and attachments but may not
   edit project settings, manage members, or configure integrations; owners
   may. Viewers are read-only, can follow stories and receive notifications,
   and cannot be @mentioned (source: `article:project_member_roles`,
   `article:collaborating_with_comments`).

### 8.2 Account layer (not carried — see Divergences)

Tracker puts projects inside accounts. Account roles are Owner (exactly one per
account, transferable), Admin (may administer any project in the account, change
roles, and transfer ownership) and Project creator (a per-person permission to
create projects). Account owners and admins can edit settings and membership of
**any** project in the account, including projects they are not members of
(source: `article:account_member_roles`, `article:project_member_roles`,
`api §account`, `api §account_membership`).

---

## 9. Unknowns

Things neither the API reference nor the articles in the corpus settle:

1. The exact packing and tie-breaking rule for Backlog iterations: the
   articles give intent and a worked example, but not what happens to a story
   larger than one iteration's capacity, nor whether
   started/finished/delivered stories consume Current capacity.
2. Whether `estimate: -1` is stored, or is only a search-layer sentinel for
   null — `api §story` types it as a plain float and never mentions `-1`.
3. The authoritative activity `kind` enumeration (§5.2 is what the examples
   show; the doc declines to enumerate), and whether
   `changes[].change_type` has a `delete` value.
4. Which fields land in `original_values` / `new_values` for a story update —
   the one worked example is an iteration override and includes a derived field.
5. How `story_priority` interacts with ordering or planning, and what
   `show_story_priority` / `show_priority_icon` /
   `show_priority_icon_in_all_panels` each control: the three share one
   copy-pasted description in `api §project`.
6. Ranges for `iteration_length` and `velocity_averaged_over` — the articles
   say 1–4 for both, `api §project` bounds neither. (Iteration *overrides* are
   separately documented as 1–99 weeks.)
7. Whether `planned` can be set through the API, or only arises from a drag in
   a manually planned project; and whether the story `group` value `current` is
   accepted while automatic planning is on.
8. Label colours — the UI colours epic labels, but no colour field exists on
   `api §label` or `api §epic`.
9. `project.status` — present in the resource, never described.
10. How a hand-placed iteration marker is persisted in manual planning:
    `article:automatic_vs_manual_planning` describes the effect, not the
    representation.

---

## 10. Divergence candidates

Things Storylane should decide against carrying, or cannot carry, in a
self-hosted single-instance deployment:

1. **Account layer.** Accounts, account memberships, the owner/admin/project
   creator roles, account summaries, and the rule that account admins
   implicitly administer every project. One tenant per install; project roles
   plus an instance admin cover it (source: `api §account`,
   `api §account_membership`, `article:account_member_roles`).
2. **Public projects.** `public`, `project_type` ∈ {`public`, `shared`,
   `demo`}, `join_as` self-join, the public listing, and unauthenticated reads
   (which is also why `person.email` is conditionally omitted). Out of scope
   per the rewrite design §1 (source: `api §project`,
   `article:using_public_projects`, `article:changing_project_settings`).
3. **Billing and plan limits** — collaborator limits, subscription plans, the
   Enterprise-only activity retention window
   (source: `article:account_member_roles`,
   `api §/projects/{project_id}/activity`).
4. **Workspaces** — multi-project workspaces and workspace-scoped activity and
   search (source: `api §Workspaces`).
5. **Third-party integrations** — Jira, Zendesk, Bugzilla, Lighthouse, Get
   Satisfaction, GitHub/GitLab/Bitbucket, CI/CD, and the `external_id` /
   `integration_id` / `external_source` fields supporting them
   (source: `api §Project Integrations`, `api §Generic Integrations`).
6. **Google attachments** and `has_google_domain`, which need a Google Apps
   domain (source: `api §google_attachment`, `api §project`).
7. **Atom feeds** (`atom_enabled`) and **incoming email**
   (`enable_incoming_emails`) — both need mail/feed infrastructure a single
   container does not have (source: `api §project`).
8. **Two-factor auth, SAML SSO, SCIM provisioning**
   (source: `api §Two Factor Authentication`, `article:tracker_saml_sso`,
   `article:scim_provisioning_okta`).
9. **`enable_following` as a read-only flag** — if following is always on the
   flag disappears rather than becoming writable (source: `api §project`).
10. Peripheral resources to defer rather than diverge on: story templates,
    reactions, pull requests / branches / CI-CD events, exports, analytics,
    the request aggregator, project history snapshots
    (source: `api §Resources`).
