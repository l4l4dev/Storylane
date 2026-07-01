import { describe, expect, it } from "vitest";
import { acceptedPoints, calculateVelocity } from "./velocity";

describe("calculateVelocity", () => {
  it("returns 0 when there are no completed iterations", () => {
    expect(calculateVelocity([], 3)).toBe(0);
  });

  it("averages the most recent window of completed iterations", () => {
    expect(calculateVelocity([{ velocity: 10 }, { velocity: 8 }, { velocity: 6 }], 2)).toBe(9);
  });

  it("uses all completed iterations when fewer than the window exist", () => {
    expect(calculateVelocity([{ velocity: 10 }, { velocity: 5 }], 3)).toBe(8);
  });

  it("treats a null velocity as 0", () => {
    expect(calculateVelocity([{ velocity: null }, { velocity: 10 }], 2)).toBe(5);
  });
});

describe("acceptedPoints", () => {
  it("sums points for accepted feature/bug stories only", () => {
    const stories = [
      { story_type: "feature", state: "accepted", points: 3 },
      { story_type: "bug", state: "accepted", points: 2 },
      { story_type: "feature", state: "started", points: 5 },
      { story_type: "chore", state: "accepted", points: null },
      { story_type: "release", state: "accepted", points: null },
    ];
    expect(acceptedPoints(stories)).toBe(5);
  });

  it("returns 0 for an empty iteration", () => {
    expect(acceptedPoints([])).toBe(0);
  });
});
