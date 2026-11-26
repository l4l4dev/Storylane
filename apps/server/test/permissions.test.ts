import { describe, expect, it } from "bun:test";
import { ALL_ACTIONS, isWrite, validatePermissionsFixture, type Action } from "../src/authz/permissions";
import fixture from "../../../spec/fixtures/permissions.json";

// Pins the read/write split explicitly rather than trusting `!action.endsWith(":read")`
// implicitly: if a new action is added to the fixture without one of these two names
// mentioning it, this test fails instead of silently classifying it as a write (or vice versa).
const READ_ACTIONS: readonly Action[] = [
  "project:read",
  "member:read",
  "invite:read",
  "story:read",
  "iteration:read",
  "activity:read",
  "search:read",
];

describe("isWrite", () => {
  const readSet = new Set<string>(READ_ACTIONS);
  for (const action of ALL_ACTIONS) {
    const wantWrite = !readSet.has(action);
    it(`${action} → ${wantWrite ? "write" : "read"}`, () => {
      expect(isWrite(action)).toBe(wantWrite);
    });
  }

  it("READ_ACTIONS names every action ALL_ACTIONS actually has", () => {
    for (const action of READ_ACTIONS) expect(ALL_ACTIONS).toContain(action);
  });
});

describe("validatePermissionsFixture", () => {
  it("accepts the real fixture", () => {
    expect(() => validatePermissionsFixture(fixture)).not.toThrow();
  });

  it("throws when an action isn't 401 for anonymous / 404 for non-member", () => {
    const broken = structuredClone(fixture);
    broken.actions["project:read"] = { ...broken.actions["project:read"], "non-member": 200 };
    expect(() => validatePermissionsFixture(broken)).toThrow(
      /project:read must be 401 for anonymous and 404 for non-member/,
    );
  });
});
