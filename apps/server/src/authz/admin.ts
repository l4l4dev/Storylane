import type { Actor, UserActor } from "../db/tx";
import { HttpError } from "../http-error";

/**
 * The instance-admin plane (`users.is_admin`) is independent of project membership
 * (spec/permissions.md "Instance admin plane"): anonymous → 401, signed-in non-admin → 403.
 * `isAdmin` comes from the session lookup, not from the request.
 */
export function requireAdmin(actor: Actor): UserActor {
  if (actor.kind !== "user") throw new HttpError(401, "unauthenticated");
  if (!actor.isAdmin) throw new HttpError(403, "forbidden");
  return actor;
}
