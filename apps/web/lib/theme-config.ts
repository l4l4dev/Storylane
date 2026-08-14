// Single source of truth for the app's explicit theme list (TASK-235) — used
// by next-themes' `themes` prop (app/layout.tsx) and the picker's menu
// (components/features/shell/mode-toggle.tsx, which appends "System" itself;
// next-themes appends that one automatically via enableSystem, so it isn't
// part of this list). Adding a palette here still means also adding its CSS
// block in globals.css (.dark/.slate/.moss, the shared token selector, the
// @custom-variant list, and the project-accent overrides) — those can't be
// generated from this array without a build step, so stay disciplined by hand.
export const PALETTES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Ember" },
  { value: "slate", label: "Slate" },
  { value: "moss", label: "Moss" },
] as const;
