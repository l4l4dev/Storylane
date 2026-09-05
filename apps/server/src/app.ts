import { Hono, type Context } from "hono";
import type { Config } from "./config";
import { HttpError } from "./http-error";
import { requestLogger, type Logger } from "./log";
import { healthzRoute } from "./routes/healthz";
import { projectRoutes } from "./routes/projects";
import { failClosed } from "./authz/middleware";
import type { Db } from "./db/client";
import type { Actor } from "./db/tx";

export interface AppDeps {
  config: Config;
  log: Logger;
  health: () => boolean;
  db: Db;
  actorOf?: (c: Context) => Actor;
  /** Enables the `x-test-actor` header actor. Tests only — production leaves this false. */
  testActorHeader?: boolean;
}

const anonymous: Actor = { kind: "anonymous" };

function defaultActorOf(testActorHeader: boolean): (c: Context) => Actor {
  if (!testActorHeader) return () => anonymous;
  return (c) => {
    const raw = c.req.header("x-test-actor");
    if (!raw) return anonymous;
    try {
      const parsed = JSON.parse(raw) as Actor;
      if (parsed.kind === "user" && typeof parsed.userId === "string") {
        return { kind: "user", userId: parsed.userId, isAdmin: parsed.isAdmin === true };
      }
    } catch {
      // fall through to anonymous
    }
    return anonymous;
  };
}

export function createApp(deps: AppDeps): Hono {
  const actorOf = deps.actorOf ?? defaultActorOf(deps.testActorHeader === true);
  const app = new Hono();
  app.use(requestLogger(deps.log));
  // Narrow on purpose: the trailing wildcard also matches zero segments, so this covers
  // /api/projects/:id and everything below it, but not a future non-project-scoped
  // GET /api/projects (the caller's own project list).
  app.use("/api/projects/:id/*", failClosed());
  app.route("/", healthzRoute(deps.health));
  app.route("/", projectRoutes(deps.db, actorOf));
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code }, err.status as 400);
    deps.log.error("unhandled", { message: err.message, stack: err.stack });
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
