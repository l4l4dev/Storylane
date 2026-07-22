import { describe, expect, it } from "vitest";
import {
  clampVelocityWindow,
  forecastPoints,
  velocityRate,
} from "./velocity";

describe("velocityRate", () => {
  it("returns 0 when there are no completed iterations", () => {
    expect(velocityRate([], 3)).toBe(0);
  });

  it("divides summed points by summed capacity over the window", () => {
    expect(velocityRate([{ velocity: 12, capacity: 10 }, { velocity: 8, capacity: 10 }], 2)).toBe(1);
  });

  it("weights by capacity rather than averaging per-iteration ratios", () => {
    // A one-day sprint scoring 3 points must not outweigh a ten-day sprint
    // scoring 10 — averaging ratios would give (3 + 1) / 2 = 2.
    expect(velocityRate([{ velocity: 3, capacity: 1 }, { velocity: 10, capacity: 10 }], 2)).toBe(13 / 11);
  });

  it("uses all completed iterations when fewer than the window exist", () => {
    expect(velocityRate([{ velocity: 10, capacity: 5 }], 3)).toBe(2);
  });

  it("excludes capacity-0 gap rows so they cannot crush the rate", () => {
    expect(velocityRate([{ velocity: 0, capacity: 0 }, { velocity: 10, capacity: 5 }], 3)).toBe(2);
  });

  it("excludes iterations finalized before capacity was snapshotted (null)", () => {
    expect(velocityRate([{ velocity: 20, capacity: null }, { velocity: 10, capacity: 5 }], 3)).toBe(2);
  });

  it("excludes skipped iterations", () => {
    expect(velocityRate([{ velocity: 0, capacity: 3, skipped: true }, { velocity: 10, capacity: 5 }], 3)).toBe(2);
  });

  it("counts the window after filtering, not before", () => {
    const iterations = [
      { velocity: 0, capacity: 0 },
      { velocity: 10, capacity: 5 },
      { velocity: 10, capacity: 5 },
    ];
    expect(velocityRate(iterations, 2)).toBe(2);
  });

  it("treats a null velocity as 0 points", () => {
    expect(velocityRate([{ velocity: null, capacity: 5 }], 1)).toBe(0);
  });
});

describe("forecastPoints", () => {
  it("scales the rate by the sprint's planned capacity", () => {
    expect(forecastPoints(1.5, 10)).toBe(15);
  });

  it("falls back to 1 point before any capacity history exists", () => {
    expect(forecastPoints(0, 10)).toBe(1);
  });

  it("falls back to 1 point for a sprint with no working days", () => {
    expect(forecastPoints(2, 0)).toBe(1);
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
