import Link from "next/link";

// Shown after project creation when one or more invite_member calls failed
// but the project itself was still created (createProject, TASK-25/32) — a
// partial failure must stay visible instead of silently dropping the
// invite, wherever the creation flow's redirect lands (the dashboard, or
// now the new project's own board).
//
// `settingsHref` links "Project settings" to that project's actual settings
// page (spec/ux-principles.md principle 8: "stay put and offer a link")
// when the caller has a project id to link to (the board pages do; the
// dashboard's project-picker context doesn't, so it stays plain text there).
export function InviteFailedBanner({ count, settingsHref }: { count: number; settingsHref?: string }) {
  return (
    <p className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      Project created, but {count} invite{count === 1 ? "" : "s"} could not be sent. Invite them from{" "}
      {settingsHref ? <Link href={settingsHref} className="underline">Project settings</Link> : "Project settings"}{" "}
      instead.
    </p>
  );
}

/** Parses the `invite_failed` query param into a positive count, or null if absent/invalid. */
export function parseInviteFailedCount(raw: string | undefined): number | null {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
