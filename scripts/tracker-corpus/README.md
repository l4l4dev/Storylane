# Tracker reference corpus

`fetch.ts` mirrors the archived Pivotal Tracker help site from the Wayback Machine into a
local, **git-ignored** reference corpus. Storylane is being rebuilt as a faithful Tracker
clone, and this corpus is the primary source for deriving UI specs.

## Run it

```sh
bun scripts/tracker-corpus/fetch.ts           # idempotent: skips files already on disk
bun scripts/tracker-corpus/fetch.ts --force   # re-download and re-convert everything
```

No dependencies beyond Bun — the HTML parser and the HTML→Markdown converter are in the
script. A full cold run takes roughly 20–40 minutes; re-runs take a couple of minutes.

## What it produces

Everything lands under `docs/reference/tracker/` (git-ignored):

| Path | Contents |
| --- | --- |
| `index.md` | Table of every page: slug, title, capture timestamp, image count, `h2` headings. Sorted by slug. |
| `articles/<slug>.md` | Help article converted to Markdown, with the archived URL and capture timestamp at the top. |
| `articles/<slug>.html` | The raw archived HTML, for re-conversion without re-fetching. |
| `api/<slug>.{md,html}` | Same, for pages under `/help/api`. |
| `images/<filename>` | Every image an article references, `@2x` preferred when the page offers both. |
| `assets/` | Archived CSS/JS of the Tracker application, plus `assets/README.md` summarising font families, font sizes and line heights per stylesheet. |
| `assets/extracted/` | CSS pulled out of the webpack bundles by `python3 scripts/tracker-corpus/extract-css.py docs/reference/tracker/assets`, plus `COVERAGE.md` (class name → screen). The application's own stylesheet `assets.pivotaltracker.com/next/assets/next/<hash>-next.css` is plain CSS and is kept as fetched. |
| `fetch-log.json` | Per-URL result (`ok` / `skipped` / `not-found` / `failed`) so gaps stay visible. |

## How it works

- Content is fetched through the Wayback `…/web/<timestamp>id_/<url>` form, which returns the
  original bytes with no Wayback toolbar injected — so no archive markup needs stripping.
- Each page prefers the latest 2024 capture (Tracker shut down in 2025, so 2024 is the final
  UI). When no 2024 capture exists it falls back to the latest capture of any year, and
  `index.md` flags the year with a ⚠.
- Page discovery is a BFS over every `/help/…` link, seeded from the help home page and one
  article (each article carries the full sidebar table of contents), plus the CDX index for
  completeness.
- The CDX endpoint is frequently down and answers with an "Internet Archive: Temporarily
  Offline" HTML page instead of an error status. The script detects that and retries with
  backoff; if CDX never answers, the crawl still completes from the in-page navigation and
  `assets/README.md` says the asset sweep was degraded. Re-run later to fill the gap.
- Politeness: at most 3 concurrent requests, ~200 ms spacing, exponential backoff on 429/5xx.
- Idempotent: an existing file is left alone unless `--force` is passed.

## Measuring screenshots

`python3 scripts/tracker-corpus/measure.py <image> rows|cols|runs|glyph|size [--scale N]` reports row pitch and element sizes from a corpus screenshot; see the docstring at the top of the script.

## Caveat — copyright

**The output is Pivotal Software / VMware copyrighted documentation.** It is downloaded for
internal reference while writing Storylane's own specs, and it is deliberately kept out of
git: `.gitignore` excludes `docs/reference/tracker/`. Do not commit it, publish it, or copy
its wording into Storylane's spec, docs or UI — read it, then write our own text. Only this
script and this README belong in the repository.
