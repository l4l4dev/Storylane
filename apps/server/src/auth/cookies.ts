import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "../config";
import { lastForwarded } from "./forwarded";
import { SESSION_COOKIE } from "./sessions";

/**
 * A fixed `Secure` flag breaks login on http://192.168.x.x:3000, which is the home-server
 * case this project targets (design §4), so it is decided per request.
 */
export function isSecureRequest(c: Context, config: Config): boolean {
  if (config.baseUrl?.protocol === "https:") return true;
  if (config.trustProxy && lastForwarded(c, "x-forwarded-proto") === "https") return true;
  return new URL(c.req.url).protocol === "https:";
}

export function setSessionCookie(c: Context, config: Config, secret: string, absoluteExpiresAt: number): void {
  setCookie(c, SESSION_COOKIE, secret, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: isSecureRequest(c, config),
    expires: new Date(absoluteExpiresAt),
  });
}

export function clearSessionCookie(c: Context, config: Config): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isSecureRequest(c, config), sameSite: "Lax" });
}

/**
 * Not `__Host-` prefixed: that prefix requires Secure, which the plain-http LAN deployment
 * cannot set. Revisit in phase 2, once https is the only supported deployment.
 */
export function readSessionCookie(c: Context): string | null {
  return getCookie(c, SESSION_COOKIE) ?? null;
}
