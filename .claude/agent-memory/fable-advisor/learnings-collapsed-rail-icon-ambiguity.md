---
name: learnings-collapsed-rail-icon-ambiguity
description: When a surface collapses labels to icons (responsive rail, compact toolbar), check that no two remaining icons are the same glyph pointing at different destinations
metadata:
  type: feedback
---

When a review touches a change that hides labels and leaves icons (`hidden md:inline`,
icon rails, compact toolbars), diff the icon set that survives: two identical glyphs with
different destinations become indistinguishable, and the only differentiator left is
`title`/`aria-label` — hover, which touch users do not have.

**Why:** TASK-217 collapsed `app-sidebar.tsx` to a `w-14` rail below `md`. The project
section nav already used `Settings` (gear) for project settings, and the account trigger
was given `<Settings className="md:hidden" />` as its collapsed icon. Below `md` a project
page showed two identical gears 3 rows apart, one of which opened a menu containing
"Sign out". Neither `ux-principles.md` §1 nor §7 names this case literally, so it only
surfaces if you enumerate the collapsed state's icons deliberately.

**How to apply:** for any label-hiding diff, list what a user actually sees in the
collapsed state (not the JSX) and check for glyph collisions and for controls whose
meaning existed only in the removed text. Related: [[learnings-touch-fallback-must-be-touch-sized]]
(the same diff shipped a 32px `size="icon"` ModeToggle beside 44px siblings in the
touch-only layout), [[review-checklists]].
