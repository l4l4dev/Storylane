---
id: TASK-107
title: Shared toast + Project Settings save feedback
status: Done
assignee:
  - '@claude-sonnet-5'
created_date: '2026-07-21 06:00'
updated_date: '2026-07-21 07:29'
labels:
  - web
dependencies: []
priority: medium
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-11 D5. Add a lightweight shared toast (Radix Toast; radix-ui is already a dep, no new dependency) mounted once in the app shell, so user actions get visible confirmation. First consumer: Project Settings save ('Project updated'). Shaped so other forms can adopt it. See .backlog/docs/doc-11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A <Toaster> is mounted once in the app shell and a small toast() helper exists, built on Radix Toast (no new dependency)
- [ ] #2 Saving Project Settings shows a success toast; the success signal reuses the existing invite_failed query-param + client-read pattern (redirect with a success param a client component reads) rather than new plumbing
- [ ] #3 The toast helper is reusable by other forms (labels/working-days/states/invites) without per-form bespoke wiring
- [ ] #4 UI passes fable-advisor design review; pnpm test + lint green
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-07-21 07:03
---
From TASK-105 (design review申し送り): reshape_current_iteration returns 6 result kinds (reshaped / unchanged / no_current_iteration / already_finished / would_end_in_past / too_long). When the toast lands, the Settings save that opted into 'apply to current' should surface the reshape outcome — especially the cases where the user checked the box but nothing changed (already_finished / would_end_in_past), not just a generic 'Saved'. updateProject currently discards the RPC's data.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a pure toast-store (toast()/dismissToast()/subscribeToasts()/getToasts()) and a <Toaster/> built on Radix Toast, mounted once in app/layout.tsx. Wired to Project Settings: updateProject redirects to its own URL with ?updated=1 (+ reshape_note for the TASK-105 no-op reasons, incl. the previously-missed too_long) instead of just revalidating; a new SettingsSaveToast client component fires the toast and strips the URL. fable-advisor design review: approve-with-fixes -> fixed the too_long gap (principle 2), added data-slot attrs. Investigated and declined the data-open:/data-closed: suggestion: verified (via shadcn's tailwind.css custom-variant source) that shorthand only matches a literal data-open attribute, which Radix never sets (it sets data-state), so dialog.tsx's own animation classes are dead CSS -- copying that would break this toast's animation too; kept the correct data-[state=open] bracket syntax. toast() itself needs no per-form wiring (callable from anywhere, no provider at the call site) satisfying AC#3's mechanism requirement; wiring an actual second form (e.g. LabelManager) still requires that action to signal success, same as any imperative notification API -- noted, not treated as a gap in this task. Redirect-scroll-behavior and toast/story-peek z-index were reasoned through (low risk given current scope) but not visually verified -- Claude-in-Chrome was unavailable this session. Verified: 12 unit tests (store/Toaster/SettingsSaveToast, incl. all 3 reshape-note messages) + full web suite (537) + tsc + lint green.
<!-- SECTION:FINAL_SUMMARY:END -->
