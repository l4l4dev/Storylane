---
id: TASK-68
title: Restructure repo into a pnpm monorepo (root workspace + packages/core)
status: In Progress
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 00:02'
updated_date: '2026-07-17 01:11'
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
- [ ] #2 packages/core (@storylane/core) holds story-state + velocity + the shared stories.ts exports (STORY_TYPES/STORY_STATES/types/storyTypeUsesPoints/pointScaleValues), STORY_STATES duplication resolved, web imports rewired
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
<!-- SECTION:NOTES:END -->
