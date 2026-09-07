import { activityLogs } from "../db/schema";
import { newId } from "../id";
import { ProjectTx, type Actor, type Tx } from "../db/tx";

export const ACTIVITY_ACTIONS = [
  "project.created",
  "project.updated",
  "project.archived",
  "project.unarchived",
  "member.joined",
  "state.created",
  "state.updated",
  "state.reordered",
  "state.deleted",
  "story.created",
  "story.updated",
  "story.state_changed",
  "story.moved",
  "story.deleted",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEntry {
  action: ActivityAction;
  storyId?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Project creation and invite acceptance write activity before the actor is a member, so
 * withProject cannot authorize them; they pass this instead. Every other caller passes a
 * ProjectTx. Both shapes carry tx/projectId/actor, which is all this module needs.
 */
export interface BootstrapScope {
  readonly tx: Tx;
  readonly projectId: string;
  readonly actor: Actor;
}

export type ActivityScope = ProjectTx | BootstrapScope;

export function bootstrapScope(tx: Tx, projectId: string, actor: Actor): BootstrapScope {
  return { tx, projectId, actor };
}

const KNOWN = new Set<string>(ACTIVITY_ACTIONS);

/** The only writer of activity_logs. Runs inside the caller's transaction, never its own. */
export function recordActivity(scope: ActivityScope, entry: ActivityEntry): string {
  if (!KNOWN.has(entry.action)) throw new Error(`unknown activity action: ${entry.action}`);
  const id = newId();
  scope.tx
    .insert(activityLogs)
    .values({
      id,
      projectId: scope.projectId,
      storyId: entry.storyId ?? null,
      actorId: scope.actor.kind === "user" ? scope.actor.userId : null,
      action: entry.action,
      payload: entry.payload == null ? null : JSON.stringify(entry.payload),
      createdAt: Date.now(),
    })
    .run();
  return id;
}
