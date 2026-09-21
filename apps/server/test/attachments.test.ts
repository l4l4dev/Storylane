import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ATTACHMENT_MAX_BYTES, createAttachmentStore } from "../src/attachments/store";
import { contentDisposition, safeContentType, servedContentType } from "../src/routes/story-parts";
import { projects } from "../src/db/schema";
import { eq } from "drizzle-orm";
import type { Actor } from "../src/db/tx";
import {
  makeTestApp,
  makeTestDb,
  seedAttachment,
  seedComment,
  seedProject,
  seedStory,
  seedUser,
  disableUser,
} from "./harness";

describe("attachment store", () => {
  it("writes under the data dir and reads back the same bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-att-"));
    const store = createAttachmentStore(dir);
    const path = store.put("p1", "a1", new TextEncoder().encode("hello").buffer);
    expect(path).toBe("attachments/p1/a1");
    expect(new TextDecoder().decode(store.read(path))).toBe("hello");
    store.remove(path);
    expect(() => store.read(path)).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a storage path that escapes the data dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-att-"));
    const store = createAttachmentStore(dir);
    expect(() => store.read("../../etc/passwd")).toThrow(/outside the attachment store/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses ids that would escape or collapse onto the store root", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-att-"));
    const store = createAttachmentStore(dir);
    const bytes = new TextEncoder().encode("x").buffer;
    expect(() => store.put("..", "a1", bytes)).toThrow(/outside the attachment store/);
    expect(() => store.put("p1", "../../x", bytes)).toThrow(/outside the attachment store/);
    expect(() => store.removeProject("..")).toThrow(/outside the attachment store/);
    expect(() => store.removeProject(".")).toThrow(/outside the attachment store/);
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes a whole project directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-att-"));
    const store = createAttachmentStore(dir);
    store.put("p1", "a1", new TextEncoder().encode("x").buffer);
    store.removeProject("p1");
    expect(existsSync(join(dir, "attachments", "p1"))).toBe(false);
    store.removeProject("never-existed");
    rmSync(dir, { recursive: true, force: true });
  });
});

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function routeSetup() {
  const dataDir = mkdtempSync(join(tmpdir(), "sl-att-routes-"));
  dirs.push(dataDir);
  const db = makeTestDb();
  const store = createAttachmentStore(dataDir);
  const { app, lines } = makeTestApp(db, undefined, { dataDir });
  const owner = seedUser(db, "owner@example.test");
  const member = seedUser(db, "member@example.test");
  const projectId = seedProject(db, owner, [[member, "member"]]);
  const storyId = seedStory(db, projectId);
  const as = (a: Actor, method = "GET", body?: unknown): RequestInit => ({
    method,
    headers: { "x-test-actor": JSON.stringify(a), ...(method === "GET" ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { dataDir, db, store, app, lines, owner, member, projectId, storyId, as };
}

describe("comment and attachment routes", () => {
  it("creates, edits and lists comments on a story", async () => {
    const { app, member, projectId, storyId, as } = routeSetup();
    const base = `/api/projects/${projectId}/stories/${storyId}/comments`;
    const created = await app.request(base, as(member, "POST", { text: "hello" }));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const edited = await app.request(`${base}/${id}`, as(member, "PUT", { text: "hello again" }));
    expect(edited.status).toBe(200);
    const list = (await (await app.request(base, as(member))).json()) as { text: string }[];
    expect(list.map((c) => c.text)).toEqual(["hello again"]);
  });

  it("answers 404 for a comment that belongs to another story", async () => {
    const { db, app, member, projectId, storyId, as } = routeSetup();
    const otherStory = seedStory(db, projectId);
    const commentId = seedComment(db, projectId, otherStory, member);
    const res = await app.request(
      `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}`,
      as(member, "PUT", { text: "x" }),
    );
    expect(res.status).toBe(404);
  });

  it("answers 403 before 400 when a non-author sends a malformed edit", async () => {
    const { db, app, owner, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const res = await app.request(
      `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}`,
      as(owner, "PUT", { nope: 1 }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_comment_author" });
  });

  it("downloads a passive type as itself, sandboxed", async () => {
    const { db, store, app, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const id = seedAttachment(db, store, projectId, commentId, member, { contentType: "image/png", bytes: "png" });
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(member));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("serves active content as opaque bytes", async () => {
    const { db, store, app, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const id = seedAttachment(db, store, projectId, commentId, member, {
      filename: "page.html",
      contentType: "text/html",
      bytes: "<script>alert(1)</script>",
    });
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(member));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("content-disposition")).toStartWith("attachment;");
    expect(await res.text()).toBe("<script>alert(1)</script>");
  });

  it("keeps Content-Disposition on one line with the quote stripped", async () => {
    const { db, store, app, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const id = seedAttachment(db, store, projectId, commentId, member, {
      filename: 'evil".html\r\nSet-Cookie: x=1',
      contentType: "not a type",
    });
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(member));
    expect(res.status).toBe(200);
    const header = res.headers.get("content-disposition")!;
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toStartWith('attachment; filename="evil.htmlSet-Cookie: x=1"; filename*=UTF-8\'\'');
    expect(header).toContain("evil%22.html%0D%0ASet-Cookie");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("answers 404 and logs the id when the bytes are missing", async () => {
    const { dataDir, db, store, app, lines, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const id = seedAttachment(db, store, projectId, commentId, member);
    rmSync(join(dataDir, "attachments", projectId, id));
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(member));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    const warning = lines.find((l) => l.includes("attachment bytes missing"));
    expect(warning).toContain(id);
    expect(warning).not.toContain(dataDir);
  });

  it("answers 404 for an attachment of another project", async () => {
    const { db, store, app, owner, member, projectId, as } = routeSetup();
    const other = seedProject(db, owner);
    const otherStory = seedStory(db, other);
    const id = seedAttachment(db, store, other, seedComment(db, other, otherStory, owner), owner);
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(member));
    expect(res.status).toBe(404);
  });

  it("lets an owner delete another user's comment, but not a member", async () => {
    const { db, app, owner, member, projectId, storyId, as } = routeSetup();
    const byOwner = seedComment(db, projectId, storyId, owner);
    const byMember = seedComment(db, projectId, storyId, member);
    const base = `/api/projects/${projectId}/stories/${storyId}/comments`;
    const refused = await app.request(`${base}/${byOwner}`, as(member, "DELETE"));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    expect((await app.request(`${base}/${byMember}`, as(owner, "DELETE"))).status).toBe(204);
  });

  it("lets an owner detach another uploader's attachment", async () => {
    const { db, store, app, owner, member, projectId, storyId, as } = routeSetup();
    const id = seedAttachment(db, store, projectId, seedComment(db, projectId, storyId, member), member);
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(owner, "DELETE"));
    expect(res.status).toBe(204);
  });

  it("refuses a comment on an archived project with 409", async () => {
    const { db, app, member, projectId, storyId, as } = routeSetup();
    db.update(projects).set({ archivedAt: Date.now() }).where(eq(projects.id, projectId)).run();
    const res = await app.request(
      `/api/projects/${projectId}/stories/${storyId}/comments`,
      as(member, "POST", { text: "late" }),
    );
    expect(res.status).toBe(409);
  });

  it("deletes an attachment's bytes after the row", async () => {
    const { dataDir, db, store, app, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const id = seedAttachment(db, store, projectId, commentId, member);
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(member, "DELETE"));
    expect(res.status).toBe(204);
    expect(existsSync(join(dataDir, "attachments", projectId, id))).toBe(false);
  });

  it("keeps the bytes when the delete is refused", async () => {
    const { dataDir, db, store, app, owner, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, owner);
    const id = seedAttachment(db, store, projectId, commentId, owner);
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(member, "DELETE"));
    expect(res.status).toBe(403);
    expect(existsSync(join(dataDir, "attachments", projectId, id))).toBe(true);
  });

  it("removes a comment's attachment bytes when the comment is deleted", async () => {
    const { dataDir, db, store, app, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const id = seedAttachment(db, store, projectId, commentId, member);
    const res = await app.request(
      `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}`,
      as(member, "DELETE"),
    );
    expect(res.status).toBe(204);
    expect(existsSync(join(dataDir, "attachments", projectId, id))).toBe(false);
  });

  it("removes attachment bytes when their story is deleted", async () => {
    const { dataDir, db, store, app, owner, member, projectId, storyId, as } = routeSetup();
    const keepStory = seedStory(db, projectId);
    const gone = seedAttachment(db, store, projectId, seedComment(db, projectId, storyId, member), member);
    const kept = seedAttachment(db, store, projectId, seedComment(db, projectId, keepStory, member), member);
    const res = await app.request(`/api/projects/${projectId}/stories/${storyId}`, as(owner, "DELETE"));
    expect(res.status).toBe(204);
    expect(existsSync(join(dataDir, "attachments", projectId, gone))).toBe(false);
    expect(existsSync(join(dataDir, "attachments", projectId, kept))).toBe(true);
  });

  it("removes the project's attachment directory when the project is deleted", async () => {
    const { dataDir, db, store, app, owner, member, projectId, storyId, as } = routeSetup();
    seedAttachment(db, store, projectId, seedComment(db, projectId, storyId, member), member);
    const res = await app.request(`/api/projects/${projectId}`, as(owner, "DELETE"));
    expect(res.status).toBe(204);
    expect(existsSync(join(dataDir, "attachments", projectId))).toBe(false);
  });

  it("logs, but does not fail, when bytes cannot be removed after commit", async () => {
    const { db, app, lines, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    // A row whose storage_path the store refuses: the delete commits, the unlink cannot happen.
    db.$client.run(
      "insert into file_attachments (id, project_id, comment_id, filename, content_type, size, storage_path, uploader_id, created_at) values (?, ?, ?, 'x', 'text/plain', 0, '../outside', ?, 0)",
      ["att-bad", projectId, commentId, (member as { userId: string }).userId],
    );
    const res = await app.request(`/api/projects/${projectId}/attachments/att-bad`, as(member, "DELETE"));
    expect(res.status).toBe(204);
    expect(lines.some((l) => l.includes("attachment bytes not removed"))).toBe(true);
  });
});

describe("upload route", () => {
  function upload(
    app: ReturnType<typeof makeTestApp>["app"],
    actor: Actor,
    path: string,
    bytes: string,
    headers: Record<string, string> = {},
  ) {
    return app.request(path, {
      method: "POST",
      headers: {
        "x-test-actor": JSON.stringify(actor),
        "content-type": "application/octet-stream",
        "content-length": String(new TextEncoder().encode(bytes).byteLength),
        ...headers,
      },
      body: bytes,
    });
  }

  function attachmentFiles(dataDir: string, projectId: string): string[] {
    const dir = join(dataDir, "attachments", projectId);
    return existsSync(dir) ? readdirSync(dir) : [];
  }

  it("stores the bytes and round-trips them through the download", async () => {
    const { dataDir, db, app, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const res = await upload(
      app,
      member,
      `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`,
      "hello bytes",
      { "x-filename": encodeURIComponent("  レポート.txt "), "x-content-type": "text/plain; charset=utf-8" },
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as { id: string; filename: string; content_type: string; size: number; download_url: string };
    expect(row).toMatchObject({ filename: "レポート.txt", content_type: "text/plain", size: 11 });
    expect(attachmentFiles(dataDir, projectId)).toEqual([row.id]);
    const download = await app.request(row.download_url, as(member));
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("hello bytes");
    const list = (await (await app.request(`/api/projects/${projectId}/stories/${storyId}/comments`, as(member))).json()) as {
      file_attachments: { id: string }[];
    }[];
    expect(list[0]!.file_attachments.map((f) => f.id)).toEqual([row.id]);
  });

  it("defaults an empty filename and an implausible type", async () => {
    const { db, app, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const res = await upload(
      app,
      member,
      `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`,
      "x",
      { "x-filename": "%20", "x-content-type": "nonsense" },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ filename: "file", content_type: "application/octet-stream" });
  });

  it("refuses an oversized Content-Length with 413 before reading the body", async () => {
    const { dataDir, db, app, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const res = await upload(
      app,
      member,
      `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`,
      "small",
      { "content-length": String(ATTACHMENT_MAX_BYTES + 1) },
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "attachment_too_large" });
    expect(attachmentFiles(dataDir, projectId)).toEqual([]);
  });

  it("refuses an empty body with 400", async () => {
    const { db, app, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const res = await upload(app, member, `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`, "");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "file_required" });
  });

  it("caps the filename at 255 characters", async () => {
    const { db, app, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const path = `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`;
    const ok = await upload(app, member, path, "x", { "x-filename": "a".repeat(255) });
    expect(ok.status).toBe(201);
    const long = await upload(app, member, path, "x", { "x-filename": "a".repeat(256) });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "filename_too_long" });
  });

  it("refuses a body whose length differs from Content-Length, in both directions", async () => {
    const { db, app, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const path = `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`;
    for (const declared of ["2", "1"]) {
      const res = await upload(app, member, path, declared === "2" ? "x" : "xy", { "content-length": declared });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "file_length_mismatch" });
    }
  });

  it("answers 404 to a non-member before validating the filename or reading the body", async () => {
    const { db, app, member, projectId, storyId } = routeSetup();
    const outsider = seedUser(db, "outsider@example.test");
    const commentId = seedComment(db, projectId, storyId, member);
    const path = `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`;
    const longName = await upload(app, outsider, path, "x", { "x-filename": "a".repeat(256) });
    expect(longName.status).toBe(404);
    const lying = await upload(app, outsider, path, "x", { "content-length": "2" });
    expect(lying.status).toBe(404);
  });

  it("answers 401 to a disabled user", async () => {
    const { db, app, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    disableUser(db, member);
    const res = await upload(app, member, `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`, "x", {
      "x-filename": "a".repeat(256),
    });
    expect(res.status).toBe(401);
  });

  it("answers 409 on an archived project without creating its attachment directory", async () => {
    const { dataDir, db, app, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    db.update(projects).set({ archivedAt: Date.now() }).where(eq(projects.id, projectId)).run();
    const res = await upload(app, member, `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`, "x");
    expect(res.status).toBe(409);
    expect(existsSync(join(dataDir, "attachments", projectId))).toBe(false);
  });

  it("stores an uploaded HTML type as given but downloads it as opaque bytes", async () => {
    const { db, app, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const res = await upload(
      app,
      member,
      `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`,
      "<script>alert(1)</script>",
      { "x-filename": "page.html", "x-content-type": "text/html" },
    );
    const row = (await res.json()) as { content_type: string; download_url: string };
    expect(row.content_type).toBe("text/html");
    const download = await app.request(row.download_url, as(member));
    expect(download.headers.get("content-type")).toBe("application/octet-stream");
    expect(download.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("refuses a malformed X-Filename with 400", async () => {
    const { db, app, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const res = await upload(
      app,
      member,
      `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`,
      "x",
      { "x-filename": "%E3%8" },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "filename_invalid" });
  });

  it("refuses a member attaching to someone else's comment and leaves no bytes", async () => {
    const { dataDir, db, app, owner, member, projectId, storyId } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, owner);
    const res = await upload(app, member, `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`, "x");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_comment_author" });
    expect(attachmentFiles(dataDir, projectId)).toEqual([]);
  });

  it("rolls back a comment on another story and removes the bytes it wrote", async () => {
    const { dataDir, db, app, member, projectId, storyId } = routeSetup();
    const otherStory = seedStory(db, projectId);
    const commentId = seedComment(db, projectId, otherStory, member);
    const res = await upload(app, member, `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`, "x");
    expect(res.status).toBe(404);
    expect(attachmentFiles(dataDir, projectId)).toEqual([]);
  });

  it("writes no bytes for a non-member", async () => {
    const { dataDir, db, app, member, projectId, storyId } = routeSetup();
    const outsider = seedUser(db, "outsider@example.test");
    const commentId = seedComment(db, projectId, storyId, member);
    const res = await upload(app, outsider, `/api/projects/${projectId}/stories/${storyId}/comments/${commentId}/attachments`, "x");
    expect(res.status).toBe(404);
    expect(existsSync(join(dataDir, "attachments"))).toBe(false);
  });
});

describe("download headers", () => {
  it("falls back to octet-stream for an implausible content type", () => {
    expect(safeContentType("")).toBe("application/octet-stream");
    expect(safeContentType("Text/HTML; charset=utf-8")).toBe("text/html");
    expect(safeContentType("text/html\r\nX-Evil: 1")).toBe("application/octet-stream");
    expect(safeContentType("image/png")).toBe("image/png");
  });

  it("serves only passive types as themselves", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"]) {
      expect(servedContentType(t)).toBe(t);
    }
    expect(servedContentType("text/plain; charset=utf-8")).toBe("text/plain");
    for (const t of ["text/html", "image/svg+xml", "application/javascript", "text/xml"]) {
      expect(servedContentType(t)).toBe("application/octet-stream");
    }
  });

  it("replaces non-ASCII in the fallback and percent-encodes the original", () => {
    expect(contentDisposition("レポート's.pdf")).toBe(
      "attachment; filename=\"____'s.pdf\"; filename*=UTF-8''%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88%27s.pdf",
    );
    expect(contentDisposition('"')).toStartWith('attachment; filename="file";');
  });
});
