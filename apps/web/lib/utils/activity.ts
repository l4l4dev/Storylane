// Pure, framework-free helpers for the activity log timeline. Kept
// side-effect free so they can be unit-tested without a Supabase client.

import { formatDate } from "./format";

export type ActivityLog = {
  action: string;
  payload: unknown;
  actorName: string;
  storyTitle: string | null;
};

/** Human-readable description of an activity_logs row for the timeline. */
export function describeActivity(log: ActivityLog): string {
  const payload = (log.payload ?? {}) as Record<string, unknown>;
  const story = log.storyTitle ? `"${log.storyTitle}"` : "a story";

  switch (log.action) {
    case "story.created":
      return `${log.actorName} created ${story}`;
    case "story.state_changed":
      return `${log.actorName} moved ${story} from ${String(payload.from)} to ${String(payload.to)}`;
    case "story.column_changed": {
      const from = payload.from ? `"${String(payload.from)}"` : "no column";
      const to = payload.to ? `"${String(payload.to)}"` : "no column";
      return `${log.actorName} moved ${story} from ${from} to ${to}`;
    }
    case "comment.added":
      return `${log.actorName} commented on ${story}`;
    case "story.split": {
      const count = Number(payload.child_count ?? 0);
      return `${log.actorName} split ${story} into ${count} ${count === 1 ? "story" : "stories"}`;
    }
    case "story.containerized":
      return `${log.actorName} turned ${story} into an epic`;
    case "story.moved_out": {
      const title = payload.title ? `"${String(payload.title)}"` : story;
      return `${log.actorName} moved ${title} to another project`;
    }
    case "story.moved_in": {
      const title = payload.title ? `"${String(payload.title)}"` : story;
      return `${log.actorName} moved ${title} here from another project`;
    }
    case "story.copied_in": {
      const title = payload.title ? `"${String(payload.title)}"` : story;
      return `${log.actorName} copied ${title} here from another project`;
    }
    // story.iteration_rolled_over: the pre-rename action name
    // (20260727120000, superseded by 20260727140000) — same payload shape,
    // kept here so already-deployed rows stay readable in the feed.
    case "story.iteration_rolled_over":
    case "story.iteration_changed": {
      // No iteration means Backlog or Icebox, and iteration_id alone cannot
      // tell them apart — has_state does (Icebox stories have no state_id).
      // Rows written before 20260731000000 carry neither flag; those keep the
      // old ambiguous wording rather than guessing.
      const where = (num: unknown, hasState: unknown) =>
        num != null ? `iteration #${String(num)}` : hasState === true ? "the Backlog" : "the Icebox";
      const from = where(payload.from_iteration_number, payload.from_has_state);
      const to = where(payload.to_iteration_number, payload.to_has_state);
      // An 'auto' rollover is attributed to whichever member's page load
      // happened to trigger the lazy finalize, so naming them as the mover
      // would be wrong — the actor is dropped there. 'manual' is someone
      // deliberately finishing the iteration, so they keep the credit.
      //
      // story.iteration_rolled_over predates the marker and was only ever
      // written by finalize_iteration, so it is read as a rollover too. Those
      // rows cannot say which kind it was; 'auto' is the safer read, since a
      // lazy rollover happens on any page load while a manual finish is a
      // deliberate, rare click.
      if (payload.rollover === "auto" || log.action === "story.iteration_rolled_over") {
        return `${story} rolled over from ${from} to ${to}`;
      }
      if (payload.rollover === "manual") {
        return `${log.actorName} finished ${from}, rolling ${story} over to ${to}`;
      }
      return `${log.actorName} moved ${story} from ${from} to ${to}`;
    }
    case "story.points_changed": {
      const to = payload.to;
      const from = payload.from;
      if (typeof to !== "number") return `${log.actorName} removed the estimate from ${story}`;
      if (typeof from !== "number") return `${log.actorName} estimated ${story} at ${to} points`;
      return `${log.actorName} re-estimated ${story} from ${from} to ${to} points`;
    }
    case "iteration.length_overridden":
      return `${log.actorName} moved iteration #${String(payload.number)}'s end date from ${formatDate(String(payload.from))} to ${formatDate(String(payload.to))}`;
    case "iteration.reshaped":
      return `${log.actorName} reshaped iteration #${String(payload.number)} to the new cadence (ends ${formatDate(String(payload.to))})`;
    case "project.cadence_changed":
      return `${log.actorName} changed the iteration length from ${String(payload.from)} to ${String(payload.to)} days`;
    default:
      return log.storyTitle
        ? `${log.actorName} performed ${log.action} on ${story}`
        : `${log.actorName} performed ${log.action}`;
  }
}
