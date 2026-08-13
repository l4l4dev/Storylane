# Quickstart validation: Iteration History CSV Export

## Prerequisites

- Local stack running: `supabase start`, then `pnpm dev` from `apps/web/`.
- Signed in ("Continue as dev user") on a project that has at least two
  finalized iterations, one of them skipped, and at least one goal containing
  Japanese text plus a comma. (Finalize via the "Finish iteration" button or
  let rollover run — see spec/velocity.md.)

## Automated checks

```bash
cd apps/web
pnpm exec vitest run lib/utils/iterations-csv.test.ts components/features/iterations/export-csv-button.test.tsx
pnpm test && pnpm run lint   # full suite before commit
```

Expected: serializer tests cover the contract (header order, RFC 4180 quoting,
BOM, formula neutralization, empty-vs-zero capacity, done-only/skipped-included
row selection, number ordering); component tests cover enabled/disabled states.

## Manual validation

1. Open `http://localhost:3000/projects/<id>/iterations`.
2. The Export CSV control is visible and enabled → click it.
   - A file `<project-slug>-iterations.csv` downloads.
3. Open the file in Excel (or import into Google Sheets):
   - Japanese goal text renders correctly (no mojibake) — BOM check.
   - The comma inside a goal does not split columns — quoting check.
   - Rows = every finalized iteration, ascending numbers; skipped row shows
     `skipped=true`; pre-snapshot capacity cells are empty, not `0`.
   - A goal crafted as `=1+1` shows as text, not `2` — injection check.
4. Sign in as a viewer-role user on the same project → the control is present
   and works (owner decision: no role gating).
5. Open a brand-new project's iterations page → the control is disabled and
   explains why (no finalized iterations yet).

## References

- Column/encoding contract: [contracts/csv-format.md](./contracts/csv-format.md)
- Row semantics: [data-model.md](./data-model.md)
- Decisions & rationale: [research.md](./research.md)
