import { describe, expect, it } from "vitest";
import { PROJECT_ACCENT_COUNT, projectAccentClass, projectAccentSlot } from "./project-color";

describe("projectAccentSlot", () => {
  it("is deterministic for the same id", () => {
    expect(projectAccentSlot("abc-123")).toBe(projectAccentSlot("abc-123"));
  });

  it("always lands in 1..PROJECT_ACCENT_COUNT", () => {
    for (const id of ["a", "project-1", "00000000-0000-0000-0000-000000000000", "とても長い日本語のID", ""]) {
      const slot = projectAccentSlot(id);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(PROJECT_ACCENT_COUNT);
    }
  });

  it("distributes different ids across more than one slot (not a constant)", () => {
    const slots = new Set(
      Array.from({ length: 40 }, (_, i) => projectAccentSlot(`project-${i}`)),
    );
    expect(slots.size).toBeGreaterThan(1);
  });
});

describe("projectAccentClass", () => {
  it("returns the matching globals.css class name", () => {
    expect(projectAccentClass("p1")).toBe(`project-accent-${projectAccentSlot("p1")}`);
  });
});
