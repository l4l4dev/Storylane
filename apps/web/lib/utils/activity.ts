// Pure, framework-free helpers for the activity log timeline. Kept
// side-effect free so they can be unit-tested without a Supabase client.

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
    case "story.promoted_to_epic": {
      const title = payload.title ? `"${String(payload.title)}"` : story;
      const taskCount = Number(payload.task_count ?? 0);
      return `${log.actorName} promoted ${title} to an epic with ${taskCount} new ${taskCount === 1 ? "story" : "stories"}`;
    }
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
    default:
      return log.storyTitle
        ? `${log.actorName} performed ${log.action} on ${story}`
        : `${log.actorName} performed ${log.action}`;
  }
}
