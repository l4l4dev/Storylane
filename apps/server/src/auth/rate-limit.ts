import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import type { Config } from "../config";
import { lastForwarded } from "./forwarded";

export interface RateLimiter {
  /** Records an attempt; false means the caller is over the limit for this window. */
  check(key: string): boolean;
  hits(key: string): number;
  reset(key?: string): void;
}

/** Hard bound on tracked keys: an attacker choosing the key must not be able to grow the map. */
export const MAX_KEYS = 10_000;

/**
 * Fixed window, in memory. Hand-written rather than a dependency: one process, no shared
 * state to coordinate, and the limiter needs an injectable clock for the tests.
 */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const maxKeys = opts.maxKeys ?? MAX_KEYS;
  // Insertion order is bucket-start order (a rolled-over key is deleted before it is re-added),
  // so the first entry is always the oldest window — evicting it is what bounds the map.
  const buckets = new Map<string, { start: number; count: number }>();
  const current = (key: string) => {
    const t = now();
    const bucket = buckets.get(key);
    if (bucket && t - bucket.start < opts.windowMs) return bucket;
    buckets.delete(key);
    while (buckets.size >= maxKeys) {
      const oldest = buckets.keys().next();
      if (oldest.done) break;
      buckets.delete(oldest.value);
    }
    const fresh = { start: t, count: 0 };
    buckets.set(key, fresh);
    return fresh;
  };
  return {
    check(key) {
      const bucket = current(key);
      bucket.count += 1;
      return bucket.count <= opts.limit;
    },
    hits: (key) => buckets.get(key)?.count ?? 0,
    reset(key) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };
}

/** Same shape as LOGIN_LIMITS: a wrong current password is a guess, and each one costs a KDF. */
export const PASSWORD_CHANGE_LIMIT = { limit: 5, windowMs: 15 * 60 * 1000 } as const;

export const LOGIN_LIMITS = {
  perIp: { limit: 20, windowMs: 15 * 60 * 1000 },
  perEmail: { limit: 5, windowMs: 15 * 60 * 1000 },
} as const;

/** X-Forwarded-For is honoured only with STORYLANE_TRUST_PROXY=true (design §4); see lastForwarded. */
export function clientIp(c: Context, config: Config): string {
  if (config.trustProxy) {
    const forwarded = lastForwarded(c, "x-forwarded-for");
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // app.request() in tests has no socket.
    return "unknown";
  }
}
