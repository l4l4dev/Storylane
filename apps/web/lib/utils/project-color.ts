// Deterministic project -> accent color (doc-12 Thread A). A project-identity
// color, not a My-Work-local one: the same mapping is meant to reach the
// sidebar switcher / dashboard cards in a later task, so it lives here (shared)
// rather than inline in a component. No projects.color DB column — the id hash
// is enough until per-project color needs to be owner-customizable (YAGNI).
//
// The eight hues are the dataviz skill's validated categorical palette
// (references/palette.md; light+dark steps live in globals.css as
// .project-accent-N / .dark .project-accent-N, exposing a --project-accent
// custom property). This is an ACCENT, not a data encoding: with more than
// eight projects the hash collides (two projects share a color), and hashing
// can place any two slots adjacent (the palette's CVD ordering only guarantees
// *neighbouring* slots), so the project-name badge on every row is the primary
// identity signal and the color is a secondary aid — acceptable for an accent.
//
// Use --project-accent for BACKGROUNDS and BORDERS only, never as text color:
// several palette slots fall below WCAG 4.5:1 as text on the light card
// surface. Reuses in the sidebar/dashboard must follow the same rule.

export const PROJECT_ACCENT_COUNT = 8;

/** Stable, order-independent hash of a project id into 1..PROJECT_ACCENT_COUNT. */
export function projectAccentSlot(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    // djb2-ish; `| 0` keeps it a 32-bit int so long ids don't lose precision.
    hash = (hash * 33 + projectId.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % PROJECT_ACCENT_COUNT) + 1;
}

/** The globals.css class that sets `--project-accent` for this project. */
export function projectAccentClass(projectId: string): string {
  return `project-accent-${projectAccentSlot(projectId)}`;
}
