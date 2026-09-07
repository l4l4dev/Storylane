import type { Context, MiddlewareHandler } from "hono";
import type { Config } from "../config";
import { HttpError } from "../http-error";
import { readSessionCookie } from "./cookies";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * With STORYLANE_BASE_URL set, that is the only accepted origin. Without it the instance is
 * reached by bare IP or hostname, so the request's own origin is the best available answer
 * (a cross-site attacker cannot forge Origin, only omit it — which this guard also rejects).
 */
export function instanceOrigins(c: Context, config: Config): string[] {
  if (config.baseUrl) return [config.baseUrl.origin];
  return [new URL(c.req.url).origin];
}

/**
 * Cookie-authenticated non-GET requests must prove they came from our own page. Bearer-token
 * requests (PATs, phase 3) carry no cookie and are exempt by construction; so is login, which
 * has no session cookie yet.
 */
export function csrfGuard(config: Config): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || readSessionCookie(c) === null) return next();
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.split(";")[0]?.trim().toLowerCase().startsWith("application/json")) {
      throw new HttpError(403, "csrf_check_failed");
    }
    const origin = c.req.header("origin");
    if (origin) {
      if (!instanceOrigins(c, config).includes(origin)) throw new HttpError(403, "csrf_check_failed");
      return next();
    }
    if (c.req.header("sec-fetch-site") === "same-origin") return next();
    throw new HttpError(403, "csrf_check_failed");
  };
}
