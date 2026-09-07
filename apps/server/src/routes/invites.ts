import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import type { EventBus } from "../events/bus";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import type { MemberRole } from "../authz/permissions";
import { HttpError } from "../http-error";
import { assertPasswordAcceptable, hashPassword } from "../auth/password";
import { setSessionCookie } from "../auth/cookies";
import { createSession } from "../auth/sessions";
import { clientIp, createRateLimiter, type RateLimiter } from "../auth/rate-limit";
import { acceptInvite, listInvites, mintInvite, previewInvite, registerAndAcceptInvite, revokeInvite } from "../services/invites";

const ACCEPT_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };
const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 80;
/** Owner invitations are not allowed in phase 1 — an invite only ever mints member/viewer. */
const INVITE_ROLES: readonly MemberRole[] = ["member", "viewer"];

const body = async (c: Context) => (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

function requireInviteRole(value: unknown): MemberRole {
  if (typeof value !== "string" || !INVITE_ROLES.includes(value as MemberRole)) throw new HttpError(400, "role_invalid");
  return value as MemberRole;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new HttpError(400, `${field}_required`);
  return value;
}

/** Trimmed only, case preserved — login's lookup is COLLATE NOCASE, so case does not need folding. */
function normalizeEmail(raw: string): string {
  const trimmed = raw.trim();
  const at = trimmed.indexOf("@");
  const validShape = at > 0 && at === trimmed.lastIndexOf("@") && at < trimmed.length - 1;
  if (!validShape || trimmed.length > MAX_EMAIL_LENGTH) throw new HttpError(400, "invalid_body");
  return trimmed;
}

function normalizeDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_DISPLAY_NAME_LENGTH) throw new HttpError(400, "invalid_body");
  return trimmed;
}

export function inviteRoutes(deps: {
  db: Db;
  bus: EventBus;
  config: Config;
  actorOf: (c: Context) => Actor;
  limiter?: RateLimiter;
}) {
  const limiter = deps.limiter ?? createRateLimiter(ACCEPT_LIMIT);
  return new Hono()
    .post("/api/projects/:id/invites", async (c) => {
      const role = requireInviteRole((await body(c)).role);
      return c.json(
        withProjectChange(deps, deps.actorOf(c), c.req.param("id"), "member:invite", (tx) => mintInvite(tx, { role })),
        201,
      );
    })
    .get("/api/projects/:id/invites", (c) =>
      c.json(withProject(deps.db, deps.actorOf(c), c.req.param("id"), "invite:read", (tx) => listInvites(tx))),
    )
    .delete("/api/projects/:id/invites/:inviteId", (c) =>
      c.json(
        withProjectChange(deps, deps.actorOf(c), c.req.param("id"), "member:invite", (tx) =>
          revokeInvite(tx, c.req.param("inviteId")),
        ),
      ),
    )
    .get("/api/invites/:token", (c) => {
      if (!limiter.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      const preview = previewInvite(deps.db, c.req.param("token"));
      if (!preview) throw new HttpError(404, "not_found");
      return c.json(preview);
    })
    .post("/api/invites/:token/accept", async (c) => {
      if (!limiter.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      const token = c.req.param("token");
      const actor = deps.actorOf(c);
      if (actor.kind === "user") {
        const preview = acceptInvite(deps.db, token, actor);
        deps.bus.publish(preview.projectId);
        return c.json(preview);
      }
      const input = await body(c);
      const email = normalizeEmail(requireString(input.email, "email"));
      const displayName = normalizeDisplayName(requireString(input.displayName, "display_name"));
      const password = requireString(input.password, "password");
      assertPasswordAcceptable(password);
      // Hash before the transaction: bun:sqlite transactions cannot await. Runs only after the
      // token pre-check inside registerAndAcceptInvite would otherwise be skipped — but that
      // check needs a transaction too, so the token is checked once more, read-only, here first:
      // a garbage token must not burn the KDF at all.
      if (!previewInvite(deps.db, token)) throw new HttpError(404, "not_found");
      const passwordHash = await hashPassword(password);
      const { userId, preview } = registerAndAcceptInvite(deps.db, token, { email, displayName, passwordHash });
      const { secret, absoluteExpiresAt } = createSession(deps.db, userId);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      deps.bus.publish(preview.projectId);
      return c.json(preview);
    });
}
