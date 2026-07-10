import { describe, expect, it } from "vitest";
import { acceptedPoints, calculateVelocity, clampVelocityWindow } from "./velocity";

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

describe("clampVelocityWindow", () => {
  // TASK-25 (follow-up from TASK-7 PR #2): projects.velocity_window had no
  // validation client-side and only a `>= 1` DB CHECK — this clamps before
  // the value ever reaches the insert/update, so createProject/updateProject
  // never send an out-of-range value in the first place.
  it("passes through a valid positive integer unchanged", () => {
    expect(clampVelocityWindow(5)).toBe(5);
  });

  it("clamps 0 up to 1", () => {
    expect(clampVelocityWindow(0)).toBe(1);
  });

  it("clamps a negative value up to 1", () => {
    expect(clampVelocityWindow(-3)).toBe(1);
  });

  it("clamps NaN (e.g. a non-numeric form value) to 1", () => {
    expect(clampVelocityWindow(Number.NaN)).toBe(1);
  });

  it("rounds a non-integer down to the nearest whole number", () => {
    expect(clampVelocityWindow(3.7)).toBe(3);
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

  // TASK-10: finalize_iteration (20260709000002_finalize_iteration.sql)
  // computes velocity in SQL instead of calling this function — this fixture
  // is the one manually cross-checked against the RPC's
  // "sum(points) where state='accepted' and story_type in ('feature','bug')"
  // during TASK-10 verification, confirming both give 5 for the same rows.
  it("matches the finalize_iteration RPC's SQL computation for a mixed-state iteration", () => {
    const stories = [
      { story_type: "feature", state: "accepted", points: 5 },
      { story_type: "chore", state: "accepted", points: 3 },
      { story_type: "feature", state: "unstarted", points: 2 },
      { story_type: "bug", state: "rejected", points: 1 },
    ];
    expect(acceptedPoints(stories)).toBe(5);
  });
});
