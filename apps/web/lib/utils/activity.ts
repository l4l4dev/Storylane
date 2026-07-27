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
    case "story.iteration_changed": {
      const from = payload.from_iteration_number != null ? `#${String(payload.from_iteration_number)}` : "the Icebox";
      const to = payload.to_iteration_number != null ? `#${String(payload.to_iteration_number)}` : "the Icebox";
      return `${log.actorName} moved ${story} from iteration ${from} to ${to}`;
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
