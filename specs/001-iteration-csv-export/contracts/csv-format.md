# Contract: Iterations CSV format

The downloaded file is the feature's public interface — external consumers
(spreadsheets, scripts) depend on this shape. Changing it is a breaking change.

## File

- MIME `text/csv;charset=utf-8`, content prefixed with a UTF-8 BOM (U+FEFF).
- Line separator: `\r\n` (RFC 4180).
- Filename: `<project-name-slug>-iterations.csv` (project id as fallback slug).

## Header (row 1, always present, exactly this order)

```csv
number,goal,start_date,end_date,skipped,capacity,completed_points
```

## Rows

One row per finalized iteration (`done`, including skipped), ordered by
`number` ascending.

| Column             | Format                                                        |
|--------------------|---------------------------------------------------------------|
| `number`           | integer                                                       |
| `goal`             | free text, RFC 4180-quoted, formula-neutralized; empty if none |
| `start_date`       | `YYYY-MM-DD`                                                  |
| `end_date`         | `YYYY-MM-DD`                                                  |
| `skipped`          | `true` \| `false`                                             |
| `capacity`         | number (person-days); empty cell when never snapshotted        |
| `completed_points` | number (the finalization velocity snapshot); empty when absent |

## Escaping rules

1. Fields containing `,`, `"`, `\n`, or `\r` are wrapped in double quotes;
   embedded `"` doubled (RFC 4180).
2. Text fields starting with `=`, `+`, `-`, `@`, TAB, or CR are prefixed with
   `'` before quoting (CSV/formula-injection neutralization). Applies to
   `goal` only — the other columns are code-formatted.

## Example

```csv
number,goal,start_date,end_date,skipped,capacity,completed_points
1,"Ship login, signup",2026-05-04,2026-05-08,false,9,12
2,,2026-05-11,2026-05-15,true,,
3,"'=SUM(A1:A9) attempt",2026-05-18,2026-05-22,false,10,8
```
