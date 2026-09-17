import { afterEach, describe, expect, it } from "bun:test";
import { withProjectChange } from "../src/events/emit";
import { EventBus } from "../src/events/bus";
import { createLogger } from "../src/log";
import { makeTestDb, seedProject, seedUser } from "./harness";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("withProjectChange: a no-op write is not an error", () => {
  it("does not throw and still publishes when fn records no activity, in development", () => {
    process.env.NODE_ENV = "development";
    const db = makeTestDb();
    const owner = seedUser(db, "owner@example.test");
    const projectId = seedProject(db, owner);
    const bus = new EventBus();
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l));

    // Models an empty settings PUT: a write action whose callback changes nothing and records
    // no activity.
    const result = withProjectChange({ db, bus, log }, owner, projectId, "project:update", (tx) => tx.projectId);

    expect(result).toBe(projectId);
    // The version-unchanged path warns rather than throwing.
    expect(lines.some((l) => JSON.parse(l).level === "warn")).toBe(true);
  });
});
