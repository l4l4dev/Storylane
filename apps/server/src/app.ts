import { Hono } from "hono";
import type { Config } from "./config";
import { HttpError } from "./http-error";
import { requestLogger, type Logger } from "./log";
import { healthzRoute } from "./routes/healthz";

export interface AppDeps {
  config: Config;
  log: Logger;
  health: () => boolean;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use(requestLogger(deps.log));
  app.route("/", healthzRoute(deps.health));
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code }, err.status as 400);
    deps.log.error("unhandled", { message: err.message, stack: err.stack });
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
