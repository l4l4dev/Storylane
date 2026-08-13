# Research: Iteration History CSV Export

## D1 — Where the CSV is produced: client-side Blob, not a route handler

- **Decision**: Build the CSV in the browser from the iteration rows the
  iterations page (a Server Component) already fetches, and trigger the
  download via a `Blob` + temporary anchor. No new HTTP endpoint.
- **Rationale**: The page's existing query already returns every column the
  CSV needs (`number, goal, start_date, end_date, velocity, capacity, state,
  skipped` — verified in `app/projects/[id]/iterations/page.tsx`), already
  RLS-scoped to the caller. A route handler would duplicate that query, add a
  second auth surface to review, and re-download data the browser already has.
  Client-side generation keeps FR-009 (read-only) trivially true and makes the
  serialization a pure, unit-testable function.
- **Alternatives considered**: `GET /api/projects/[id]/iterations.csv` route
  handler — rejected: second query + auth path for zero user benefit at this
  data volume (≤ hundreds of rows, spec assumption). Revisit only if exports
  ever need to be linkable/scriptable without a session on the page.

## D2 — Encoding: UTF-8 with BOM

- **Decision**: Prepend `﻿` to the CSV string; `Blob` type
  `text/csv;charset=utf-8`.
- **Rationale**: Excel (especially ja-JP) misdetects BOM-less UTF-8 CSVs as
  legacy encodings, producing mojibake — the exact failure spec SC-003 names.
  BOM is the standard, zero-dependency fix; Numbers and Google Sheets ignore it.
- **Alternatives considered**: Shift_JIS output (legacy, breaks non-Japanese
  consumers); no BOM (fails SC-003 in Excel).

## D3 — Escaping and formula-injection neutralization

- **Decision**: RFC 4180 quoting (quote any field containing `,`, `"`, `\n`,
  `\r`; double embedded quotes). Additionally, prefix a single quote `'` to any
  field value starting with `=`, `+`, `-`, `@`, tab, or CR (OWASP CSV-injection
  guidance) — applied to text fields (goal), not to numeric/date columns the
  code itself formats.
- **Rationale**: Goals are user-entered free text; a goal like
  `=HYPERLINK(...)` must not execute when the file opens (spec FR-005). The
  apostrophe prefix is the widely-supported neutralization that survives
  Excel/Sheets/Numbers.
- **Alternatives considered**: rejecting such goals at export time (data loss);
  wrapping in `"="" ..."` tricks (inconsistent across spreadsheet apps).

## D4 — Which rows: `state === "done"`, skipped included

- **Decision**: Export exactly the rows with `state = 'done'` (the page's
  existing `doneIterations` filter), which includes skipped iterations
  (`skipped = true` rows are finalized as done — spec/velocity.md "Skipping").
  Current/planned iterations never appear.
- **Rationale**: matches spec FR-002 and the app's own definition of
  "finalized"; consumers filter by the `skipped` column, mirroring how the
  velocity window itself excludes skipped/capacity-0 rows.

## D5 — Columns and null rendering

- **Decision**: `number, goal, start_date, end_date, skipped, capacity,
  completed_points` — snake_case, this order. `capacity NULL` → empty cell
  (never `0`); `goal NULL` → empty cell; `skipped` → `true`/`false`;
  `completed_points` = the `iterations.velocity` snapshot.
- **Rationale**: FR-003 + the spec assumption that "velocity" and "completed
  points" are one value; empty-vs-zero distinction is spec US2-AC2 (a
  pre-snapshot iteration must not read as a zero-capacity sprint).

## D6 — Filename

- **Decision**: `<project-name-slugified>-iterations.csv`, falling back to the
  project id if the slug comes out empty (e.g. a fully non-ASCII name).
- **Rationale**: FR-008 (distinguishable across projects) without inventing a
  new naming convention; slugification avoids cross-OS filename issues with
  spaces/specials while keeping the common case human-readable.

## D7 — Disabled empty state

- **Decision**: Render the button `disabled` with accessible explanatory text
  ("No finalized iterations yet") when `doneIterations.length === 0`
  (clarification 2026-08-13). Standard `title` + `aria-disabled` semantics via
  the existing shadcn `Button`.
- **Rationale**: FR-007 as decided by the owner; reuses the app's existing
  disabled-control pattern rather than a new empty-state design.
