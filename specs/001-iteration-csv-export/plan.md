# Implementation Plan: Iteration History CSV Export

**Branch**: `001-iteration-csv-export` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-iteration-csv-export/spec.md`

## Summary

Add an "Export CSV" control to the iterations page that serializes the
project's finalized iterations — data the page already fetches — into a
UTF-8-BOM, injection-safe CSV and downloads it in the browser. No new queries,
routes, tables, or policies: a pure serialization helper plus a small client
component consuming rows the server component already has.

## Technical Context

**Language/Version**: TypeScript 5 / React 19 / Next.js 16 (App Router)

**Primary Dependencies**: none added — browser `Blob` + anchor download; no CSV library

**Storage**: existing `iterations` table, read-only, via the page's existing query (no new Supabase calls)

**Testing**: Vitest (`lib/utils/*.test.ts` co-located), Testing Library for the control's disabled/enabled states

**Target Platform**: Web only (`apps/web`), per spec assumption

**Project Type**: Existing Next.js app — feature slots into current structure

**Performance Goals**: N/A beyond instant download — data is already in memory on the page (≤ a few hundred rows, spec assumption)

**Constraints**: read-only (spec FR-009); UTF-8 BOM (FR-004); RFC 4180 quoting + formula neutralization (FR-005); stable snake_case headers (FR-003)

**Scale/Scope**: 1 pure helper + tests, 1 small client component + tests, 1 wiring line in the page — ~3 files touched, 2 added

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Product spec is `spec/`**: PASS — read `spec/velocity.md` (snapshot
  semantics: `iterations.velocity` = completed points at finalization,
  `capacity` = person-days, NULL for pre-snapshot history) and `spec/screens.md`
  route map before drafting. Nothing here contradicts `spec/`; the CSV
  republishes snapshots verbatim.
- **II. Business rules live in the database**: PASS — no mutation, no RPC, no
  RLS change. Reads reuse the page's existing RLS-scoped query.
- **III. Backlog is the execution tracker**: PASS — TASK-234 tracks this work;
  tasks.md (next phase) only seeds it.
- **IV. CLAUDE.md workflow rules**: PASS — /code-review before commit,
  fable-advisor UX review at the end (user-facing UI), tests mandatory.
- **V. Public repo**: PASS — no personal data; fixtures use fictional goals.

*Post-design re-check (after Phase 1)*: unchanged — PASS on all five.

## Project Structure

### Documentation (this feature)

```text
specs/001-iteration-csv-export/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── csv-format.md    # Column/encoding contract (Phase 1 output)
└── tasks.md             # Phase 2 output (/speckit-tasks — not this command)
```

### Source Code (repository root)

```text
apps/web/
├── app/projects/[id]/iterations/
│   └── page.tsx                          # wire: pass done iterations + project name to the control
├── components/features/iterations/
│   ├── export-csv-button.tsx             # NEW: client component (Blob download, disabled state)
│   └── export-csv-button.test.tsx        # NEW
└── lib/utils/
    ├── iterations-csv.ts                 # NEW: pure buildIterationsCsv() (quoting, BOM, neutralization)
    └── iterations-csv.test.ts            # NEW
```

**Structure Decision**: follows the existing split the codebase already uses —
pure logic in `lib/utils/` with co-located Vitest tests (cf. `burndown.ts`),
feature UI in `components/features/iterations/` (cf. `burndown-chart.tsx`),
and the server component page only passing already-fetched data down.

## Complexity Tracking

No constitution violations — table not needed.
