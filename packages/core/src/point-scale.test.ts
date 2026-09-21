import { describe, expect, it } from "vitest";
import { isAllowedEstimate, isCustomPointScale, nearestOnScale, parsePointScale } from "./point-scale";

describe("parsePointScale", () => {
  it("reads Tracker's three built-ins", () => {
    expect(parsePointScale("0,1,2,3")).toEqual([0, 1, 2, 3]);
    expect(parsePointScale("0,1,2,4,8")).toEqual([0, 1, 2, 4, 8]);
    expect(parsePointScale("0,1,2,3,5,8")).toEqual([0, 1, 2, 3, 5, 8]);
  });

  it("reads a custom scale with fractional values", () => {
    expect(parsePointScale("0,0.5,1,2")).toEqual([0, 0.5, 1, 2]);
  });

  it("refuses an empty, unsorted, duplicated, negative or non-numeric scale", () => {
    for (const bad of ["", "1,0", "1,1", "-1,0", "0,1,x", "0,,1"]) {
      expect(() => parsePointScale(bad)).toThrow(RangeError);
    }
  });
});

describe("isCustomPointScale", () => {
  it("is false for an exact built-in and true for anything else", () => {
    expect(isCustomPointScale("0,1,2,3,5,8")).toBe(false);
    expect(isCustomPointScale("0,1,2,3,5,8,13")).toBe(true);
    // Spacing is not normalization: Tracker compares the stored string.
    expect(isCustomPointScale("0, 1, 2, 3")).toBe(true);
  });
});

describe("isAllowedEstimate", () => {
  const scale = [0, 1, 2, 3, 5, 8];
  it("accepts null (unestimated) and any value on the scale", () => {
    expect(isAllowedEstimate(null, scale)).toBe(true);
    expect(isAllowedEstimate(5, scale)).toBe(true);
  });
  it("refuses a value off the scale, including the search sentinel", () => {
    expect(isAllowedEstimate(4, scale)).toBe(false);
    expect(isAllowedEstimate(-1, scale)).toBe(false);
  });
});

describe("nearestOnScale", () => {
  it("rewrites an estimate to the closest value when a built-in scale changes", () => {
    expect(nearestOnScale(5, [0, 1, 2, 4, 8])).toBe(4);
    expect(nearestOnScale(3, [0, 1, 2, 4, 8])).toBe(2); // a tie rounds down
    expect(nearestOnScale(99, [0, 1, 2, 4, 8])).toBe(8);
  });
});
