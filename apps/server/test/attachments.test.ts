import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttachmentStore } from "../src/attachments/store";
import { contentDisposition, safeContentType } from "../src/routes/story-parts";
import type { Actor } from "../src/db/tx";
import {
  makeTestApp,
  makeTestDb,
  seedAttachment,
  seedComment,
  seedProject,
  seedStory,
  seedUser,
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

  it("downloads as an attachment with the recorded content type", async () => {
    const { db, store, app, member, projectId, storyId, as } = routeSetup();
    const commentId = seedComment(db, projectId, storyId, member);
    const id = seedAttachment(db, store, projectId, commentId, member, {
      filename: "page.html",
      contentType: "text/html",
      bytes: "<script>alert(1)</script>",
    });
    const res = await app.request(`/api/projects/${projectId}/attachments/${id}`, as(member));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
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

describe("download headers", () => {
  it("falls back to octet-stream for an implausible content type", () => {
    expect(safeContentType("")).toBe("application/octet-stream");
    expect(safeContentType("text/html; charset=utf-8")).toBe("application/octet-stream");
    expect(safeContentType("image/png")).toBe("image/png");
  });

  it("replaces non-ASCII in the fallback and percent-encodes the original", () => {
    expect(contentDisposition("レポート's.pdf")).toBe(
      "attachment; filename=\"____'s.pdf\"; filename*=UTF-8''%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88%27s.pdf",
    );
    expect(contentDisposition('"')).toStartWith('attachment; filename="file";');
  });
});
