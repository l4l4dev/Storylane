import { Hono } from "hono";
import type { Context } from "hono";
import type { Config } from "../config";
import type { Db } from "../db/client";
import type { EventBus } from "../events/bus";
import type { Logger } from "../log";
import { withProject, type Actor } from "../db/tx";
import { withProjectChange } from "../events/emit";
import { HttpError } from "../http-error";
import { assertPasswordAcceptable, hashPassword } from "../auth/password";
import { setSessionCookie } from "../auth/cookies";
import { createSession } from "../auth/sessions";
import { clientIp, createRateLimiter, type RateLimiter } from "../auth/rate-limit";
import { assertTokenLength } from "../auth/tokens";
import {
  acceptInvite,
  listInvites,
  mintInvite,
  previewInvite,
  registerAndAcceptInvite,
  revokeInvite,
  type InviteRole,
} from "../services/invites";

const ACCEPT_LIMIT = { limit: 20, windowMs: 15 * 60 * 1000 };
const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 80;
/** Owner invitations are not allowed in phase 1 — an invite only ever mints member/viewer. */
const INVITE_ROLES: readonly InviteRole[] = ["member", "viewer"];
/** C0 controls, DEL, and C1 controls — none of these belong in an email or a display name. */
const HAS_CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/;

// A malformed body carries nothing about the project, so this 400 may answer before 404/403.
const body = async (c: Context): Promise<Record<string, unknown>> => {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_body");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "invalid_body");
  return parsed as Record<string, unknown>;
};

function requireInviteRole(value: unknown): InviteRole {
  if (typeof value !== "string" || !INVITE_ROLES.includes(value as InviteRole)) throw new HttpError(400, "role_invalid");
  return value as InviteRole;
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
  if (!validShape || trimmed.length > MAX_EMAIL_LENGTH || HAS_CONTROL_CHARS.test(trimmed)) {
    throw new HttpError(400, "invalid_body");
  }
  return trimmed;
}

function normalizeDisplayName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_DISPLAY_NAME_LENGTH || HAS_CONTROL_CHARS.test(trimmed)) {
    throw new HttpError(400, "invalid_body");
  }
  return trimmed;
}

export function inviteRoutes(deps: {
  db: Db;
  bus: EventBus;
  log: Logger;
  config: Config;
  actorOf: (c: Context) => Actor;
  limiter?: RateLimiter;
}) {
  const limiter = deps.limiter ?? createRateLimiter(ACCEPT_LIMIT);
  return new Hono()
    .post("/api/projects/:id/invites", async (c) => {
      // Read (but do not validate) the body before authorizing: requireInviteRole's 400 must
      // not fire ahead of withProjectChange's 401/403/404 — an anonymous or non-owner caller
      // learns nothing about whether their role value was well-formed.
      const rawRole = (await body(c)).role;
      // The clear token is in this body: same rule as the public token routes.
      c.header("Cache-Control", "no-store");
      return c.json(
        withProjectChange(deps, deps.actorOf(c), c.req.param("id"), "member:invite", (tx) =>
          mintInvite(tx, { role: requireInviteRole(rawRole) }),
        ),
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
      c.header("Cache-Control", "no-store");
      if (!limiter.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      const token = c.req.param("token");
      assertTokenLength(token); // before hashToken — see auth/tokens.ts
      const preview = previewInvite(deps.db, token);
      if (!preview) throw new HttpError(404, "not_found");
      return c.json(preview);
    })
    .post("/api/invites/:token/accept", async (c) => {
      c.header("Cache-Control", "no-store");
      if (!limiter.check(clientIp(c, deps.config))) throw new HttpError(429, "too_many_requests");
      const token = c.req.param("token");
      assertTokenLength(token); // before hashToken — see auth/tokens.ts
      const actor = deps.actorOf(c);
      if (actor.kind === "user") {
        const result = acceptInvite(deps.db, token, actor);
        // An already-member accept writes nothing, so there is nothing for a subscriber to
        // refetch — publishing would just be a false alarm.
        if (result.changed) deps.bus.publish(result.projectId, result.projectVersion);
        return c.json({ projectId: result.projectId, projectName: result.projectName, role: result.role });
      }
      const input = await body(c);
      const email = normalizeEmail(requireString(input.email, "email"));
      const displayName = normalizeDisplayName(requireString(input.displayName, "display_name"));
      const password = requireString(input.password, "password");
      assertPasswordAcceptable(password);
      // Hash before the transaction: bun:sqlite transactions cannot await. Runs only after a
      // read-only pre-check here — registerAndAcceptInvite's own in-transaction recheck stays
      // authoritative for the actual race — so a garbage token never burns the KDF.
      if (!previewInvite(deps.db, token)) throw new HttpError(404, "not_found");
      const passwordHash = await hashPassword(password);
      const { userId, preview, projectVersion } = registerAndAcceptInvite(deps.db, token, { email, displayName, passwordHash });
      const { secret, absoluteExpiresAt } = createSession(deps.db, userId);
      setSessionCookie(c, deps.config, secret, absoluteExpiresAt);
      deps.bus.publish(preview.projectId, projectVersion);
      return c.json(preview);
    });
}
