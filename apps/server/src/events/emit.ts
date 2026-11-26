import type { Db } from "../db/client";
import type { Action } from "../authz/permissions";
import { withProject, type Actor, type NotPromise, type ProjectTx } from "../db/tx";
import type { EventBus } from "./bus";
import type { Logger } from "../log";
import { projectVersion, projectVersionIfPresent } from "../services/activity";

export interface ChangeDeps {
  db: Db;
  bus: EventBus;
  log: Logger;
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
  let version = 0;
  const result = withProject(deps.db, actor, projectId, action, (tx) => {
    authorizedId = tx.projectId;
    // Read unconditionally (one primary-key lookup): a project:delete leaves no row behind, so
    // the pre-callback value is the only basis for a deletion event's version.
    const before = projectVersion(tx);
    const out = fn(tx);
    const after = projectVersionIfPresent(tx);
    // A deleted project cannot bump its own counter, yet the event must still outrank every
    // version already published, or a client treating it as a monotonic cursor drops the
    // deletion and keeps showing the project.
    version = after ?? before + 1;
    // Development only, on purpose: in production a missing history row must not turn into a
    // failed request. The condition is the version, not a row count, because that is the number
    // the SSE event and since_version are built on.
    //
    // A no-op write is legitimate (a repeated follow, a drag that resolves to the story's own
    // position, an empty settings PUT all correctly leave the version untouched), so this can
    // only warn, never throw: a throw here would turn a correct 200 into a 500.
    if (process.env.NODE_ENV === "development" && version === before) {
      deps.log.warn(`${action} completed without recording activity`);
    }
    return out;
  });
  // A throw from fn (or from authorization itself) propagates out of withProject before this
  // line, so a rolled-back change never publishes.
  deps.bus.publish(authorizedId, version);
  return result;
}
