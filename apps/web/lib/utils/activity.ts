// Pure, framework-free helpers for the activity log timeline. Kept
// side-effect free so they can be unit-tested without a Supabase client.

import { formatDate } from "./format";

export type ActivityLog = {
  action: string;
  payload: unknown;
  actorName: string;
  storyTitle: string | null;
};

/**
 * Whether the row has a real actor, i.e. someone who chose to do this.
 *
 * An automatic rollover is recorded against whichever member's page load
 * happened to trigger the lazy finalize, so describeActivity leaves them out of
 * the sentence. Anything else rendered from actor_id — an agent badge, an
 * avatar — has to make the same call, or the row names nobody and still points
 * at someone.
 */
export function hasActor(log: Pick<ActivityLog, "payload">): boolean {
  return ((log.payload ?? {}) as Record<string, unknown>).rollover !== "auto";
}

/**
 * The assignee ids a page of rows refers to, for the reader to resolve against
 * `profiles` under its own RLS.
 *
 * story.assignee_changed stores ids and no names on purpose: the trigger that
 * writes it is SECURITY DEFINER, so a name snapshotted there would reach
 * readers whose `shares_project_with` check would deny them the profile
 * (20260709000001). Resolving here means a former member's name is shown only
 * to those who could look it up anyway.
 */
export function assigneeIdsIn(logs: Pick<ActivityLog, "action" | "payload">[]): string[] {
  const ids = new Set<string>();
  for (const log of logs) {
    const payload = (log.payload ?? {}) as Record<string, unknown>;
    const keys =
      log.action === "story.assignee_changed"
        ? ["from_id", "to_id"]
        : log.action === "member.removed"
          ? ["removed_user_id"]
          : [];
    for (const key of keys) {
      if (typeof payload[key] === "string") ids.add(payload[key] as string);
    }
  }
  return [...ids];
}

/** Folds resolved names into a row's payload so describeActivity can label it. */
export function withAssigneeNames(payload: unknown, names: Map<string, string>): unknown {
  const p = (payload ?? {}) as Record<string, unknown>;
  return {
    ...p,
    from_name: typeof p.from_id === "string" ? (names.get(p.from_id) ?? null) : null,
    to_name: typeof p.to_id === "string" ? (names.get(p.to_id) ?? null) : null,
    removed_name: typeof p.removed_user_id === "string" ? (names.get(p.removed_user_id) ?? null) : null,
  };
}

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
    case "story.assignee_changed": {
      // A removed member's stories are unassigned by the composite FK's
      // ON DELETE SET NULL (20260730030000), so the actor here is whoever
      // removed them, not someone who edited the story.
      // Presence is read from the ids, never the names: display_name has no
      // non-empty constraint and the profile may be gone by the time this row
      // is read, and a missing name must not render as "nobody was assigned".
      const name = (value: unknown) => (value ? String(value) : "someone");
      const had = payload.from_id != null;
      const has = payload.to_id != null;
      if (!has) return `${log.actorName} unassigned ${story}${had ? ` from ${name(payload.from_name)}` : ""}`;
      if (!had) return `${log.actorName} assigned ${story} to ${name(payload.to_name)}`;
      return `${log.actorName} reassigned ${story} from ${name(payload.from_name)} to ${name(payload.to_name)}`;
    }
    case "member.removed": {
      // Stands in for the story.assignee_changed rows the FK cascade wrote, which
      // the feed filters out (20260804073330). The count comes from the payload
      // rather than from counting rows here: the collapsed rows are never fetched.
      const count = Number(payload.story_count ?? 0);
      const unassigned = count > 0 ? `, unassigning ${count} ${count === 1 ? "story" : "stories"}` : "";
      // A removed member no longer shares a project with the reader, so their
      // name resolves for nobody — "someone" is the normal case here, not the
      // edge one.
      const who = payload.removed_name ? String(payload.removed_name) : "someone";
      if (payload.self_leave === true) return `${log.actorName} left the project${unassigned}`;
      return `${log.actorName} removed ${who} from the project${unassigned}`;
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
