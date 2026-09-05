import type { MiddlewareHandler } from "hono";

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(out: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (level: "info" | "error", msg: string, fields?: Record<string, unknown>) =>
    out(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
  return {
    info: (msg, fields) => emit("info", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

export function requestLogger(log: Logger): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    await next();
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Math.round((performance.now() - started) * 1000) / 1000,
      request_id: requestId,
    });
  };
}
