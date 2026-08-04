---
id: TASK-217
title: 'Audit responsive layout, accessibility, and performance'
status: In Progress
assignee:
  - '@claude-opus-5'
created_date: '2026-07-27 06:18'
updated_date: '2026-08-04 10:46'
labels: []
milestone: m-2
dependencies: []
priority: low
type: task
ordinal: 5200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Complete the residual Web polish scope left unplanned when the original Task 13 was narrowed: responsive support, accessibility audit, and performance review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Responsive behavior is reviewed and required fixes are implemented
- [x] #2 Accessibility is audited and required fixes are implemented
- [x] #3 Performance is reviewed and required fixes are implemented
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED 2026-08-04. Audited all three dimensions and fixed what the audit actually found; ended with the mandatory fable-advisor design review against spec/ux-principles.md (verdict = approved with corrections, all applied).

RESPONSIVE (AC#1) — two real defects, both page-level horizontal overflow:
 1. The shell sidebar was a fixed w-56 shrink-0, so at 375px the content column got 151px — narrower than a single board column. Collapsed to an icon rail below md (w-14 md:w-56): labels hidden, aria-label + title carrying the name, min-h-11 below md so the rail's targets are touch-sized where it exists for touch (ux-principles §7); wordmark hidden below md (/dashboard stays reachable via the switcher's visible 'All projects').
 2. /projects/[id]/epics overflowed by 98px: its left pane was w-80 shrink-0 (320px) inside a 271px column. Stacked below md, side by side from md up.
Rejected: a drawer + hamburger. components/ui/ has no sheet/drawer primitive and no layout has a top bar to hold a hamburger, so it would mean a new primitive, focus trap, open/close state and a header in all three layouts — and every navigation would cost two taps instead of one. The rail is CSS only. (Advisor concurred, with reasoning recorded.)
Content areas were otherwise clean: grids are all grid-cols-1 with sm:/lg: escalation.

ACCESSIBILITY (AC#2) — enabled eslint-plugin-jsx-a11y's recommended ruleset (already in the tree via eslint-config-next; promoted to a direct devDependency so it resolves). Rules only, not the flat config — core-web-vitals already registers the plugin and a second registration is a hard config error. 16 findings triaged:
 - ONE REAL DEFECT FIXED: split-studio's description read the selection from onMouseUp, so 'Extract selection as new story' was pointer-only — caret browsing, assistive tech and touch selection could not reach it. Replaced with a document selectionchange listener. A selection landing outside the paragraph leaves the last value alone: clicking the Extract button itself moves the selection out, and clearing there would disable the button before its own click landed.
 - no-autofocus (14): rule turned off, with the reason in the config. Every site is an input that does not exist until the user clicks the affordance revealing it (quick-add, inline rename); 'fixing' them would make every inline edit cost two clicks. The rule targets autoFocus on load, of which this codebase has none.
 - no-static-element-interactions (1): local disable in draft-story-card. The div is a shortcut scope catching Esc/Cmd+S bubbling from real inputs, not a control.
The ruleset now runs in CI, so this is enforced rather than re-audited by hand.

PERFORMANCE (AC#3) — projects/[id]/settings issued four independent queries serially (members, labels, project_states, calendar_exceptions): 7 round trips down to 4 via Promise.all, the pattern board/ and my-work/ already use. integrations stays sequential (it depends on the owner check). The daily-use screens were already batched, so nothing to do there. my-work/archive's one saveable round trip was left alone as not worth the change; its unbounded fetch already carries a ponytail: marker from an earlier review.

DESIGN REVIEW CORRECTIONS APPLIED:
 - Two identical gear glyphs would have sat unlabelled in the 56px rail (NAV_ITEMS' project Settings and the account trigger's collapsed icon), told apart only by a tooltip, with Sign out behind one of them. Account trigger now uses CircleUser.
 - ModeToggle stayed 32px in the same bottom row that had just been made touch-sized: size-11 md:size-8.
 - The selectionchange comment claimed shift+arrow worked. It does not — the paragraph is a plain <p> with no tabIndex, so plain keyboard selection needs caret browsing on. Comment corrected to the modalities that actually reach it, noting what keeps this from being a dead end (the disabled button states its reason in place, and '+ new story' is the other way in).
 - The advisor also asked for setSelectedText('') in handleExtractSelection to stop repeat-extract duplicates. VERIFIED AND NOT APPLIED: split-studio.tsx already clears it there (line 97), and removeAllRanges on the next line leaves rangeCount 0, so the new listener returns early rather than repopulating. The finding does not hold.
 - Advisor's F4 was correct that 'no fixed min-widths in the content area' was inaccurate: kanban-board's inline editors carry min-w-56. They survive 375px by riding a flex-wrap row, so the E2E now opens the iteration-goal editor and re-checks, making that reading honest.

Verification: SUPABASE_INTEGRATION=1 pnpm test 144 files / 1313 tests green, lint (with the a11y rules on) clean, tsc clean. e2e/narrow-viewport.spec.ts walks 7 screens plus one open inline editor at 375px asserting documentElement never overflows; full Playwright suite 2/2 green on a clean run.

INCIDENTAL FINDING (not part of this task): the local E2E suite had been unrunnable for 7 days. A next-server started 2026-07-28 was still holding port 3000 with a broken module graph (it mixed node_modules/.deno/next with node_modules/.pnpm/next, so hydration died and no onClick ever attached), and playwright.config.ts's reuseExistingServer: !CI kept reusing it — which is why core-flow.spec.ts failed at the dev-login step too, identically and unrelated to any change here. Killed the stale process; both specs pass. CI was never affected (reuseExistingServer is false there).

Assignee changed from @claude-sonnet-5 to @claude-opus-5: implemented in an Opus session (the owner had switched models for TASK-195/229, which precede this in the queue), not because a review found the Sonnet output wanting.

Final Summary:
--------------------------------------------------
Audited responsive/a11y/performance and fixed what the audit found: two page-level horizontal overflows at 375px (the fixed-width shell sidebar, now an icon rail below md; the epics page's fixed left pane, now stacked), one real a11y defect (Split Studio's extract-selection was pointer-only, now driven by selectionchange), and the settings page's four serial queries (7 round trips to 4). Enabled jsx-a11y's recommended ruleset in CI so this stays enforced; the 15 remaining findings were triaged as false positives with the reasons recorded in config and code. fable-advisor design review passed with corrections, all applied (one of its findings verified as not holding). 1313 unit/integration tests, lint, tsc and the full Playwright suite green.

/code-review high (2026-08-04) FINDINGS FIXED — five of the ten landed on this task's surface, all in the same follow-up commit:

1. THE SELECTION FIX WAS ONLY HALF RIGHT (split-studio.tsx). The selectionchange guard required BOTH anchorNode and focusNode inside the description <p>, so any selection straddling the paragraph boundary was dropped: a triple-click (browsers promote the range end past the <p>), Cmd+A, or a drag past the last line. The button then either stayed disabled or extracted a previously captured shorter phrase while the whole paragraph read as highlighted — a child story whose text was not what the user selected. Now the range is clipped to the paragraph (compareBoundaryPoints + setStart/setEnd against a range over the node contents) instead of rejected, and only a selection that misses the paragraph entirely (intersectsNode false) leaves the last value alone.
   The three selection tests were rewritten off real text offsets rather than a stubbed Selection.toString(), which is both closer to a browser and the only way to test clipping at all; the two new ones were confirmed to fail against the previous implementation before being kept.
   fable-advisor pass on the behavior (spec/ux-principles.md): approved as-is. It explicitly rejected the alternative of only clipping when the selection STARTED inside the paragraph — Cmd+A puts both boundaries outside, so that gate would reintroduce this very defect (principle 1, a dead control). It also rejected adding a preview of what will be extracted: the child card IS the preview, appearing immediately and editable, and a conditional preview block would shift the layout on every selection (principle 3). Its one requested addition, a test pinning that a caret collapsing INSIDE the paragraph still clears the value, is in.

2. THE A11Y RULESET COULD KILL THE WHOLE LINT RUN (eslint.config.mjs). The new rules object had no files key, but eslint-config-next registers the jsx-a11y plugin for .js/.jsx/.mjs/.ts/.tsx/.mts/.cts and NOT .cjs — so the first .cjs file added under apps/web (a postcss.config.cjs, a scripts/*.cjs) would abort ESLint repo-wide with 'could not find plugin', taking out the exact CI gate this task added. Scoped to **/*.{jsx,tsx}, which is also where the rules can apply at all. Verified by linting a throwaway .cjs: exit 2 before, exit 0 after.

3. no-autofocus was turned off for the entire app to excuse 14 uses that all live under components/features/**. Rescoped the off to that glob, so app/** — which holds the forms that render on navigation, login and invite-accept — stays covered. Verified both directions: the rule now errors on an autoFocus under app/ and stays silent under components/features/.

4. The new e2e spec had copied core-flow.spec.ts's login + create-project block verbatim, including a throw that the preceding toHaveURL assertion already made unreachable. Extracted loginAsDevUser / createProjectViaUI into e2e/helpers/flows.ts (the directory already existed for admin-client.ts) and both specs now call them; the whole Playwright suite passes on the refactor.

5. Comment-policy violations in this task's own output: narrow-viewport.spec.ts narrated TASK-217 and the pre-change w-56 sidebar, and eslint.config.mjs carried a bare (TASK-217). Both rewritten to state the constraint the file actually holds. Same pass fixed the equivalent framing in split-studio.test.tsx, where a comment claimed shift+arrow reaches the extract path and so contradicted the corrected source comment beside it.

NOT FIXED, reported to the owner instead: the same discarded-read-error pattern that hid finding 1 also exists in app/dashboard/page.tsx and app/my-work/archive/page.tsx (3 spots). No dead query is hiding behind those — they would only turn a transient failure into an empty list — and there is no single seam to guard, so it is a sweep rather than a root-cause fix. Left for the owner to decide whether it earns a task.

Also flagged by the advisor as pre-existing and out of scope: split-studio's 'Select text above...' hint appears and disappears with the selection, pushing the Tasks section down (principle 3 wants the space reserved).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Audited responsive/a11y/performance and fixed what the audit found: two page-level horizontal overflows at 375px (the fixed-width shell sidebar, now an icon rail below md; the epics page's fixed left pane, now stacked), one real a11y defect (Split Studio's extract-selection was pointer-only, now driven by selectionchange), and the settings page's four serial queries (7 round trips to 4). Enabled jsx-a11y's recommended ruleset in CI so this stays enforced; the 15 remaining findings were triaged as false positives with the reasons recorded in config and code. fable-advisor design review passed with corrections, all applied (one of its findings verified as not holding). 1313 unit/integration tests, lint, tsc and the full Playwright suite green.
<!-- SECTION:FINAL_SUMMARY:END -->
