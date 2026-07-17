---
id: TASK-68
title: Restructure repo into a pnpm monorepo (root workspace + packages/core)
status: To Do
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-17 00:02'
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
- [ ] #1 Repo root holds pnpm-workspace.yaml + minimal package.json; apps/web builds and all its tests pass under the lifted workspace
- [ ] #2 packages/core (@storylane/core) holds story-state + velocity + the shared stories.ts exports (STORY_TYPES/STORY_STATES/types/storyTypeUsesPoints/pointScaleValues), STORY_STATES duplication resolved, web imports rewired
- [ ] #3 CI (.github/workflows/web-ci.yml) updated for the lifted workspace: install at root, tsc/lint/test via --filter, paths filter includes packages/**; core tsc+vitest gated
- [ ] #4 TASK-3 deploy notes updated for Vercel (Root Directory apps/web, root lockfile, include-outside-root, pnpm 11)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Advisor-approved design (Fable, 2026-07-17) — split out of TASK-48 as a prerequisite. behavior-preserving infra work, no MCP code.

TWO COMMITS:
1) Workspace root lift: root package.json (name storylane, private, packageManager pnpm@11.1.3) + pnpm-workspace.yaml (packages: apps/web, apps/mcp, packages/*; move current allowBuilds sharp/unrs-resolver here). Delete apps/web/pnpm-workspace.yaml; remove packageManager from apps/web/package.json. git mv apps/web/pnpm-lock.yaml pnpm-lock.yaml then root pnpm install (lockfile diff should be ~importer rename). Update web-ci.yml (pnpm setup/cache path to root, install at root, tsc/lint/test via --filter web, paths filter += packages/**, pnpm-lock.yaml, pnpm-workspace.yaml). Root .gitignore node_modules. Gate: pnpm --filter web test all green + pnpm --filter web build.
2) packages/core extraction: @storylane/core (private, exports = TS source, own strict tsconfig + node-env vitest). Move story-state.ts+test, velocity.ts+test, and from stories.ts: STORY_TYPES/StoryType/STORY_STATES/StoryState/storyTypeUsesPoints/pointScaleValues. stories.ts re-exports from core so its 12 importers are unchanged; rewire the ~6 story-state web importers to @storylane/core. next.config.ts transpilePackages: [@storylane/core]. CI += core tsc+vitest. Leave STORY_TYPE_META/STORY_STATE_META (Tailwind), StoryFilter/matchesStoryFilter/filterStories, formatPoints/parsePoints in web. Do NOT move other utils.

Risks flagged by advisor: web-ci.yml 4 spots (working-directory, cache-dependency-path, package_json_file, paths filter); next transpilePackages for TS-source package; vitest resolves workspace-linked pkgs (core needs own node-env config); tsc/eslint scoping (core gets own tsconfig, lint deferred to TASK-48); lockfile version drift (verify diff + full test + build); root .gitignore.

apps/mcp startup (for TASK-48): tsx (core is TS source, Node type-stripping unreliable for symlinked workspace .ts).
<!-- SECTION:NOTES:END -->
