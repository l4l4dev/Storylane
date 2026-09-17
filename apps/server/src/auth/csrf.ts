import type { Context, MiddlewareHandler } from "hono";
import type { Config } from "../config";
import { HttpError } from "../http-error";
import { readSessionCookie } from "./cookies";
import { lastForwarded } from "./forwarded";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The comment-attachment upload route, and nothing else, may send its file as raw bytes. */
const OCTET_STREAM_UPLOAD_PATH = /^\/api\/projects\/[^/]+\/stories\/[^/]+\/comments\/[^/]+\/attachments$/;

function mediaType(c: Context): string {
  return (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function acceptedContentType(c: Context): boolean {
  const type = mediaType(c);
  if (type.startsWith("application/json")) return true;
  return type === "application/octet-stream" && c.req.method === "POST" && OCTET_STREAM_UPLOAD_PATH.test(c.req.path);
}

/**
 * With STORYLANE_BASE_URL set, that is the only accepted origin. Without it the instance is
 * reached by bare IP or hostname, so the request's own origin is the best available answer
 * (a cross-site attacker cannot forge Origin, only omit it).
 *
 * Behind a trusted proxy the socket-level URL is the internal http://host:port one, which no
 * browser would ever send as Origin — the forwarded proto/host are what the client saw.
 */
export function instanceOrigins(c: Context, config: Config): string[] {
  if (config.baseUrl) return [config.baseUrl.origin];
  const url = new URL(c.req.url);
  if (config.trustProxy) {
    const proto = lastForwarded(c, "x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = lastForwarded(c, "x-forwarded-host") ?? c.req.header("host") ?? url.host;
    return [`${proto}://${host}`];
  }
  return [url.origin];
}

/**
 * Every unsafe request must prove it came from our own page — cookie-authenticated or not:
 * a cross-site forced login would otherwise plant the attacker's session in the victim's
 * browser. Two independent checks:
 *
 *  - `application/json` for all of them, which a no-cors form POST cannot send. The one
 *    exception is `application/octet-stream` on POST to the comment-attachment upload path:
 *    it is not a CORS-simple type either, so a cross-site page cannot send it without a
 *    preflight this server never answers. `multipart/form-data` stays refused because a plain
 *    `<form>` can send it;
 *  - a matching `Origin` whenever the request carries one, and — when a session cookie is
 *    present — a same-origin `Sec-Fetch-Site` if it does not.
 *
 * A request with neither cookie nor Origin is a non-browser client (curl, the CLI); it cannot
 * be a CSRF vehicle, because a browser always sends Origin on a cross-site unsafe request.
 * Bearer-token requests (PATs, phase 3) carry no cookie and pass the same way.
 */
export function csrfGuard(config: Config): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (!acceptedContentType(c)) throw new HttpError(403, "csrf_check_failed");
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      if (!instanceOrigins(c, config).includes(origin)) throw new HttpError(403, "csrf_check_failed");
      return next();
    }
    if (readSessionCookie(c) === null) return next();
    if (c.req.header("sec-fetch-site") === "same-origin") return next();
    throw new HttpError(403, "csrf_check_failed");
  };
}
