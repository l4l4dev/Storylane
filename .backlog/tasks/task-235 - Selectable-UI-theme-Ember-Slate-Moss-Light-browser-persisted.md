---
id: TASK-235
title: 'Selectable UI theme (Ember/Slate/Moss + Light), browser-persisted'
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-08-13 10:33'
updated_date: '2026-08-13 13:42'
labels:
  - frontend
  - design
milestone: m-7
dependencies: []
priority: medium
ordinal: 1700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-27 shipped one dark palette (Ember). Owner wants it extended to a user-selectable set of dark themes plus the existing light theme, browser-persisted only (next-themes localStorage/cookie, no DB column, no migration). Three dark palette proposals (Ember/Slate/Moss) were reviewed with the owner via an artifact preview — all three reuse Ember's exact lightness/saturation per fill tier (page/card/state-layer) and only rotate hue, so they inherit the fable-advisor-reviewed contrast recipe from doc-27 rather than needing a fresh contrast pass from scratch. See doc-27 (Backlog doc) for the full token recipe, the three-tier fill model, and the AA-contrast rules (state layer must not collapse onto the surface tier; muted-foreground needs >=4.5:1 against the state layer; input/boundary colors need >=3:1 where they are the only affordance cue). Reference hex values for Slate and Moss are in the theme-proposals artifact linked from this task's implementation session — re-derive and verify them against the same contrast rules at implementation time rather than trusting the artifact's swatches as final.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 next-themes theme list extended from light/dark to light + 3 named dark themes (Ember/Slate/Moss); Ember keeps today's exact values
- [x] #2 Slate and Moss get their own CSS token blocks in apps/web/app/globals.css following the same three-tier structure as .dark (Ember), each independently contrast-checked (state layer distinct from surface tier, muted-foreground >=4.5:1, input/boundary >=3:1 where it is the sole affordance cue)
- [x] #3 the sidebar's theme toggle (components/features/shell/mode-toggle.tsx) becomes a 5-item picker: Light/Ember/Slate/Moss/System (System restored per fable-advisor 2026-08-13 -- removing it dropped OS-auto-follow with no replacement)
- [x] #4 theme choice persists only in the browser (next-themes default storage) -- no profiles table column, no migration
- [x] #5 spec/ux-principles.md and Backlog doc-27 updated to document the shipped multi-theme token set
- [x] #6 pnpm test and pnpm run lint pass from apps/web/
- [x] #7 fable-advisor design review against spec/ux-principles.md runs before the task is marked done (contrast is the known risk area on this task)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend next-themes themes list to light/dark/slate/moss (layout.tsx); keep enableSystem+defaultTheme=system as implicit first-visit default only, not a menu choice.
2. Broaden @custom-variant dark to match .dark/.slate/.moss so dark:-gated Tailwind utilities apply under all three.
3. Restructure globals.css: hoist semantic tokens shared by all dark palettes (primary/destructive/success/ring/chart-*/sidebar-primary/sidebar-ring) into one '.dark, .slate, .moss {}' rule; trim .dark to its Ember neutrals; add .slate and .moss neutral blocks, hue-rotated from Ember at identical HSL L/S per tier, then re-verified with real WCAG contrast math (not trusted from the artifact) -- rebrighten any token that falls short of the doc-27 rules (state layer distinct from surface, muted-fg >=4.5:1, input >=3:1 where sole affordance).
4. Extend .dark .project-accent-N rules to :is(.dark,.slate,.moss) .project-accent-N (would otherwise silently fall back to light-mode accent colors under Slate/Moss).
5. Rewrite mode-toggle.tsx as a 4-item picker (Light/Ember/Slate/Moss) with a mounted-guarded checkmark on the resolved theme (useSyncExternalStore, not an effect -- avoids the set-state-in-effect lint rule and SSR hydration mismatch).
6. pnpm lint / pnpm test / pnpm run build; manual browser check of all 4 themes plus keyboard-focus visibility in a dropdown (the exact defect doc-27's first advisor round caught).
7. Update spec/ux-principles.md Design language + doc-27 to document the shipped multi-theme structure and final hex table.
8. fable-advisor design review against spec/ux-principles.md.

9. (post-advisor-round-2) Restore System as a 5th menu item per owner decision; switch checkmark comparison back to theme (resolvedTheme can't equal 'system'); add color-scheme:dark to the shared block (next-themes only sets it for literal light/dark theme names); add ARIA (role=menuitemradio, aria-checked); fix project-color.ts comment.
10. (post-advisor-round-3, final) Rebrighten Slate's state layer + muted-foreground (naive hue rotation undershot Ember/Moss's contrast due to WCAG's blue-luminance weighting); add mode-toggle.test.tsx regression test; fix two pre-existing spec/ux-principles.md inaccuracies (Inter->Geist, unqualified Shadows:none) surfaced by this pass's edits.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified: pnpm test (937 passed incl. new mode-toggle.test.tsx), pnpm run lint (0 errors), pnpm run build all pass from apps/web/. Manually driven in browser across all 5 themes (Light/Ember/Slate/Moss/System): confirmed keyboard-focus highlight visible in project switcher dropdown under every dark palette (the doc-27-round-1 defect), confirmed color-scheme:dark applies under Slate/Moss (native date-input/select-popup/scrollbar rendering), confirmed System resolves to OS preference and carries its own checkmark. Three fable-advisor (Opus) rounds: round 1 approve-with-corrections (color-scheme missing, no ARIA state, System-removal flagged for owner triage) -- all applied, owner chose to restore System as 5th item; round 2 (final confirmatory) approve-with-corrections (Slate's state layer/muted-fg still short of Ember/Moss's contrast due to WCAG blue-luminance weighting; no regression test for mode-toggle.tsx's theme/resolvedTheme choice, which broke twice today; two pre-existing spec/ux-principles.md inaccuracies surfaced) -- all applied. spec/ux-principles.md and Backlog doc-27 both updated with the full history and final per-palette hex table.

/code-review (medium effort, owner-run) surfaced one real gap all three advisor rounds missed: every review was scoped to dark mode, so nobody checked Light mode after the shadow-removal/boundary-strengthening changes. :root's --input was still equal to --border (~1.26:1 vs --card) even after becoming the sole boundary cue on shadow-free DropdownMenuContent/PopoverContent/Toast/NativeSelect. Fixed: :root --input -> oklch(0.62 0 0) (~3.64:1), which fixes all four call sites through the token alone. Also from the same review: Card's ring-foreground/10 -> ring-input (Dialog deliberately left as-is, per advisor's scrim reasoning); deduped mode-toggle.tsx's subscribeNever into lib/utils.ts's NOOP_SUBSCRIBE (already existed in my-work-sections.tsx); deduped the two TS theme-list copies (layout.tsx, mode-toggle.tsx) into lib/theme-config.ts's PALETTES (the 3 CSS spots stay hand-maintained, flagged with a ponytail: comment -- Tailwind v4 has no selector-list include mechanism); fixed a Code Comment Policy violation (history narration) in mode-toggle.test.tsx; documented the already-applied dark:disabled:bg-input/80 removal in Input/Textarea. One minor finding (hand-rolled ARIA radio vs Radix's DropdownMenuRadioGroup primitive) reviewed and left as-is -- tested and correct, not worth a new primitive for one caller. Re-verified: pnpm test (937 passed), lint (0 errors), build all pass; manually confirmed in browser that Light mode's card/dropdown boundaries are now visible.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended the sidebar theme toggle from a 3-item Light/Dark/System menu to a 5-item Light/Ember/Slate/Moss/System picker. Ember (doc-27's shipped palette) is unchanged; Slate (cool graphite) and Moss (desaturated green) are new hue-rotated dark palettes sharing Ember's three-tier fill structure and brand/status tokens, each independently verified against WCAG contrast math. Persistence is next-themes' default browser storage only -- no DB change. /code-review also caught and fixed a pre-existing Light-mode boundary-contrast gap (--input) that none of the dark-scoped advisor reviews could have found, plus two small dedup/comment cleanups. Verified with pnpm test/lint/build, three fable-advisor rounds, and one /code-review pass; doc-27 and spec/ux-principles.md carry the final token table and full corrections history.
<!-- SECTION:FINAL_SUMMARY:END -->
