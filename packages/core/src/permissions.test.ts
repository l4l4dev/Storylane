import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const fixture = JSON.parse(readFileSync(resolve(root, "spec/fixtures/permissions.json"), "utf8"));
const md = readFileSync(resolve(root, "spec/permissions.md"), "utf8");

/** Parse the first markdown table whose header starts with "| action |". */
function parseMatrix(src: string): Record<string, Record<string, number>> {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /^\|\s*action\s*\|/i.test(l));
  if (start < 0) throw new Error("matrix table not found");
  const headerLine = lines[start];
  if (headerLine === undefined) throw new Error("matrix table not found");
  const header = headerLine.split("|").map((s) => s.trim()).filter(Boolean);
  const out: Record<string, Record<string, number>> = {};
  for (let i = start + 2; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || !line.startsWith("|")) break;
    const cells = line.split("|").map((s) => s.trim()).filter(Boolean);
    const action = cells[0];
    if (action === undefined) continue;
    const row: Record<string, number> = {};
    header.slice(1).forEach((role, idx) => {
      row[role] = Number(cells[idx + 1]);
    });
    out[action.replace(/`/g, "")] = row;
  }
  return out;
}

describe("spec/permissions.md ↔ spec/fixtures/permissions.json", () => {
  it("lists roles in the fixed order", () => {
    expect(fixture.roles).toEqual(["anonymous", "non-member", "viewer", "member", "owner"]);
  });
  it("has identical matrices", () => {
    expect(parseMatrix(md)).toEqual(fixture.actions);
  });
  it("uses only the allowed response codes", () => {
    for (const row of Object.values(fixture.actions) as Record<string, number>[]) {
      for (const code of Object.values(row)) expect([200, 401, 403, 404]).toContain(code);
    }
  });
  it("anonymous is always 401 and non-member always 404", () => {
    for (const row of Object.values(fixture.actions) as Record<string, number>[]) {
      expect(row["anonymous"]).toBe(401);
      expect(row["non-member"]).toBe(404);
    }
  });
});
