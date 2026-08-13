# Data Model: Iteration History CSV Export

No schema changes. The feature consumes one existing entity, read-only.

## Iteration (existing table: `iterations`)

Columns consumed (already selected by `app/projects/[id]/iterations/page.tsx`):

| Column        | Type      | CSV use                                                    |
|---------------|-----------|------------------------------------------------------------|
| `number`      | int       | `number` column                                            |
| `goal`        | text/null | `goal` column; NULL → empty cell                           |
| `start_date`  | date      | `start_date` column (already `YYYY-MM-DD`)                 |
| `end_date`    | date      | `end_date` column (already `YYYY-MM-DD`)                   |
| `skipped`     | bool      | `skipped` column, rendered `true`/`false`                  |
| `capacity`    | num/null  | `capacity` column; NULL → empty cell (pre-snapshot rows)   |
| `velocity`    | num/null  | `completed_points` column; NULL → empty cell               |
| `state`       | enum      | row filter only: export `state = 'done'` rows, never a column |

Snapshot semantics (authoritative: `spec/velocity.md`): `velocity` and
`capacity` are written once by `finalize_iteration` and never recomputed —
the export republishes them verbatim, no derivation.

## Row selection

`state === 'done'`, ordered by `number` ascending. Includes `skipped = true`
rows; excludes the current (non-done) iteration and anything projected.

## New types (TypeScript only, no DB)

`IterationCsvRow` — input shape of the pure serializer, structurally a subset
of the page's existing iteration row type (no new fetch, no type drift).
