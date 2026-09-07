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
  const result = withProject(deps.db, actor, projectId, action, fn);
  deps.bus.publish(projectId);
  return result;
}
