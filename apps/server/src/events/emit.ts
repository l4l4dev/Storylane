import type { Db } from "../db/client";
import type { Action } from "../authz/permissions";
import { withProject, type Actor, type NotPromise, type ProjectTx } from "../db/tx";
import type { EventBus } from "./bus";

export interface ChangeDeps {
  db: Db;
  bus: EventBus;
}

/**
 * Publishes only after withProject returns, i.e. after the transaction committed — a
 * subscriber that refetches on the event must not read pre-commit state. A throw skips the
 * publish, so a rolled-back change never announces itself.
 */
export function withProjectChange<T>(
  deps: ChangeDeps,
  actor: Actor,
  projectId: string,
  action: Action,
  fn: (tx: ProjectTx) => NotPromise<T>,
): T {
  // Captured from the authorized tx itself rather than reusing the caller's `projectId`: today
  // they are always equal, but publish should be structurally bound to what authorization
  // actually granted, not to the caller's own copy of the id.
  let authorizedId!: string;
  const result = withProject(deps.db, actor, projectId, action, (tx) => {
    authorizedId = tx.projectId;
    return fn(tx);
  });
  // A throw from fn (or from authorization itself) propagates out of withProject before this
  // line, so a rolled-back change never publishes.
  deps.bus.publish(authorizedId);
  return result;
}
