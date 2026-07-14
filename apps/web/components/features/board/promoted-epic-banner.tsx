import Link from "next/link";

// Shown on the board right after "Promote to Epic" (TASK-13, story-peek-menu.tsx)
// succeeds — the promoted story is deleted and the peek can no longer show it,
// so this is how the user learns where it went (spec/ux-principles.md
// principle 8: relations stay visible, don't silently eject the user out of
// context). Driven by `?promoted_epic=<id>&promoted_epic_name=<name>` on the
// board URL, following the same query-param-banner pattern as
// InviteFailedBanner.
export function PromotedEpicBanner({
  projectId,
  epicId,
  epicName,
}: {
  projectId: string;
  epicId: string;
  epicName: string;
}) {
  return (
    <p className="mb-4 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
      &ldquo;{epicName}&rdquo; promoted to a new epic.{" "}
      <Link href={`/projects/${projectId}/epics#${epicId}`} className="font-medium underline">
        View epic
      </Link>
    </p>
  );
}

export type PromotedEpic = { id: string; name: string };

/** Parses the `promoted_epic` / `promoted_epic_name` query params, or null if absent/invalid. */
export function parsePromotedEpic(
  rawId: string | undefined,
  rawName: string | undefined,
): PromotedEpic | null {
  if (!rawId || !rawName) {
    return null;
  }
  return { id: rawId, name: rawName };
}
