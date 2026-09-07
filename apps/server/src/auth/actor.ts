import type { Context } from "hono";
import type { Db } from "../db/client";
import type { Actor } from "../db/tx";
import { readSessionCookie } from "./cookies";
import { resolveSession } from "./sessions";

const ANONYMOUS: Actor = { kind: "anonymous" };

/** Cookie → Actor. An expired, revoked or disabled session reads as anonymous (→ 401). */
export function actorFromRequest(db: Db): (c: Context) => Actor {
  return (c) => {
    const secret = readSessionCookie(c);
    if (!secret) return ANONYMOUS;
    const session = resolveSession(db, secret);
    if (!session) return ANONYMOUS;
    return { kind: "user", userId: session.userId, isAdmin: session.isAdmin };
  };
}
