import { describe, expect, it } from "vitest";
import { estimationGateBlocks, isAllowedPointValue, nextCompletedAt } from "./points";
import { pointScaleValues } from "./story-types";

describe("isAllowedPointValue", () => {
  it("accepts null and any value on the scale, rejects anything else", () => {
    const fib = pointScaleValues("fibonacci", null);
    expect(isAllowedPointValue(null, fib)).toBe(true);
    expect(isAllowedPointValue(8, fib)).toBe(true);
    expect(isAllowedPointValue(4, fib)).toBe(false);
    expect(isAllowedPointValue(2, pointScaleValues("custom", [2, 4, 6]))).toBe(true);
    expect(isAllowedPointValue(3, pointScaleValues("custom", [2, 4, 6]))).toBe(false);
  });
});

describe("estimationGateBlocks", () => {
  it("blocks an unestimated feature outside Icebox and unstarted", () => {
    const unestimated = { storyType: "feature" as const, points: null };
    expect(estimationGateBlocks({ ...unestimated, targetCategory: null })).toBe(false);
    expect(estimationGateBlocks({ ...unestimated, targetCategory: "unstarted" })).toBe(false);
    expect(estimationGateBlocks({ ...unestimated, targetCategory: "in_progress" })).toBe(true);
    expect(estimationGateBlocks({ ...unestimated, targetCategory: "done" })).toBe(true);
    expect(estimationGateBlocks({ ...unestimated, targetCategory: "rejected" })).toBe(true);
  });

  it("never blocks an estimated feature, a chore, a bug without points or a release", () => {
    expect(estimationGateBlocks({ storyType: "feature", points: 3, targetCategory: "done" })).toBe(false);
    expect(estimationGateBlocks({ storyType: "chore", points: null, targetCategory: "done" })).toBe(false);
    expect(estimationGateBlocks({ storyType: "bug", points: null, targetCategory: "in_progress" })).toBe(false);
    expect(estimationGateBlocks({ storyType: "release", points: null, targetCategory: "done" })).toBe(false);
  });
});

describe("nextCompletedAt", () => {
  it("stamps on entering done, keeps the stamp while it stays done, clears on leaving", () => {
    expect(nextCompletedAt("done", null, 1_000)).toBe(1_000);
    expect(nextCompletedAt("done", 500, 1_000)).toBe(500);
    expect(nextCompletedAt("in_progress", 500, 1_000)).toBeNull();
    expect(nextCompletedAt(null, 500, 1_000)).toBeNull();
    expect(nextCompletedAt("rejected", 500, 1_000)).toBeNull();
  });
});
