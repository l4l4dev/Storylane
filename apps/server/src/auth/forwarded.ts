import type { Context } from "hono";

/**
 * Right-most entry of a comma-joined forwarded header: that is the value our own proxy
 * appended. The left-most entry is whatever the client chose to send, so trusting it would
 * let a client pick its own rate-limit bucket, origin, or cookie scheme.
 */
export function lastForwarded(c: Context, header: string): string | undefined {
  const chain = c.req.header(header)?.split(",");
  const last = chain?.[chain.length - 1]?.trim();
  return last === "" ? undefined : last;
}
