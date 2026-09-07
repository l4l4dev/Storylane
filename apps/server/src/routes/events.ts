import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { withProject, type Actor } from "../db/tx";
import { HttpError } from "../http-error";
import type { ChangeDeps } from "../events/emit";

export const SSE_HEARTBEAT_MS = 20_000;

/** Bounds one user's fan-out across tabs/devices; a runaway client cannot pin the process open. */
export const SSE_MAX_STREAMS_PER_USER = 20;

/**
 * Invalidation stream. Authorization runs *before* the stream opens, so a non-member gets a
 * plain 404 rather than an empty event stream.
 */
export function eventRoutes(
  deps: ChangeDeps & { actorOf: (c: Context) => Actor; heartbeatMs?: number; maxStreamsPerUser?: number },
) {
  const heartbeatMs = deps.heartbeatMs ?? SSE_HEARTBEAT_MS;
  const maxStreamsPerUser = deps.maxStreamsPerUser ?? SSE_MAX_STREAMS_PER_USER;
  // Lives for the app's lifetime, not the request's — one map shared by every connection this
  // process holds, keyed by user id.
  const streamCounts = new Map<string, number>();

  return new Hono().get("/api/projects/:id/events", (c) => {
    const actor = deps.actorOf(c);
    const authorizedId = withProject(deps.db, actor, c.req.param("id"), "project:read", (tx) => tx.projectId);
    // withProject throws 401 for an anonymous actor before returning, so reaching here means
    // actor is a UserActor; the check just gives TypeScript the same fact.
    if (actor.kind !== "user") throw new Error("unreachable: withProject only returns for a user actor");
    const userId = actor.userId;

    const current = streamCounts.get(userId) ?? 0;
    if (current >= maxStreamsPerUser) throw new HttpError(503, "too_many_streams");
    streamCounts.set(userId, current + 1);
    let released = false;
    const releaseSlot = (): void => {
      if (released) return;
      released = true;
      const remaining = (streamCounts.get(userId) ?? 1) - 1;
      if (remaining <= 0) streamCounts.delete(userId);
      else streamCounts.set(userId, remaining);
    };

    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let pending = 0;
      let closed = false;
      let waitResolve: (() => void) | null = null;
      let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;

      // Cancels whatever timer is outstanding and resolves the loop's current wait, whatever
      // woke it — a subscription firing must not leave the heartbeat timer it interrupted alive.
      const wake = (): void => {
        if (heartbeatTimer !== undefined) {
          clearTimeout(heartbeatTimer);
          heartbeatTimer = undefined;
        }
        const resolve = waitResolve;
        waitResolve = null;
        resolve?.();
      };
      const finish = (): void => {
        if (closed) return;
        closed = true;
        wake();
      };

      const unsubscribe = deps.bus.subscribe(authorizedId, () => {
        pending += 1;
        wake();
      });
      stream.onAbort(finish);
      // Belt and suspenders: some runtimes/clients never drive StreamingApi's own abort path
      // (the underlying request can be aborted without the response body reader ever being
      // cancelled) — without this listener the bus subscription and the stream slot below would
      // leak for the life of the process.
      c.req.raw.signal.addEventListener("abort", finish, { once: true });

      try {
        while (!closed && !stream.aborted && !stream.closed) {
          if (pending > 0) {
            // Coalesce: the client refetches everything it shows, so N changes need one event.
            pending = 0;
            await stream.writeSSE({
              event: "project.changed",
              data: JSON.stringify({ type: "project.changed", projectId: authorizedId }),
            });
            continue;
          }
          await new Promise<void>((resolve) => {
            waitResolve = resolve;
            heartbeatTimer = setTimeout(() => {
              heartbeatTimer = undefined;
              resolve();
            }, heartbeatMs);
          });
          if (!closed && pending === 0) await stream.write(": heartbeat\n\n");
        }
      } finally {
        c.req.raw.signal.removeEventListener("abort", finish);
        wake();
        unsubscribe();
        releaseSlot();
      }
    });
  });
}
