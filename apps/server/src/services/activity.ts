import { activityLogs } from "../db/schema";
import { newId } from "../id";
import { ProjectTx, type Actor, type Tx } from "../db/tx";

export const ACTIVITY_ACTIONS = [
  "project.created",
  "project.updated",
  "project.archived",
  "project.unarchived",
  "member.invited",
  "member.invite_revoked",
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

/** Not exported: only this module can produce a value of this type. */
const CREATE_TOKEN = Symbol("BootstrapScope");

/**
 * Project creation and invite acceptance write activity before the actor is a member, so
 * withProject cannot authorize them; they pass this instead. Every other caller passes a
 * ProjectTx. Both shapes carry tx/projectId/actor, which is all this module needs.
 *
 * A private field (not just a private constructor) makes this nominal: a plain
 * `{ tx, projectId, actor }` literal no longer structurally satisfies BootstrapScope,
 * so bootstrapScope() stays the only way to produce one (same pattern as ProjectTx).
 */
export class BootstrapScope {
  #tx: Tx;

  private constructor(
    tx: Tx,
    readonly projectId: string,
    readonly actor: Actor,
  ) {
    this.#tx = tx;
  }

  get tx(): Tx {
    return this.#tx;
  }

  /** @internal — bootstrapScope() calls this; the token makes it the only possible caller. */
  static _create(token: typeof CREATE_TOKEN, tx: Tx, projectId: string, actor: Actor): BootstrapScope {
    if (token !== CREATE_TOKEN) throw new Error("BootstrapScope is created by bootstrapScope() only");
    return new BootstrapScope(tx, projectId, actor);
  }
}

export type ActivityScope = ProjectTx | BootstrapScope;

export function bootstrapScope(tx: Tx, projectId: string, actor: Actor): BootstrapScope {
  return BootstrapScope._create(CREATE_TOKEN, tx, projectId, actor);
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
