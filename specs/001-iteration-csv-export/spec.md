# Feature Specification: Iteration History CSV Export

**Feature Branch**: `001-iteration-csv-export`

**Created**: 2026-08-13

**Status**: Draft

**Input**: User description: "Export a project's completed-iteration history as a CSV file. On the iterations page (/projects/[id]/iterations), a member or owner can download a CSV of the project's finalized iterations — number, goal, start/end dates, state (done/skipped), capacity, velocity, and completed points — so they can analyze velocity trends in a spreadsheet or share progress with stakeholders outside the tool. Read-only: no new tables, no RLS changes, no mutations."

## Clarifications

### Session 2026-08-13

- Q: Should the read-only `viewer` role, who can already see this data on the
  page, also get the export control? → A: Yes — every role that can view the
  iterations page gets the export; no role gating. (Asked during specify.)
- Q: When a project has no finalized iterations, how should the export control
  behave? → A: Disabled control that communicates why (e.g. "no finalized
  iterations yet" on hover/label) — no useless empty download.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Download the iteration history as CSV (Priority: P1)

A project member opens the iterations page and clicks an "Export CSV" control.
The browser downloads a CSV file containing one row per finalized iteration of
the project, which opens cleanly in Excel, Numbers, or Google Sheets — including
iteration goals written in Japanese.

**Why this priority**: This is the entire feature — without the download there
is nothing to analyze or share.

**Independent Test**: On a project with at least two finalized iterations, click
the export control and open the downloaded file in a spreadsheet application;
every finalized iteration appears as a row with correct values.

**Acceptance Scenarios**:

1. **Given** a project with finalized iterations, **When** the user activates the
   export control on the iterations page, **Then** a CSV file downloads containing
   one row per finalized iteration, ordered by iteration number ascending.
2. **Given** an iteration goal containing Japanese text and a comma, **When** the
   exported file is opened in Excel, **Then** the text renders correctly (no
   mojibake) and the comma does not break the column layout.
3. **Given** a skipped iteration in the history, **When** the CSV is exported,
   **Then** the skipped iteration appears as a row and is identifiable as skipped.

---

### User Story 2 - Analyze velocity trends outside the tool (Priority: P2)

A stakeholder without a Storylane account receives the CSV and can read, for each
past iteration, when it ran, what its goal was, how many person-days of capacity
the team had, and how many points were completed — enough to chart a velocity
trend in a spreadsheet without any further explanation.

**Why this priority**: This is the purpose of the export, but it is satisfied by
the data shape chosen in User Story 1; it exists as a separate story to pin the
column semantics.

**Independent Test**: Chart completed points ÷ capacity per iteration from the
CSV alone and compare against the rate the app itself reports.

**Acceptance Scenarios**:

1. **Given** the exported CSV, **When** a reader computes completed points ÷
   capacity for a non-skipped iteration, **Then** the result matches the
   per-person-day rate semantics the app uses (spec/velocity.md).
2. **Given** an iteration finalized before capacity snapshots existed (capacity
   is absent), **When** the CSV is read, **Then** the capacity cell is empty
   rather than zero, so it cannot be mistaken for a real zero-capacity sprint.

---

### Edge Cases

- Project with **no finalized iterations**: the export control is disabled with
  an accessible explanation (see FR-007) — no empty-file download.
- Iteration **goal is empty**: the cell is empty, the row still appears.
- Goal text containing **commas, double quotes, or newlines**: the CSV remains
  well-formed (standard CSV quoting).
- Goal text starting with `=`, `+`, `-`, or `@`: the value must not execute as a
  formula when opened in a spreadsheet (CSV/formula injection).
- **Skipped iterations** and **capacity-0 / capacity-missing** iterations appear
  as rows (they are part of history) — consumers can filter by the state column,
  matching how the app's own velocity window excludes them.
- The **current (not yet finalized) iteration and virtual future sprints** never
  appear.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The iterations page MUST offer an export control that downloads the
  project's finalized-iteration history as a single CSV file.
- **FR-002**: The CSV MUST contain exactly one row per finalized iteration
  (`done` state, including skipped ones), ordered by iteration number ascending,
  and MUST NOT include the current iteration or projected future sprints.
- **FR-003**: Each row MUST provide: iteration number, goal, start date, end
  date, skipped flag, capacity (person-days, empty when never snapshotted), and
  completed points (the velocity snapshot taken at finalization). Dates use ISO
  `YYYY-MM-DD`. Column headers are stable, lowercase, snake_case.
- **FR-004**: The file MUST open correctly in Excel with non-ASCII (Japanese)
  content — UTF-8 with BOM.
- **FR-005**: Values MUST be escaped per standard CSV rules, and cell values that
  a spreadsheet would interpret as formulas MUST be neutralized (formula-injection
  safe).
- **FR-006**: Export MUST be available to every role that can view the
  iterations page — owner, member, AND viewer (owner decision 2026-08-13: the
  export is a re-serialization of data those roles already see; no role gating).
  It MUST NOT be reachable for projects the user cannot access (existing
  row-level access rules cover the data itself).
- **FR-007**: When the project has no finalized iterations, the export control
  MUST be disabled and MUST communicate why (accessible text such as "no
  finalized iterations yet") — it never downloads an empty file (owner decision
  2026-08-13).
- **FR-008**: The downloaded filename MUST identify the project and content (e.g.
  contain the project name or id and the word "iterations") so multiple exports
  remain distinguishable.
- **FR-009**: The feature MUST be read-only: no new tables, no schema or
  row-security changes, no data mutations, no change to any existing iteration
  behavior.

### Key Entities

- **Iteration (existing)**: one row per finalized sprint — number, goal, start
  and end dates, done/skipped state, capacity snapshot (person-days), velocity
  snapshot (completed points). Snapshots are written once at finalization and
  never recomputed (spec/velocity.md); the export republishes them verbatim.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member on a project with finalized iterations obtains an
  analyzable spreadsheet of the full iteration history in one click, with zero
  manual copying.
- **SC-002**: 100% of finalized iterations (and nothing else) appear in the file,
  and every value matches what the iterations page itself shows.
- **SC-003**: The file opens in Excel, Numbers, and Google Sheets with Japanese
  goals intact and no broken rows, for goals containing commas, quotes, or
  newlines.
- **SC-004**: A reader can reproduce the app's velocity-rate math from the CSV
  columns alone for any non-skipped iteration with a capacity value.

## Assumptions

- "Velocity" and "completed points" in the feature description are the same
  value — the per-iteration velocity snapshot is defined as the done-category
  point sum at finalization (spec/velocity.md). The CSV therefore has one
  `completed_points` column, not two duplicate columns.
- Retrospective notes are out of scope for v1 (multiline free text bloats the
  file; the goal column plus dates satisfy the trend-analysis purpose).
- The derived per-person-day rate is NOT a column — consumers can compute it
  (SC-004), and publishing a windowed/filtered derived metric as if it were
  per-iteration data invites misreading.
- Export volume is small (a project has at most a few hundred iterations), so a
  single non-paginated file is sufficient.
- Web only — the iOS app is out of scope (matches the project's web-first
  ordering).
