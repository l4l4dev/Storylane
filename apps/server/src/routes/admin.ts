import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import type { Actor } from "../db/tx";
import type { Logger } from "../log";
import { requireAdmin } from "../authz/admin";
import { mintResetToken } from "../services/reset";

export function adminRoutes(deps: { db: Db; config: Config; log: Logger; actorOf: (c: Context) => Actor }) {
  return new Hono().post("/api/admin/users/:userId/reset-link", (c) => {
    const admin = requireAdmin(deps.actorOf(c));
    c.header("Cache-Control", "no-store");
    const { token, expiresAt } = mintResetToken(deps.db, admin, c.req.param("userId"));
    const path = `/reset/${token}`;
    // Never the token itself — see log.ts's redaction of this same path for the public routes.
    deps.log.info("password reset link minted", { userId: c.req.param("userId"), adminId: admin.userId });
    // The absolute URL is only knowable when STORYLANE_BASE_URL is set; the admin UI can
    // always build one from the browser's own origin.
    return c.json({ token, expiresAt, path, url: deps.config.baseUrl ? new URL(path, deps.config.baseUrl).toString() : null });
  });
}
