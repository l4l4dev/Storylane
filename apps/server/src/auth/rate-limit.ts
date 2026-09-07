import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import type { Config } from "../config";

export interface RateLimiter {
  /** Records an attempt; false means the caller is over the limit for this window. */
  check(key: string): boolean;
  hits(key: string): number;
  reset(key?: string): void;
}

/**
 * Fixed window, in memory. Hand-written rather than a dependency: one process, no shared
 * state to coordinate, and the limiter needs an injectable clock for the tests.
 */
export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const buckets = new Map<string, { start: number; count: number }>();
  const current = (key: string) => {
    const t = now();
    const bucket = buckets.get(key);
    if (!bucket || t - bucket.start >= opts.windowMs) {
      const fresh = { start: t, count: 0 };
      buckets.set(key, fresh);
      return fresh;
    }
    return bucket;
  };
  return {
    check(key) {
      const bucket = current(key);
      bucket.count += 1;
      // Keep the map from growing without bound on a busy instance.
      if (buckets.size > 10_000) {
        const t = now();
        for (const [k, b] of buckets) if (t - b.start >= opts.windowMs) buckets.delete(k);
      }
      return bucket.count <= opts.limit;
    },
    hits: (key) => buckets.get(key)?.count ?? 0,
    reset(key) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };
}

export const LOGIN_LIMITS = {
  perIp: { limit: 20, windowMs: 15 * 60 * 1000 },
  perEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const;

/**
 * X-Forwarded-For is honoured only with STORYLANE_TRUST_PROXY=true (design §4), and then only
 * its left-most entry: the documented deployment is one reverse proxy in front of the server,
 * which appends the real client and is trusted not to forward a client-supplied header.
 */
export function clientIp(c: Context, config: Config): string {
  if (config.trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // app.request() in tests has no socket.
    return "unknown";
  }
}
