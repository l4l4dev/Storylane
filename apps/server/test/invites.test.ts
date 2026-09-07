import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { createProject } from "../src/services/projects";
import { INVITE_TTL_MS } from "../src/services/invites";
import { invites, projectMembers, projects, users } from "../src/db/schema";
import { SESSION_COOKIE } from "../src/auth/sessions";
import { eq } from "drizzle-orm";
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

  it("lists invitations to the owner only", async () => {
    await mint(owner);
    const asOwner = await app.request(`${ORIGIN}/api/projects/${projectId}/invites`, { headers: as(owner) });
    expect(asOwner.status).toBe(200);
    expect((await asOwner.json()) as unknown[]).toHaveLength(1);
    const asMember = await app.request(`${ORIGIN}/api/projects/${projectId}/invites`, { headers: as(member) });
    expect(asMember.status).toBe(403);
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

  it("rejects a registration that reuses an existing email", async () => {
    const { token } = (await (await mint(owner)).json()) as { token: string };
    const res = await app.request(`${ORIGIN}/api/invites/${token}/accept`, {
      method: "POST",
      headers: jsonAs(),
      body: JSON.stringify({ email: "OWNER@example.test", displayName: "Copy", password: "correct horse battery" }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "email_taken" });
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
