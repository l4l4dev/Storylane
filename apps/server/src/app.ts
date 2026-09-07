import { Hono, type Context } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import type { Config } from "./config";
import { HttpError } from "./http-error";
import { requestLogger, type Logger } from "./log";
import { healthzRoute } from "./routes/healthz";
import { projectRoutes } from "./routes/projects";
import { storyRoutes } from "./routes/stories";
import { eventRoutes } from "./routes/events";
import { failClosed } from "./authz/middleware";
import { EventBus } from "./events/bus";
import { authRoutes } from "./routes/auth";
import { setupRoutes } from "./routes/setup";
import { setupGate } from "./setup/gate";
import { csrfGuard } from "./auth/csrf";
import type { RateLimiter } from "./auth/rate-limit";
import type { Db } from "./db/client";
import type { Actor } from "./db/tx";

const DEFAULT_STATIC_ROOT = fileURLToPath(new URL("../../web/dist", import.meta.url));

export interface AppDeps {
  config: Config;
  log: Logger;
  health: () => boolean;
  db: Db;
  actorOf?: (c: Context) => Actor;
  /** Login limiters; tests inject a fake clock. Defaults to LOGIN_LIMITS with the real clock. */
  limiters?: { ip: RateLimiter; email: RateLimiter };
  /** POST /api/setup limiter; tests inject a fake clock. Defaults to the real clock. */
  setupLimiter?: RateLimiter;
  /** Enables the `x-test-actor` header actor. Tests only — production leaves this false. */
  testActorHeader?: boolean;
  /** Directory holding the built SPA (index.html + assets). Defaults to apps/web/dist. */
  staticRoot?: string;
  /** In-process invalidation bus. Defaults to a fresh one per app. */
  bus?: EventBus;
  /** SSE heartbeat interval; tests shorten it. Defaults to SSE_HEARTBEAT_MS. */
  heartbeatMs?: number;
  /** Per-user concurrent SSE stream cap; tests shrink it. Defaults to SSE_MAX_STREAMS_PER_USER. */
  maxStreamsPerUser?: number;
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
  const bus = deps.bus ?? new EventBus();
  const app = new Hono();
  app.use(requestLogger(deps.log));
  // Narrow on purpose: the trailing wildcard also matches zero segments, so this covers
  // /api/projects/:id and everything below it, but not a future non-project-scoped
  // GET /api/projects (the caller's own project list).
  // Before failClosed: a request rejected for CSRF must never reach the authorization scope.
  app.use("/api/*", csrfGuard(deps.config));
  // While the instance has no user, every /api/* route except /api/setup itself answers
  // setup_required (checked after csrfGuard, so a CSRF-invalid call still gets a CSRF error).
  app.use("/api/*", setupGate(deps.db));
  app.use("/api/projects/:id/*", failClosed());
  app.route("/", healthzRoute(deps.health));
  app.route("/", setupRoutes({ db: deps.db, config: deps.config, ...(deps.setupLimiter ? { limiter: deps.setupLimiter } : {}) }));
  app.route(
    "/",
    authRoutes({ db: deps.db, config: deps.config, ...(deps.limiters ? { limiters: deps.limiters } : {}) }, actorOf),
  );
  app.route("/", projectRoutes({ db: deps.db, bus, actorOf }));
  app.route("/", storyRoutes({ db: deps.db, bus, actorOf }));
  app.route(
    "/",
    eventRoutes({
      db: deps.db,
      bus,
      actorOf,
      ...(deps.heartbeatMs === undefined ? {} : { heartbeatMs: deps.heartbeatMs }),
      ...(deps.maxStreamsPerUser === undefined ? {} : { maxStreamsPerUser: deps.maxStreamsPerUser }),
    }),
  );
  const staticRoot = deps.staticRoot ?? DEFAULT_STATIC_ROOT;
  if (existsSync(staticRoot)) {
    // hono/bun's serveStatic resolves `root` relative to process.cwd(), not to this file —
    // rebase an absolute staticRoot onto cwd so it works regardless of caller cwd.
    app.use("/*", serveStatic({ root: relative(process.cwd(), staticRoot) }));
    app.get("/*", (c) => {
      if (c.req.path.startsWith("/api/")) return c.json({ error: "not_found" }, 404);
      return c.html(Bun.file(join(staticRoot, "index.html")).text());
    });
  }
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code }, err.status as 400);
    deps.log.error("unhandled", { message: err.message, stack: err.stack });
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
