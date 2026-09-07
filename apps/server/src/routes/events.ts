import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { withProject, type Actor } from "../db/tx";
import type { ChangeDeps } from "../events/emit";

export const SSE_HEARTBEAT_MS = 20_000;

/**
 * Invalidation stream. Authorization runs *before* the stream opens, so a non-member gets a
 * plain 404 rather than an empty event stream.
 */
export function eventRoutes(deps: ChangeDeps & { actorOf: (c: Context) => Actor; heartbeatMs?: number }) {
  const heartbeatMs = deps.heartbeatMs ?? SSE_HEARTBEAT_MS;
  return new Hono().get("/api/projects/:id/events", (c) => {
    const projectId = c.req.param("id");
    withProject(deps.db, deps.actorOf(c), projectId, "project:read", (tx) => tx.projectId);
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let pending = 0;
      let closed = false;
      let wake: (() => void) | null = null;
      const unsubscribe = deps.bus.subscribe(projectId, () => {
        pending += 1;
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake?.();
      });
      try {
        while (!closed) {
          if (pending > 0) {
            // Coalesce: the client refetches everything it shows, so N changes need one event.
            pending = 0;
            await stream.writeSSE({
              event: "project.changed",
              data: JSON.stringify({ type: "project.changed", projectId }),
            });
            continue;
          }
          await Promise.race([
            new Promise<void>((resolve) => {
              wake = resolve;
            }),
            Bun.sleep(heartbeatMs),
          ]);
          wake = null;
          if (!closed && pending === 0) await stream.write(": heartbeat\n\n");
        }
      } finally {
        unsubscribe();
      }
    });
  });
}
