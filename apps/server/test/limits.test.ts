import { beforeEach, describe, expect, it } from "bun:test";
import { makeTestApp, makeTestDb, seedUser } from "./harness";
import { NAME_MAX } from "../src/routes/limits";
import type { Db } from "../src/db/client";
import type { Actor } from "../src/db/tx";

let db: Db;
let owner: Actor;
let app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> };
const ORIGIN = "http://127.0.0.1";

const jsonAs = (actor: Actor) => ({ "x-test-actor": JSON.stringify(actor), "content-type": "application/json", origin: ORIGIN });

const send = (method: string, path: string, bodyValue: unknown) =>
  app.request(`${ORIGIN}${path}`, { method, headers: jsonAs(owner), body: JSON.stringify(bodyValue) });

const errorOf = async (res: Response | Promise<Response>) => {
  const settled = await res;
  return { status: settled.status, ...(await settled.json()) } as { status: number; error: string };
};

const over = (max: number) => "x".repeat(max + 1);

beforeEach(() => {
  db = makeTestDb();
  owner = seedUser(db, "owner@example.test");
  app = makeTestApp(db).app;
});

/** A free-text field with no bound is unbounded `/data` growth for any signed-in member. */
describe("length bounds", () => {
  it("refuses an over-long project name on create", async () => {
    expect(await errorOf(send("POST", "/api/projects", { name: over(NAME_MAX) }))).toEqual({
      status: 400,
      error: "name_too_long",
    });
  });
});
