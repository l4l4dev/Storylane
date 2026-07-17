---
id: TASK-66
title: Delete dead code found by ponytail audit 2026-07-16 (non-board files)
status: Done
assignee:
  - '@claude-fable-5'
created_date: '2026-07-16 04:19'
updated_date: '2026-07-16 04:37'
labels:
  - web
  - chore
milestone: m-0
dependencies: []
priority: low
ordinal: 400
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Whole-repo over-engineering audit (ponytail-audit, 2026-07-16) found ~550 lines of verified-dead code. This task covers the subset in files TASK-57 (in progress in another session) will NOT touch. Board-adjacent leftovers are tracked in the follow-up shrink task instead.

Delete (all verified unused via grep across apps/web; re-verify before deleting):
- components/ui/select.tsx — entire file, zero import sites (native-select.tsx is what is used everywhere)
- components/ui/dropdown-menu.tsx — unused exports: DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuGroup, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent (keep the used ones)
- lib/utils/recurring.ts — entire file plus its test file; occurrence math moved server-side to the generate_recurring_stories RPC and nothing imports this module outside its own test
- components/ui/card.tsx — CardFooter, CardDescription, CardAction exports and the size="sm" variant (zero call sites)
- lib/utils/iterations.ts — autoAssignStoryIds and isIterationEditable (server-side now / never wired); remove their test blocks too
- lib/utils/kanban.ts — groupByStateColumn (+ its tests)
- lib/utils/stories.ts — reorderPositions (+ its tests; orphaned by TASK-56's move_story_board RPC)
- components/ui/badge.tsx — variants destructive/ghost/link, asChild prop, badgeVariants export (zero call sites)
- components/ui/button.tsx — variant link and size icon-lg (zero call sites)
- components/ui/popover.tsx — PopoverAnchor export (zero call sites)
- lib/types.ts — ProjectMember and ProjectRole types (zero references)

Do NOT touch: anything under components/features/board/, app/projects/[id]/board/actions.ts, app/projects/[id]/settings/actions.ts, lib/utils/board.ts, or supabase/ — TASK-57 is active in those areas. Deletion only; no behavior change; shadcn files can be regenerated via shadcn add if ever needed again.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 All listed symbols/files are gone and grep shows no remaining references
- [x] #2 tsc --noEmit passes and the full vitest suite passes with the orphaned test blocks removed
- [x] #3 No file outside the listed ones is modified (in particular no board/, board actions, settings actions, lib/utils/board.ts, supabase/ changes)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Executed directly by the coordinator (Codex delegation was blocked twice by the permission classifier). All items deleted as listed, with two verification-driven precisions: (1) lib/utils/recurring.integration.test.ts is KEPT — it tests the live generate_recurring_stories RPC and does not import the deleted module; only recurring.ts + recurring.test.ts (unit tests of the dead TS functions) were removed. (2) kanban.test.ts's third flattenCurrentZone test existed only to exercise the deleted reorderPositions persist path and was removed with it. Also removed dead CSS selectors that only targeted deleted variants (card size=sm / card-footer / card-action / card-description selectors) and the lucide icon import used only by deleted dropdown items. Scope boundary held: no board/, board actions, settings actions, lib/utils/board.ts, or supabase/ changes (verified via git status against the concurrent TASK-57 session's files). Validation: grep shows zero remaining references; tsc --noEmit clean; full pnpm test 416 passed / 90 skipped, no failures.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: @claude-fable-5
created: 2026-07-16 04:21
---
Delegated to Codex (2026-07-16). TASK-51/57 are active in another session — this task's scope deliberately excludes components/features/board/, board actions, settings actions, lib/utils/board.ts, and supabase/. Codex runs with --write; verification (tsc + full vitest + scope check) by the coordinator.
---

author: @claude-fable-5
created: 2026-07-16 04:27
---
Codex delegation blocked twice by the permission classifier (agent-relayed bulk-deletion pattern); owner chose direct execution by the coordinator instead (2026-07-16). Same scope and boundaries apply.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Deleted ~500 lines of verified-dead code found by the 2026-07-16 ponytail audit: select.tsx and recurring.ts(+unit test) entirely, 8 unused dropdown-menu exports, unused Card/Badge/Button/Popover variants and exports, and 4 orphaned lib helpers with their tests. Verified with grep (zero references), tsc, and the full vitest suite.
<!-- SECTION:FINAL_SUMMARY:END -->
