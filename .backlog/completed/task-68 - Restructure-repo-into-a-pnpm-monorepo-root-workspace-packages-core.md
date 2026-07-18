---
id: TASK-68
title: Restructure repo into a pnpm monorepo (root workspace + packages/core)
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 00:02'
updated_date: '2026-07-17 01:21'
labels:
  - chore
  - refactor
  - build
dependencies: []
priority: medium
ordinal: 750
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Repo root holds pnpm-workspace.yaml + minimal package.json; apps/web builds and all its tests pass under the lifted workspace
- [x] #2 packages/core (@storylane/core) holds story-state + velocity + the shared stories.ts exports (STORY_TYPES/STORY_STATES/types/storyTypeUsesPoints/pointScaleValues), STORY_STATES duplication resolved, web imports rewired
- [x] #3 CI (.github/workflows/web-ci.yml) updated for the lifted workspace: install at root, tsc/lint/test via --filter, paths filter includes packages/**; core tsc+vitest gated
- [x] #4 TASK-3 deploy notes updated for Vercel (Root Directory apps/web, root lockfile, include-outside-root, pnpm 11)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Advisor-approved design (Fable, 2026-07-17) — split out of TASK-48 as a prerequisite. behavior-preserving infra work, no MCP code.

TWO COMMITS:
1) Workspace root lift: root package.json (name storylane, private, packageManager pnpm@11.1.3) + pnpm-workspace.yaml (packages: apps/web, apps/mcp, packages/*; move current allowBuilds sharp/unrs-resolver here). Delete apps/web/pnpm-workspace.yaml; remove packageManager from apps/web/package.json. git mv apps/web/pnpm-lock.yaml pnpm-lock.yaml then root pnpm install (lockfile diff should be ~importer rename). Update web-ci.yml (pnpm setup/cache path to root, install at root, tsc/lint/test via --filter web, paths filter += packages/**, pnpm-lock.yaml, pnpm-workspace.yaml). Root .gitignore node_modules. Gate: pnpm --filter web test all green + pnpm --filter web build.
2) packages/core extraction: @storylane/core (private, exports = TS source, own strict tsconfig + node-env vitest). Move story-state.ts+test, velocity.ts+test, and from stories.ts: STORY_TYPES/StoryType/STORY_STATES/StoryState/storyTypeUsesPoints/pointScaleValues. stories.ts re-exports from core so its 12 importers are unchanged; rewire the ~6 story-state web importers to @storylane/core. next.config.ts transpilePackages: [@storylane/core]. CI += core tsc+vitest. Leave STORY_TYPE_META/STORY_STATE_META (Tailwind), StoryFilter/matchesStoryFilter/filterStories, formatPoints/parsePoints in web. Do NOT move other utils.

Risks flagged by advisor: web-ci.yml 4 spots (working-directory, cache-dependency-path, package_json_file, paths filter); next transpilePackages for TS-source package; vitest resolves workspace-linked pkgs (core needs own node-env config); tsc/eslint scoping (core gets own tsconfig, lint deferred to TASK-48); lockfile version drift (verify diff + full test + build); root .gitignore.

apps/mcp startup (for TASK-48): tsx (core is TS source, Node type-stripping unreliable for symlinked workspace .ts).

COMMIT 1 (workspace root lift) done (Sonnet 5, 2026-07-17):
- Root package.json (name storylane, private, packageManager pnpm@11.1.3) + root pnpm-workspace.yaml (packages: apps/web, apps/mcp, packages/*; allowBuilds sharp/unrs-resolver moved here).
- apps/web/pnpm-workspace.yaml deleted, packageManager removed from apps/web/package.json, lockfile moved to repo root (git mv). NOTE: these two steps landed in commit 96d731e (a TASK-67 regression fix, see below) because they were already staged when that fix was committed without a pathspec -- contents are correct, just misattributed in that commit's message.
- Root .gitignore: node_modules/ (was apps/web/node_modules/ only).
- web-ci.yml: pnpm/action-setup no longer pins package_json_file (root packageManager auto-detected), cache-dependency-path -> root pnpm-lock.yaml, install at repo root, tsc/lint/test via 'pnpm --filter web', paths filter += packages/**, pnpm-lock.yaml, pnpm-workspace.yaml. Removed the now-redundant working-directory default.
- Lockfile diff: 4 lines (importer key '.' -> 'apps/web' + one blank importer stanza for root), confirming the advisor's 'mostly a rename' prediction.

REGRESSION FOUND DURING THIS TASK'S build-gate check (commit 96d731e, unrelated to the workspace lift itself): pnpm --filter web run build failed with 'createContext is not a function' at /projects/[id]/board and /projects/[id]/iterations. Bisected across this session's commits: passes at 9fceee6 (TASK-58 done), fails at 8adfd50 (TASK-67). Root cause: TASK-67 added an @dnd-kit/sortable import (arrayMove) to lib/utils/board.ts, which board/page.tsx and iterations/page.tsx (Server Components) import from -- bundling @dnd-kit/sortable into the server bundle broke SSR page-data collection. Invisible to tsc/eslint/vitest. Fixed by extracting the one @dnd-kit-dependent export (reorderContainer) into a new board-dnd.ts, keeping board.ts framework-free per its original design comment. Verified: tsc 0, eslint 0, 521 vitest pass, and 'pnpm --filter web run build' now succeeds.

Verified all four gates from the repo root: pnpm --filter web exec tsc --noEmit (0), pnpm --filter web run lint (0), SUPABASE_INTEGRATION=1 pnpm --filter web run test (521 pass), pnpm --filter web run build (succeeds).

REMAINING: AC#2 (packages/core extraction, commit 2).

COMMIT 2 (packages/core extraction) done (Sonnet 5, 2026-07-17):
- @storylane/core: story-state.ts + velocity.ts moved wholesale (git mv, no logic changes), plus a new story-types.ts split out of stories.ts (STORY_TYPES/StoryType/storyTypeUsesPoints/pointScaleValues) since velocity.ts depends on storyTypeUsesPoints.
- stories.ts re-exports those four symbols (import + export, not `export ... from` alone, since parsePoints uses storyTypeUsesPoints locally) so its 12 existing importers are unchanged. The 3 story-state.ts importers (board/actions.ts, kanban.ts, transition-buttons.tsx) and 4 velocity.ts importers now import @storylane/core directly.
- next.config.ts: transpilePackages: ["@storylane/core"] (TS-source package, no build step).
- apps/web/package.json: "@storylane/core": "workspace:*".

DEVIATION FROM ADVISOR'S LITERAL INSTRUCTION (flagged for the record): the verdict said stories.ts's STORY_STATES/StoryState duplicates story-state.ts's and should be unified via re-export. On inspection they are NOT identical: stories.ts's version has 6 values (no 'unscheduled'), story-state.ts's has 7 (includes 'unscheduled', backs the transition FSM). They never collide in the same import site (checked: no file imports StoryState from both modules). stories.ts's version exists only to key STORY_STATE_META (a badge label/className map). Unifying them would force STORY_STATE_META to gain an 'unscheduled' entry -- a real product decision (what does an Icebox row's state badge look like?) that's out of scope for a behavior-preserving infra task. Left both as-is; documented the reasoning in a comment in stories.ts. Recommend the owner or advisor make that product call explicitly if/when it matters, rather than have it decided as a side effect of a refactor.

FINAL VERIFICATION (from repo root, all four gates + both packages):
- pnpm --filter @storylane/core exec tsc --noEmit: 0 errors
- pnpm --filter @storylane/core run test: 36 pass
- pnpm --filter web exec tsc --noEmit: 0 errors
- pnpm --filter web run lint: 0 errors
- SUPABASE_INTEGRATION=1 pnpm --filter web run test: 485 pass (485 + 36 core = 521, matches pre-split total -- no tests lost)
- pnpm --filter web run build: succeeds (also verified without .env.local present, since CI has no secrets -- build succeeds because Supabase clients are only constructed at request time, not at build/import time)

TASK-68 COMPLETE. TASK-48 (MCP server) is now unblocked.
<!-- SECTION:NOTES:END -->
