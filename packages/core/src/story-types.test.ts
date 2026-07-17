import { describe, expect, it } from "vitest";
import { pointScaleValues, storyTypeUsesPoints } from "./story-types";

describe("storyTypeUsesPoints", () => {
  it("returns true for feature and bug", () => {
    expect(storyTypeUsesPoints("feature")).toBe(true);
    expect(storyTypeUsesPoints("bug")).toBe(true);
  });

  it("returns false for chore and release", () => {
    expect(storyTypeUsesPoints("chore")).toBe(false);
    expect(storyTypeUsesPoints("release")).toBe(false);
  });
});

describe("pointScaleValues", () => {
  it("returns the fibonacci scale", () => {
    expect(pointScaleValues("fibonacci", null)).toEqual([0, 1, 2, 3, 5, 8, 13]);
  });

  it("returns the linear scale", () => {
    expect(pointScaleValues("linear", null)).toEqual([0, 1, 2, 3]);
  });

  it("returns custom_points for the custom scale", () => {
    expect(pointScaleValues("custom", [1, 10, 100])).toEqual([1, 10, 100]);
  });

  it("returns an empty list when custom_points is missing", () => {
    expect(pointScaleValues("custom", null)).toEqual([]);
  });

  it("falls back to fibonacci for unknown scale names", () => {
    expect(pointScaleValues("bogus", null)).toEqual([0, 1, 2, 3, 5, 8, 13]);
  });
});
