import { Hono } from "hono";

export function healthzRoute(health: () => boolean) {
  return new Hono().get("/healthz", (c) => {
    return health() ? c.json({ status: "ok" }, 200) : c.json({ status: "unavailable" }, 503);
  });
}
