import { ensureCurrentIteration } from "@/app/projects/[id]/board/actions";

// Shared by every page that lists projects and needs their current iteration
// up to date before reading it (spec/velocity.md "Automatic scheduling &
// rollover") — currently the dashboard and My Work. Server-page-only: not
// framework-free (calls the ensureCurrentIteration Server Action), so it
// lives here rather than in lib/utils/iterations.ts, which client components
// also import.

/** Tracker projects that should be rolled over on this page load — excludes archived ones. */
export function projectsNeedingRollover<T extends { archived_at: string | null }>(
  projects: readonly T[],
): T[] {
  return projects.filter((p) => p.archived_at === null);
}

/**
 * Rolls over one project's current iteration, swallowing any failure (e.g. a
 * transient DB error, or a genuinely broken iteration state on that one
 * project) so a batched `Promise.all` over many projects never rejects
 * because of a single project's rollover failure — the caller simply reads
 * whatever iteration data was already there, possibly stale by one rollover.
 */
export async function rolloverIterationSafely(projectId: string): Promise<void> {
  try {
    await ensureCurrentIteration(projectId);
  } catch {
    // Intentionally ignored — see comment above.
  }
}
