import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openDatabase } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { seedProject, seedStory, seedUser } from "./harness";
import { withProject } from "../src/db/tx";
import { placeInList, type MoveRequest } from "../src/services/ordering";
import { stories } from "../src/db/schema";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

/** placeInList computes; the caller writes. The service does this inside its own single UPDATE. */
function moveStory(conn: Db, owner: Actor, projectId: string, storyId: string, move: MoveRequest): number {
  return withProject(conn, owner, projectId, "story:write", (tx) => {
    const position = placeInList(tx, storyId, "icebox", move);
    tx.tx
      .update(stories)
      .set({ position })
      .where(and(eq(stories.id, storyId), eq(stories.projectId, projectId)))
      .run();
    return position;
  });
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("concurrent moves", () => {
  it("lands both moves, loses neither, and keeps positions unique", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-order-"));
    dirs.push(dir);
    const path = join(dir, "storylane.db");
    const writer = openDatabase(path);
    runMigrations(writer);
    const owner = seedUser(writer, "owner@example.test");
    const projectId = seedProject(writer, owner);
    const [a, b, c, d] = [
      seedStory(writer, projectId, { name: "a" }),
      seedStory(writer, projectId, { name: "b" }),
      seedStory(writer, projectId, { name: "c" }),
      seedStory(writer, projectId, { name: "d" }),
    ];

    // Both callers decided from the same snapshot [a, b, c, d]: one drags d between a and b,
    // the other drags c between a and b. Neither sends positions, only the neighbours it saw.
    const second = openDatabase(path);
    moveStory(writer, owner, projectId, d, { after_id: a, before_id: b });
    moveStory(second, owner, projectId, c, { after_id: a, before_id: b });

    const order = writer
      .select({ id: stories.id, position: stories.position })
      .from(stories)
      .where(and(eq(stories.projectId, projectId), eq(stories.list, "icebox")))
      .orderBy(stories.position)
      .all();
    expect(order).toHaveLength(4);
    expect(new Set(order.map((r) => r.position)).size).toBe(4);
    const ids = order.map((r) => r.id);
    // Both moves are honoured: each landed after a and before b.
    expect(ids[0]).toBe(a);
    expect(ids[ids.length - 1]).toBe(b);
    expect(ids.slice(1, 3).sort()).toEqual([c, d].sort());
    // The exact order follows from anchoring each move on its named predecessor: d commits
    // first into the a|b seam, then c resolves its upper bound against what is *now* next
    // after a (d, not the named b), so c lands directly after a and ahead of d.
    expect(ids).toEqual([a, c, d, b]);
    writer.$client.close();
    second.$client.close();
  });

  it("survives a seam that runs out, renumbering inside the transaction", () => {
    const dir = mkdtempSync(join(tmpdir(), "sl-order-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "storylane.db"));
    runMigrations(db);
    const owner = seedUser(db, "owner@example.test");
    const projectId = seedProject(db, owner);
    const head = seedStory(db, projectId, { position: 1 });
    const tail = seedStory(db, projectId, { position: 2 });
    const movers = [2, 3, 4].map((p) => seedStory(db, projectId, { position: p * 1000 }));
    for (const mover of movers) {
      moveStory(db, owner, projectId, mover, { after_id: head, before_id: tail });
    }
    const rows = db
      .select({ id: stories.id, position: stories.position })
      .from(stories)
      .where(eq(stories.projectId, projectId))
      .orderBy(stories.position)
      .all();
    expect(new Set(rows.map((r) => r.position)).size).toBe(rows.length);
    expect(rows[0]!.id).toBe(head);
    expect(rows[rows.length - 1]!.id).toBe(tail);
    db.$client.close();
  });
});
