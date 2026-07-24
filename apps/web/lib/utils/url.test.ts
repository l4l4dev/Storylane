import { describe, expect, it } from "vitest";
import { withoutSearchParams } from "./url";

describe("withoutSearchParams", () => {
  it("removes the given keys, keeping the rest", () => {
    const result = withoutSearchParams("/board", new URLSearchParams("view=list&icebox=1&keep=1"), [
      "view",
      "icebox",
    ]);
    expect(result).toBe("/board?keep=1");
  });

  it("returns the bare pathname when no params remain", () => {
    const result = withoutSearchParams("/board", new URLSearchParams("view=list"), ["view"]);
    expect(result).toBe("/board");
  });
});
