import type { MiddlewareHandler } from "hono";

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(out: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (level: "info" | "warn" | "error", msg: string, fields?: Record<string, unknown>) =>
    out(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

/**
 * A route's secret path segment must never reach the logs: `docker logs` is readable by anyone
 * with host access, and the token in these paths is the entire authorization for the request.
 * `/api/auth/reset/:token` arrives in Task 8b — redacted here already so it is covered from day
 * one instead of needing a second pass through this file.
 *
 * The trailing `(\/.*)?` swallows anything after the token (a stray slash, an unmatched
 * sub-path Hono answers 404 for): the token still occupies that first segment and must still be
 * masked, and requestLogger logs the path regardless of the response status.
 *
 * `/reset/:token` and `/invite/:token` (no `/api` prefix) are the SPA's own routes (Task 9a,
 * `apps/web/src/app-routes.tsx`): the browser's GET for the page itself carries the same clear
 * token in its path and goes through this same `requestLogger`, served by app.ts's SPA-fallback
 * catch-all — so they need the identical masking as their `/api/...` counterparts.
 */
const SECRET_PATH_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/^(\/api\/invites)\/[^/]+(\/accept)?(\/.*)?$/, "$1/:token$2"],
  [/^(\/api\/auth\/reset)\/[^/]+(\/.*)?$/, "$1/:token"],
  [/^(\/invite)\/[^/]+(\/.*)?$/, "$1/:token"],
  [/^(\/reset)\/[^/]+(\/.*)?$/, "$1/:token"],
];

export function redactPath(path: string): string {
  for (const [pattern, replacement] of SECRET_PATH_PATTERNS) {
    if (pattern.test(path)) return path.replace(pattern, replacement);
  }
  return path;
}

export function requestLogger(log: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    await next();
    log.info("request", {
      method: c.req.method,
      path: redactPath(c.req.path),
      status: c.res.status,
      duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
      request_id: requestId,
    });
  };
}
