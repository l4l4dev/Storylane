import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { INVITE_TTL_MS, purgeExpiredInvites } from "../src/services/invites";
import { invites, projectMembers, projects, users } from "../src/db/schema";
import { SESSION_COOKIE } from "../src/auth/sessions";
import { hashToken, MAX_TOKEN_LENGTH } from "../src/auth/tokens";
import { createRateLimiter } from "../src/auth/rate-limit";
import { EventBus } from "../src/events/bus";
import { newId } from "../src/id";
import { eq } from "drizzle-orm";
import { listActivity } from "../src/services/activity";
import { withProject } from "../src/db/tx";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let member: Actor;
let stranger: Actor;
let projectId: string;
let app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> };
const ORIGIN = "http://127.0.0.1";

const as = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor) });
const jsonAs = (actor?: Actor) => ({
  ...(actor ? as(actor) : {}),
  "content-type": "application/json",
  origin: ORIGIN,
});

const mint = async (actor: Actor, role = "member") =>
  app.request(`${ORIGIN}/api/projects/${projectId}/invites`, {
    method: "POST",
    headers: jsonAs(actor),
    body: JSON.stringify({ role }),
  });

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  member = seedUser(db, "member@example.test");
  stranger = seedUser(db, "stranger@example.test");
  projectId = createProject(db, owner, { name: "P" }).id;
  db.$client.run("insert into project_members (project_id, user_id, role, joined_at) values (?,?,?,?)", [
    projectId,
    (member as { userId: string }).userId,
    "member",
    Date.now(),
  ]);
  app = makeTestApp(db).app;
});

describe("minting", () => {
  it("returns the token once and stores only its hash", async () => {
    const res = await mint(owner);
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { token: string; invite: { id: string; role: string; expiresAt: number } };
    expect(payload.invite.role).toBe("member");
    expect(payload.invite.expiresAt).toBeGreaterThan(Date.now());
    expect(payload.invite.expiresAt).toBeLessThanOrEqual(Date.now() + INVITE_TTL_MS);
    const rows = db.select().from(invites).all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(payload.token);
  });

  it("is owner-only and rejects an unknown role", async () => {
    expect((await mint(member)).status).toBe(403);
    expect((await mint(stranger)).status).toBe(404);
    const badRole = await mint(owner, "admin");
    expect(badRole.status).toBe(400);
  });

  it("authorizes before validating the role body, so a non-owner's bad role still answers by authorization", async () => {
    const anon = await app.request(`${ORIGIN}/api/projects/${projectId}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ role: "nonsense" }),
    });
    expect(anon.status).toBe(401);
    expect((await mint(member, "nonsense")).status).toBe(403);
    expect((await mint(stranger, "nonsense")).status).toBe(404);
  });

  it("lists invitations to the owner only", async () => {
    await mint(owner);
    const asOwner = await app.request(`${ORIGIN}/api/projects/${projectId}/invites`, { headers: as(owner) });
    expect(asOwner.status).toBe(200);
    expect((await asOwner.json()) as unknown[]).toHaveLength(1);
    const asMember = await app.request(`${ORIGIN}/api/projects/${projectId}/invites`, { headers: as(member) });
    expect(asMember.status).toBe(403);
  });

  it("answers Cache-Control: no-store — the response carries the clear token", async () => {
    const res = await mint(owner);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("purgeExpiredInvites", () => {
  const seedInvite = (patch: Record<string, unknown>) => {
    const now = Date.now();
    const row = {
      id: newId(),
      projectId,
      tokenHash: hashToken(newId()),
      role: "member",
      createdBy: (owner as { userId: string }).userId,
      createdAt: now,
      expiresAt: now + INVITE_TTL_MS,
      ...patch,
    };
    db.insert(invites).values(row as never).run();
    return row.id;
  };

  it("deletes expired, accepted and revoked rows and keeps a live one", () => {
    const now = Date.now();
    seedInvite({ expiresAt: now - 1 });
    seedInvite({ acceptedAt: now - 1, acceptedBy: (member as { userId: string }).userId });
    seedInvite({ revokedAt: now - 1 });
    const live = seedInvite({});
    expect(purgeExpiredInvites(db, now)).toBe(3);
    expect(db.select({ id: invites.id }).from(invites).all()).toEqual([{ id: live }]);
  });
});

describe("previewing and accepting", () => {
  it("previews without a session and hides the token's project from a wrong token", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const preview = await app.request(`${ORIGIN}/api/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ projectId, projectName: "P", role: "viewer" });
    expect((await app.request(`${ORIGIN}/api/invites/not-a-token`)).status).toBe(404);
  });

  it("404s an over-length token on both preview and accept, without hashing it", async () => {
    const overLong = "a".repeat(MAX_TOKEN_LENGTH + 1);
    expect((await app.request(`${ORIGIN}/api/invites/${overLong}`)).status).toBe(404);
    const res = await app.request(`${ORIGIN}/api/invites/${overLong}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("never writes the raw token into the request log", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const { app: logged, lines } = makeTestApp(db);
    await logged.request(`${ORIGIN}/api/invites/${token}`);
    await logged.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    for (const line of lines) expect(line).not.toContain(token);
    const paths = lines.map((l) => (JSON.parse(l) as { path: string }).path);
    expect(paths).toContain("/api/invites/:token");
    expect(paths).toContain("/api/invites/:token/accept");
  });

  it("sets Cache-Control: no-store on preview and accept responses", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const preview = await app.request(`${ORIGIN}/api/invites/${token}`);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    const accept = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    expect(accept.headers.get("cache-control")).toBe("no-store");
  });

  it("rate-limits preview/accept per IP and answers 429 past the limit", async () => {
    const now = 0;
    const limiter = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000, now: () => now });
    const limited = makeTestApp(db, undefined, { inviteLimiter: limiter }).app;
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    for (let i = 0; i < 20; i++) {
      const res = await limited.request(`${ORIGIN}/api/invites/${token}`);
      expect(res.status).toBe(200);
    }
    const blocked = await limited.request(`${ORIGIN}/api/invites/${token}`);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "too_many_requests" });
  });

  it("treats a hand-inserted owner-role invite row as unusable (defense in depth)", async () => {
    const rawToken = "hand-inserted-owner-token";
    db.insert(invites)
      .values({
        id: newId(),
        projectId,
        tokenHash: hashToken(rawToken),
        role: "owner",
        createdBy: (owner as { userId: string }).userId,
        createdAt: Date.now(),
        expiresAt: Date.now() + INVITE_TTL_MS,
      })
      .run();
    expect((await app.request(`${ORIGIN}/api/invites/${rawToken}`)).status).toBe(404);
  });

  it("joins a signed-in non-member with the bound role and is then single-use", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const accepted = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ projectId, projectName: "P", role: "viewer" });
    const membership = db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.userId, (stranger as { userId: string }).userId))
      .get();
    expect(membership!.role).toBe("viewer");

    const again = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    expect(again.status).toBe(404);
  });

  it("publishes project.changed when a signed-in join actually happens", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const bus = new EventBus();
    let publishes = 0;
    bus.subscribe(projectId, () => {
      publishes++;
    });
    const withBus = makeTestApp(db, undefined, { bus }).app;
    const res = await withBus.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(publishes).toBe(1);
  });

  it("skips the project.changed publish when an already-member accept changes nothing", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const bus = new EventBus();
    let publishes = 0;
    bus.subscribe(projectId, () => {
      publishes++;
    });
    const withBus = makeTestApp(db, undefined, { bus }).app;
    const res = await withBus.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(member),
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(publishes).toBe(0);
  });

  it("registers and joins when accepted while logged out", async () => {
    const { token } = (await (await mint(owner)).json()) as { token: string };
    const res = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(),
      body: JSON.stringify({
        email: "newcomer@example.test",
        displayName: "Newcomer",
        password: "correct horse battery",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=`);
    const created = db.select().from(users).where(eq(users.email, "newcomer@example.test")).get();
    expect(created!.isAdmin).toBe(false);
    expect(created!.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("rejects a registration that reuses an existing email with the same code as any other bad body", async () => {
    const { token } = (await (await mint(owner)).json()) as { token: string };
    const res = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(),
      body: JSON.stringify({ email: "OWNER@example.test", displayName: "Copy", password: "correct horse battery" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });

  it("rejects control characters/newlines in email and displayName", async () => {
    const { token: t1 } = (await (await mint(owner)).json()) as { token: string };
    const badEmail = await app.request(`${ORIGIN}/api/invites/${t1}/accept`, {
      method: "POST",
      headers: jsonAs(),
      body: JSON.stringify({ email: "bad\nname@example.test", displayName: "Ok", password: "correct horse battery" }),
    });
    expect(badEmail.status).toBe(400);

    const { token: t2 } = (await (await mint(owner)).json()) as { token: string };
    const badName = await app.request(`${ORIGIN}/api/invites/${t2}/accept`, {
      method: "POST",
      headers: jsonAs(),
      body: JSON.stringify({ email: "ok2@example.test", displayName: "Bad\x00Name", password: "correct horse battery" }),
    });
    expect(badName.status).toBe(400);
  });

  it("creates no user when the token is revoked just before registration", async () => {
    const { token, invite } = (await (await mint(owner)).json()) as { token: string; invite: { id: string } };
    db.update(invites).set({ revokedAt: Date.now() }).where(eq(invites.id, invite.id)).run();
    const res = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(),
      body: JSON.stringify({ email: "raceloser@example.test", displayName: "Race Loser", password: "correct horse battery" }),
    });
    expect(res.status).toBe(404);
    const created = db.select().from(users).where(eq(users.email, "raceloser@example.test")).get();
    expect(created).toBeUndefined();
  });

  it("refuses an expired or revoked invitation with the same 404", async () => {
    const expired = (await (await mint(owner)).json()) as { token: string; invite: { id: string } };
    db.update(invites).set({ expiresAt: Date.now() - 1 }).where(eq(invites.id, expired.invite.id)).run();
    expect(
      (await app.request(`${ORIGIN}/api/invites/${expired.token}/accept`, { method: "POST", headers: jsonAs(stranger), body: "{}" })).status,
    ).toBe(404);

    const revoked = (await (await mint(owner)).json()) as { token: string; invite: { id: string } };
    const revoke = await app.request(`${ORIGIN}/api/projects/${projectId}/invites/${revoked.invite.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(revoke.status).toBe(200);
    expect(
      (await app.request(`${ORIGIN}/api/invites/${revoked.token}/accept`, { method: "POST", headers: jsonAs(stranger), body: "{}" })).status,
    ).toBe(404);
  });

  it("refuses to join an archived project with the same 404", async () => {
    const { token } = (await (await mint(owner)).json()) as { token: string };
    db.update(projects).set({ archivedAt: Date.now() }).where(eq(projects.id, projectId)).run();
    expect((await app.request(`${ORIGIN}/api/invites/${token}`)).status).toBe(404);
    expect(
      (await app.request(`${ORIGIN}/api/invites/${token}/accept`, { method: "POST", headers: jsonAs(stranger), body: "{}" })).status,
    ).toBe(404);
    const membership = db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.userId, (stranger as { userId: string }).userId))
      .get();
    expect(membership).toBeUndefined();
  });

  it("does not consume the invite when the accepting user is already a member, so its intended recipient can still use it", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    await app.request(`${ORIGIN}/api/invites/${token}/accept`, { method: "POST", headers: jsonAs(member), body: "{}" });
    const secondAccept = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    expect(secondAccept.status).toBe(200);
    expect(((await secondAccept.json()) as { role: string }).role).toBe("viewer");
  });

  it("is idempotent for a user who is already a member", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    const res = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(member),
      body: "{}",
    });
    expect(res.status).toBe(200);
    // The existing role wins — accepting an invite never demotes a member.
    expect(((await res.json()) as { role: string }).role).toBe("member");
  });
});

describe("activity kinds", () => {
  it("mints as project_invite_create_activity with the invite as the primary resource", async () => {
    const { invite } = (await (await mint(owner, "viewer")).json()) as { invite: { id: string } };
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    const created = rows.at(-1)!;
    expect(created.kind).toBe("project_invite_create_activity");
    expect(created.changes[0]!.kind).toBe("invite");
    expect(created.primary_resources).toEqual([{ kind: "invite", id: invite.id }]);
  });

  it("revokes as project_invite_delete_activity", async () => {
    const { invite } = (await (await mint(owner, "viewer")).json()) as { invite: { id: string } };
    const res = await app.request(`${ORIGIN}/api/projects/${projectId}/invites/${invite.id}`, {
      method: "DELETE",
      headers: jsonAs(owner),
    });
    expect(res.status).toBe(200);
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    const revoked = rows.at(-1)!;
    expect(revoked.kind).toBe("project_invite_delete_activity");
    expect(revoked.primary_resources).toEqual([{ kind: "invite", id: invite.id }]);
  });

  it("still records acceptance as project_membership_create_activity", async () => {
    const { token } = (await (await mint(owner, "viewer")).json()) as { token: string };
    await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(stranger),
      body: "{}",
    });
    const rows = withProject(db, owner, projectId, "activity:read", (tx) => listActivity(tx, {}));
    const joined = rows.at(-1)!;
    expect(joined.kind).toBe("project_membership_create_activity");
  });
});
